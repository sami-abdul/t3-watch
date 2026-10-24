import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { makeWatch } from "./app.ts";
import { deliverAlerts, setAlerts } from "./alerts.ts";
import { deliverSlack, setSlack, slackState, testSlack } from "./slack.ts";
import { readState } from "./state.ts";
import { fakeDeps, testWatch } from "./testkit.ts";
import { extendServer } from "./extend.ts";
import { makeHttpServer } from "./http.ts";
import { startSession } from "./signin.ts";
import type { WatchConfig } from "./config.ts";

// Synthetic destinations only. Tests never contact Slack.
const webhook = new URL(["services", "TTEST", "BTEST", "synthetic-test-only"].join("/"), "https://hooks.slack.com/").href;
const replacement = webhook.replace("BTEST", "BOTHER");
const closers: Array<() => void> = [];
afterEach(() => { for (const close of closers.splice(0)) close(); });
const watchOf = (deps: ReturnType<typeof fakeDeps>["deps"]) => {
  const watch = testWatch(deps); closers.push(() => watch.store.close()); return watch;
};
const change = (watch: ReturnType<typeof testWatch>, summary = "HTTP 503") => {
  if (watch.store.check("c") === null) watch.defineCheck({ id: "c", serviceId: "s", kind: "http", intent: "API answers", config: { url: "https://example.com" }, cadenceSeconds: 60, keyId: null, origin: "user" }, "on");
  return watch.store.recordRun(watch.requireCheck("c"), { outcome: "fail", summary, evidence: {} }, watch.now(), 0, watch.now());
};

