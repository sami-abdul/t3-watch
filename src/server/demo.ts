/**
 * A Watch filled with sample checks, for trying the page and for the README's screenshots. Every
 * command it runs and every request it makes gets a canned answer, so it reaches no real account,
 * folder or network. The products are made up, and so is the key, made fresh each time.
 */
import { randomBytes } from "node:crypto";

import { sendTestAlert, setAlerts } from "./alerts.ts";
import type { WatchCore } from "./app.ts";
import type { Reads } from "./config.ts";
import { addNote } from "./drafts.ts";
import type { SignInHelp } from "./http.ts";
import type { Deps, ProcResult, RunProc } from "./proc.ts";
import type { AccessRow, FoundService, Scan, Suggestion } from "./scan.ts";
import type { Check, Outcome } from "./store.ts";

/** AWS's own example account number, so no real account is named. */
export const DEMO_ACCOUNT = "123456789012";

/** The AWS profile the demo's own AWS config file names. */
export const DEMO_AWS_CONFIG = "[profile demo]\nregion = us-east-1\n";

/** How to sign in to the demo: with the link it printed, or a new one from starting it again. */
export const DEMO_SIGN_IN_HELP: SignInHelp = {
  link: "Stop the demo and start it again for a new link.",
  api: "Sign in to the demo with the link it printed when it started",
  page: "Sign in to the demo with the link it printed when it started. Stop it and start it again for a new one.",
};

/** What the demo reads, fixed: its canned gh and its own AWS file, never .env files. */
export const DEMO_READS: Reads = { github: true, aws: true, envFiles: false };

const answer = (stdout: string): ProcResult => ({ code: 0, stdout, stderr: "", missing: false, timedOut: false });
const refused: ProcResult = { code: 1, stdout: "", stderr: "Not part of the demo", missing: false, timedOut: false };
const notInstalled: ProcResult = { code: null, stdout: "", stderr: "", missing: true, timedOut: false };

/** gh and aws answer as a healthy account would; any other command is not installed. Nothing runs. */
export const demoRun =
  (now: () => Date): RunProc =>
  async (command, args) => {
    const joined = args.join(" ");
    if (command === "gh") {
      if (joined === "--version") return answer("gh version 2.81.0 (demo)\n");
      if (joined === "config get user -h github.com" || joined.startsWith("api user")) return answer("demo-user\n");
      if (args[0] === "run" && args[1] === "list") {
        // Each repository runs CI and Lint; a check on one workflow sees only that one, as gh shows it.
        const asked = args.includes("--workflow") ? args[args.indexOf("--workflow") + 1] : undefined;
        return answer(
          JSON.stringify(
            ["CI", "Lint"].filter((name) => asked === undefined || name === asked).map((workflowName, i) => ({
              status: "completed",
              conclusion: "success",
              workflowName,
              displayTitle: "Sample change",
              url: "https://github.com/example",
              createdAt: new Date(now().getTime() - (i + 1) * 3_600_000).toISOString(),
            })),
          ),
        );
      }
      if (args[0] === "api" && joined.endsWith("--jq .default_branch")) return answer("main\n");
      if (args[0] === "api" && joined.includes("actions/runs")) return answer("12\n");
      return refused;
    }
    if (command === "aws") {
      if (args[0] === "sts") return answer(JSON.stringify({ Account: DEMO_ACCOUNT, Arn: `arn:aws:iam::${DEMO_ACCOUNT}:user/demo` }));
      if (args[0] === "cloudwatch") return answer(JSON.stringify({ Datapoints: [] }));
      return refused;
    }
    return notInstalled;
  };

const html = (status: number, body: string) => new Response(body, { status, headers: { "content-type": "text/html" } });
/** A sample site takes as long as a real one might, so its results read like real ones. */
const site = async (status: number, body: string) => {
  await new Promise((resolve) => setTimeout(resolve, 60 + Math.floor(Math.random() * 90)));
  return html(status, body);
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** The sample sites, Stripe, the alert webhook and the connectivity probes; anything else is not found. */
export const demoFetch = (now: () => Date): typeof fetch =>
  (async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    switch (url.hostname) {
      case "storefront.example":
        return site(200, "<h1>Storefront</h1><button>Add to cart</button>");
      case "billing.example":
        return site(503, "Service Unavailable");
      case "docs.example":
        return site(200, "<h1>Docs</h1><p>Install, configure, search results</p>");
      case "api.stripe.com":
        return url.pathname === "/v1/account" ? json(200, { id: "acct_demo" }) : json(200, { data: [{ created: Math.floor(now().getTime() / 1000) - 7200 }] });
      case "hooks.example":
        return json(202, { accepted: true });
      case "www.gstatic.com":
        return new Response(null, { status: 204 });
      case "one.one.one.one":
        return html(200, "fl=demo");
      default:
        return html(404, "Not part of the demo");
    }
  }) as typeof fetch;

/** Deps for the demo: canned commands and requests, on the real clock so its times read as now. */
export const demoDeps = (now: () => Date = () => new Date()): Deps => ({ run: demoRun(now), fetch: demoFetch(now), now });

type Definition = Pick<Check, "id" | "serviceId" | "kind" | "intent" | "config" | "keyId" | "cadenceSeconds" | "origin">;

/**
 * Fills a new Watch with the sample products: a storefront and its CI, a billing API whose health
 * check fails with an agent's note on it, docs with a new check to review and a draft, a nightly
 * backup that pings, an AWS account and a Stripe key, with history and alerts connected.
 */
export const seedDemo = async (watch: WatchCore, pageUrl: string) => {
  const now = watch.deps.now().getTime();
  const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
  const service = (id: string, label: string, vendor = "custom", target: string | null = null) =>
    watch.upsertService({ id, vendor, label, target, reachable: true, note: null, foundIn: ["The demo"] });
  const define = (definition: Omit<Definition, "keyId" | "origin"> & Partial<Pick<Definition, "keyId" | "origin">>, state: Check["state"] = "on") =>
    watch.defineCheck({ keyId: null, origin: "agent", ...definition }, state);
  /** Runs recorded the given minutes ago, oldest first; the next is due a cadence after the last. */
  const history = (check: Check, runs: ReadonlyArray<readonly [minutes: number, outcome: Outcome, summary: string]>) => {
    for (const [minutes, outcome, summary] of runs)
      watch.store.recordRun(watch.store.check(check.id)!, { outcome, summary, evidence: { demo: true } }, ago(minutes), 90, new Date(now - minutes * 60_000 + check.cadenceSeconds * 1000).toISOString());
  };

  service("custom:storefront", "Storefront");
  const site = define({ id: "custom:storefront:answers", serviceId: "custom:storefront", kind: "http", intent: "Storefront answers", config: { url: "https://storefront.example/", contains: "Add to cart" }, cadenceSeconds: 300 });
  history(site, [[50, "pass", "Answered 200 in 96 ms"], [25, "pass", "Answered 200 in 84 ms"], [3, "pass", "Answered 200 in 88 ms"]]);

  service("custom:docs", "Docs");
  const docs = define({ id: "custom:docs:answers", serviceId: "custom:docs", kind: "http", intent: "Docs answer", config: { url: "https://docs.example/" }, cadenceSeconds: 900 });
  history(docs, [[400, "fail", "Answered 500"], [385, "fail", "Answered 500"], [370, "pass", "Answered 200 in 140 ms"], [10, "pass", "Answered 200 in 131 ms"]]);
  const search = define({ id: "custom:docs:search-answers", serviceId: "custom:docs", kind: "http", intent: "Search answers", config: { url: "https://docs.example/search?q=install", contains: "results" }, cadenceSeconds: 900 }, "draft");
  const tried = await watch.runner.trial(search);
  watch.store.setTrialResult(search.id, tried.outcome, tried.summary, ago(6));

  // After the docs, whose changes are older, so Recent changes lists them in time order.
  service("custom:billing-api", "Billing API");
  const health = define({ id: "custom:billing-api:health", serviceId: "custom:billing-api", kind: "http", intent: "Health endpoint answers", config: { url: "https://billing.example/health" }, cadenceSeconds: 300 });
  history(health, [[180, "pass", "Answered 200 in 112 ms"], [42, "fail", "Answered 503"], [37, "fail", "Answered 503"], [2, "fail", "Answered 503"]]);
  addNote(watch, health.id, "It started failing after the 2.14 deploy: the database pool is exhausted. Rolling back the deploy fixes it; the fix itself belongs in example/billing-api.");

  service("custom:nightly-backup", "Nightly backup");
  // A token made fresh, so no ping address is ever the same twice.
  const backup = define({ id: "custom:nightly-backup:pings", serviceId: "custom:nightly-backup", kind: "heartbeat", intent: "Backup pings every night", config: { token: randomBytes(16).toString("base64url"), periodSeconds: 86_400, graceSeconds: 3600 }, cadenceSeconds: 900 });
  watch.store.addHeartbeat(backup.id, ago(190), "success");
  history(backup, [[30, "pass", "Last ping 3 hours ago"], [5, "pass", "Last ping 3 hours ago"]]);

  const repos = ["example/storefront", "example/billing-api", "example/docs"] as const;
  for (const repo of repos) service(`github:${repo}`, repo, "github", repo);
  const ci = repos.map((repo) =>
    watch.defineCheck(
      { id: `github:${repo}:ci`, serviceId: `github:${repo}`, kind: "github", intent: "CI on main is passing", config: { repo, branch: "main" }, keyId: null, cadenceSeconds: 900, origin: "scan" },
      // The docs repository's CI is new since the last review.
      repo === "example/docs" ? "proposed" : "on",
    ),
  );
  for (const check of ci.slice(0, 2)) history(check, [[95, "pass", `2 workflows passing on main in ${check.config.repo}`], [8, "pass", `2 workflows passing on main in ${check.config.repo}`]]);
  watch.store.setTrialResult(ci[2]!.id, "pass", "2 workflows passing on main in example/docs", ago(9));

  const aws = `aws:${DEMO_ACCOUNT}`;
  service(aws, `AWS account ${DEMO_ACCOUNT}`, "aws", DEMO_ACCOUNT);
  const lambda = watch.defineCheck(
    {
      id: `${aws}:lambda-errors`,
      serviceId: aws,
      kind: "aws_metric",
      intent: "No Lambda function errors in the last hour",
      config: { profile: "demo", region: "us-east-1", namespace: "AWS/Lambda", metric: "Errors", statistic: "Sum", periodSeconds: 3600, windowSeconds: 3600, comparison: ">", threshold: 0, missingIsOk: true },
      keyId: null,
      cadenceSeconds: 900,
      origin: "scan",
    },
    "on",
  );
  history(lambda, [[60, "pass", "No Errors data in the window"], [12, "pass", "No Errors data in the window"]]);

  // A made-up key, shaped like one a scan found in a .env file so the review lists it like one;
  // the demo's Stripe answers take any key.
  const stripe = watch.vendors().get("stripe");
  if (stripe === undefined) throw new Error("The demo needs Stripe's description from Watch's catalog, which did not load.");
  service("vendor:stripe", "Stripe", "stripe", null);
  const key = watch.keyring.add(
    {
      id: "key-demo-stripe",
      vendor: "stripe",
      label: "Stripe key",
      source: "STRIPE_SECRET_KEY in storefront/.env",
      sourceKey: "env:demo:storefront:STRIPE_SECRET_KEY",
      account: "acct_demo",
      createdAt: ago(2880),
    },
    `demo_${randomBytes(12).toString("hex")}`,
  );
  const vendorChecks = stripe.checks.map((definition) =>
    watch.defineCheck(
      { id: `vendor:stripe:${definition.id}`, serviceId: "vendor:stripe", kind: "vendor", intent: definition.intent, config: { vendor: "stripe", check: definition.id }, keyId: key.id, cadenceSeconds: stripe.cadenceSeconds, origin: "scan" },
      "on",
    ),
  );
  for (const check of vendorChecks) history(check, [[20, "pass", check.config.check === "key" ? "Stripe accepts the key for acct_demo" : "Latest 2 hours ago"]]);

  // The last scan, applied a day ago and run again since, which found the docs CI.
  const gh: AccessRow = { accessKey: "machine:gh", source: "GitHub CLI, logged in as demo-user", status: "works", detail: null, account: "demo-user", warnings: ["personal_token"], keyId: null, removable: false };
  const found = (serviceId: string, vendor: string, label: string, access: ReadonlyArray<AccessRow>, addKey: FoundService["addKey"] = null): FoundService => ({
    serviceId,
    vendor,
    label,
    foundIn: ["The demo"],
    reachable: true,
    note: null,
    access,
    addKey,
  });
  const suggestion = (check: Check, title: string): Suggestion => {
    const current = watch.store.check(check.id)!;
    return { checkId: current.id, serviceId: current.serviceId, title, intent: current.intent, outcome: current.lastOutcome ?? "pass", summary: current.lastSummary ?? "", state: current.state, suggested: true };
  };
  watch.store.setKv("scan", {
    scannedAt: ago(9),
    // Where sample projects would live; the demo itself reads no folder.
    roots: ["~/code"],
    repositories: repos.length,
    // In the order a scan lists them: reachable first, then by name.
    services: [
      ...repos.map((repo) => found(`github:${repo}`, "github", repo, [gh])),
      found(aws, "aws", `AWS account ${DEMO_ACCOUNT}`, [{ accessKey: `machine:aws:${DEMO_ACCOUNT}`, source: "AWS profile demo", status: "works", detail: "Watch only reads", account: DEMO_ACCOUNT, warnings: [], keyId: null, removable: false }]),
      found(
        "vendor:stripe",
        "stripe",
        "Stripe",
        // Not removable: the demo keeps its sample key, so the review offers nothing it would refuse.
        [{ accessKey: key.sourceKey!, source: key.source, status: "works", detail: null, account: "acct_demo", warnings: [], keyId: key.id, removable: false }],
        stripe.key === undefined ? null : { vendor: stripe.id, keyUrl: stripe.key.keyUrl },
      ),
    ].toSorted((a, b) => Number(b.reachable) - Number(a.reachable) || a.label.localeCompare(b.label)),
    suggestions: [...ci.map((check) => suggestion(check, String(check.config.repo))), suggestion(lambda, `AWS account ${DEMO_ACCOUNT}`), ...vendorChecks.map((check) => suggestion(check, "Stripe"))],
    appliedAt: ago(1440),
  } satisfies Scan);

  // Alerts go to a made-up webhook that accepts them, signed with a secret nobody sees, and a test
  // got through. The demo itself makes no secret, so none can end up with a real Watch thread.
  setAlerts(watch, { url: "https://hooks.example/watch", secret: randomBytes(32).toString("hex") });
  await sendTestAlert(watch, pageUrl);
};