describe("Slack alerts", () => {
  it("encrypts the URL at rest, survives reopen and leaves no URL or last-four hint in public state", () => {
    const home = mkdtempSync(join(tmpdir(), "watch-slack-"));
    try {
      const file = join(home, "watch.db");
      const watch = makeWatch({ home, dbFile: file, deps: fakeDeps({}).deps });
      setSlack(watch, webhook);
      expect(JSON.stringify(readState(watch))).not.toContain(webhook);
      expect(readState(watch).keys).toHaveLength(0);
      const config = watch.store.getKv<{ ciphertext: string }>("slack", { ciphertext: "" });
      expect(watch.keyring.decrypt(config.ciphertext)).toBe(webhook);
      expect(config.ciphertext).not.toContain("hooks.slack");
      watch.store.close();
      expect(readFileSync(file).includes(Buffer.from(webhook))).toBe(false);
      const reopened = makeWatch({ home, dbFile: file, deps: fakeDeps({}).deps });
      expect(slackState(reopened).on).toBe(true);
      expect(reopened.keyring.decrypt(reopened.store.getKv<{ ciphertext: string }>("slack", config).ciphertext)).toBe(webhook);
      reopened.store.close();
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

  it("accepts only HTTPS Slack incoming webhooks, including GovSlack, and never echoes invalid input", () => {
    const watch = watchOf(fakeDeps({}).deps);
    for (const value of [webhook.replace("https:", "http:"), webhook + "?secret=private", webhook + "#secret", webhook.replace("hooks.slack.com", "hooks.slack.com.evil.test"), webhook.replace("hooks.slack.com", "user:pass@hooks.slack.com"), "https://127.0.0.1/services/a/b/c", 3, undefined]) {
      expect(() => setSlack(watch, value)).toThrow("Paste a Slack incoming-webhook URL");
    }
    setSlack(watch, webhook.replace("slack.com", "slack-gov.com"));
    expect(slackState(watch).on).toBe(true);
  });

  it("delivers to Slack independently when T3 refuses, then retries T3 without duplicating Slack", async () => {
    let slackPosts = 0;
    const fake = fakeDeps({ fetch: (url, init) => {
      if (url.hostname !== "hooks.slack.com") return new Response("no", { status: 503 });
      slackPosts++;
      expect(init.method).toBe("POST"); expect(init.redirect).toBe("manual");
      const body = JSON.parse(String(init.body));
      expect(body.text).toContain("Watch check failed"); expect(body.text).toContain("HTTP 503");
      expect(body.mrkdwn).toBe(false);expect(body.unfurl_links).toBe(false);
      return new Response("ok");
    }});
    const watch = watchOf(fake.deps);
    setSlack(watch, webhook); setAlerts(watch, { url: "https://thread.example/webhook" }); change(watch);
    expect(await deliverAlerts(watch, "https://watch.example")).toBe(0);
    expect(await deliverSlack(watch, "https://watch.example")).toBe(1);
    expect(watch.store.pendingEvents()).toHaveLength(1);
    fake.advance(60);
    await deliverAlerts(watch, "https://watch.example");
    expect(await deliverSlack(watch, "https://watch.example")).toBe(0);
    expect(slackPosts).toBe(1);
  });

  it("keeps Slack pending after T3 succeeds and drops Slack after twenty failed attempts", async () => {
    const fake = fakeDeps({ fetch: (url) => new Response(url.hostname === "hooks.slack.com" ? "no" : "ok", { status: url.hostname === "hooks.slack.com" ? 503 : 200 }) });
    const watch = watchOf(fake.deps);setSlack(watch, webhook);setAlerts(watch, {url:"https://thread.example/webhook"});change(watch);
    expect(await deliverAlerts(watch, "https://watch.example")).toBe(1);
    for (let n = 0; n < 20; n++) { await deliverSlack(watch, "https://watch.example");fake.advance(60); }
    expect(watch.store.pendingSlackEvents(0)).toHaveLength(0);
    expect(slackState(watch).lastDelivery?.ok).toBe(false);
    expect(fake.requests.filter(r => new URL(r.url).hostname === "hooks.slack.com")).toHaveLength(20);
  });

  it("starts fresh on connect, replacement and disconnect without touching T3's pending queue", async () => {
    const fake = fakeDeps({ fetch: () => new Response("ok") });const watch=watchOf(fake.deps);
    change(watch);setSlack(watch,webhook);
    expect(await deliverSlack(watch,"https://watch.example")).toBe(0);
    watch.store.recordRun(watch.requireCheck("c"), { outcome: "pass", summary: "HTTP 200", evidence: {} }, watch.now(), 0, watch.now());
    setSlack(watch,replacement);
    expect(await deliverSlack(watch,"https://watch.example")).toBe(0);
    expect(watch.store.pendingEvents()).toHaveLength(2);
    setSlack(watch,null);expect(slackState(watch)).toEqual({on:false,lastTest:null,lastDelivery:null});
  });

  it("rejects redirects and non-ok replies, redacts errors, and obeys Retry-After", async () => {
    let status=307;
    const fake=fakeDeps({fetch:()=>new Response(status===200?"not_ok":"no",{status,headers:{location:replacement,"retry-after":"120"}})});
    const watch=watchOf(fake.deps);setSlack(watch,webhook);change(watch);
    await deliverSlack(watch,"https://watch.example");expect(fake.requests).toHaveLength(1);
    fake.advance(60);status=429;await deliverSlack(watch,"https://watch.example");
    fake.advance(60);await deliverSlack(watch,"https://watch.example");expect(fake.requests).toHaveLength(2);
    fake.advance(60);status=200;await deliverSlack(watch,"https://watch.example");expect(slackState(watch).lastDelivery?.ok).toBe(false);
    const broken=watchOf(fakeDeps({fetch:()=>{throw Error(webhook)}}).deps);setSlack(broken,webhook);change(broken);
    await deliverSlack(broken,"https://watch.example");expect(JSON.stringify(slackState(broken))).not.toContain(webhook);
  });

  it("tests without a change, throttles double presses and ignores obsolete in-flight results", async () => {
    let finish: (r: Response) => void = () => {};
    const fake=fakeDeps({fetch:()=>new Promise<Response>(resolve=>{finish=resolve})});const watch=watchOf(fake.deps);
    await expect(testSlack(watch)).rejects.toThrow("Connect Slack");setSlack(watch,webhook);
    const pending=testSlack(watch);
    await expect(testSlack(watch)).rejects.toThrow("moments ago");
    setSlack(watch,replacement);finish(new Response("ok"));
    expect((await pending).message).toContain("settings changed");expect(slackState(watch).lastTest).toBe(null);
  });

  it("never treats check text as Slack markup and sends only one event per pass", async()=>{
    const fake=fakeDeps({fetch:(_url,init)=>{expect(JSON.parse(String(init.body)).text).toContain('&lt;!channel&gt;');return new Response('ok')}});
    const watch=watchOf(fake.deps);setSlack(watch,webhook);change(watch,'<!channel>');
    watch.store.recordRun(watch.requireCheck("c"), { outcome: "pass", summary: "okay", evidence: {} }, watch.now(), 0, watch.now());
    expect(await deliverSlack(watch,'https://watch.example')).toBe(1);
    expect(await deliverSlack(watch,'https://watch.example')).toBe(0);
    expect(watch.store.pendingSlackEvents(0)).toHaveLength(1);
  });
});

describe("Slack HTTP boundary",()=>{
  it("requires a browser session and same origin for save and test, and refuses sample secrets",async()=>{
    const fake=fakeDeps({fetch:()=>new Response('ok')});const watch=watchOf(fake.deps);
    const config:WatchConfig={host:'127.0.0.1',port:0,token:'test-api-token',roots:[],publicUrl:null};
    const extension=extendServer({watch,config:()=>config,reloadConfig:()=>config,home:'/nonexistent'});
    const server=makeHttpServer({watch,config:()=>config,webDir:'/nonexistent',extraRoutes:extension.routes});
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));closers.unshift(()=>server.close());
    const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const session=startSession(watch.store,watch.deps.now());
    for(const path of ['/api/slack','/api/slack/test']){
      const post=(headers:Record<string,string>,body={url:webhook})=>fetch(origin+path,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
      expect((await post({authorization:'Bearer '+config.token,origin})).status).toBe(403);
      expect((await post({cookie:'t3w='+session,origin:'https://evil.example'})).status).toBe(403);
      const r=await post({cookie:'t3w='+session,origin});expect(r.status).toBe(200);expect(await r.text()).not.toContain(webhook);
    }
    const state=await fetch(origin+'/api/state',{headers:{authorization:'Bearer '+config.token}});
    expect(await state.text()).not.toContain(webhook);
    const sample=makeWatch({home:null,dbFile:':memory:',deps:fake.deps,sample:true});closers.push(()=>sample.store.close());
    expect(()=>setSlack(sample,webhook)).toThrow('demo');await expect(testSlack(sample)).rejects.toThrow('demo');
  });
});
