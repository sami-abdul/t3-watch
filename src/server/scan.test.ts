import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { makeWatch } from "./app.ts";
import type { Reads } from "./config.ts";
import { findRepositories, manifestPackages, parseAwsConfig, parseEnv, readSources, type Scan } from "./scan.ts";
import { fakeDeps, jsonResponse } from "./testkit.ts";

const PIPEDRIVE_KEY = "pd-key-1234567890";
const STRIPE_KEY = "sk_live_abcdefghijkl";
let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "t3w-scan-"));
  const api = join(root, "api");
  mkdirSync(join(api, ".git"), { recursive: true });
  writeFileSync(join(api, "package.json"), JSON.stringify({ dependencies: { stripe: "1", pipedrive: "1" } }));
  writeFileSync(join(api, ".env"), `PIPEDRIVE_TOKEN=${PIPEDRIVE_KEY}\nSTRIPE_SECRET_KEY="${STRIPE_KEY}"\n`);
  writeFileSync(join(api, ".env.example"), "PIPEDRIVE_TOKEN=placeholder-not-real\n");
  mkdirSync(join(api, "node_modules", "x"), { recursive: true });
  writeFileSync(join(api, "node_modules", "x", "package.json"), JSON.stringify({ dependencies: { asana: "1" } }));
  const worker = join(root, "group", "worker");
  mkdirSync(join(worker, ".git"), { recursive: true });
  writeFileSync(join(worker, "requirements.txt"), "boto3==1.0\n");
  mkdirSync(join(worker, "jobs"));
  writeFileSync(join(worker, "jobs", ".env"), `PIPEDRIVE_TOKEN=${PIPEDRIVE_KEY}\n`);
  writeFileSync(
    join(root, "aws-config"),
    "[sso-session corp]\nsso_region = us-east-1\n[profile prod]\nsso_session = corp\nregion = us-east-1\n[profile prod-admin]\nsso_session = corp\n[profile old]\nsso_session = corp\nregion = us-east-1\n",
  );
  process.env.AWS_CONFIG_FILE = join(root, "aws-config");
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env.AWS_CONFIG_FILE;
});

const makeFixture = (reads?: Reads | (() => Reads), roots: () => ReadonlyArray<string> = () => [root], chosen?: () => boolean) => {
  const fake = fakeDeps({
    commands: {
      git: () => ({ stdout: "git@github.com:acme/api.git\n" }),
      gh: (args) => {
        const joined = args.join(" ");
        if (joined === "--version") return { stdout: "gh version 2.81.0\n" };
        if (joined === "config get user -h github.com") return { stdout: "octo\n" };
        if (joined.startsWith("api user")) return { stdout: "octo\n" };
        if (joined === "api repos/acme/api --jq .default_branch") return { stdout: "main\n" };
        if (joined.includes("actions/runs")) return { stdout: "3\n" };
        if (args[0] === "run")
          return { stdout: JSON.stringify([{ status: "completed", conclusion: "success", workflowName: "CI", displayTitle: "t", url: "u", createdAt: "c" }]) };
        return { code: 1, stderr: "unexpected" };
      },
      aws: (args) => {
        const profile = args[args.indexOf("--profile") + 1];
        if (args[0] === "sts")
          return profile === "old"
            ? { code: 255, stderr: "Error loading SSO Token: Token for corp has expired" }
            : { stdout: JSON.stringify({ Account: "123456789012" }) };
        return { stdout: JSON.stringify({ Datapoints: [] }) };
      },
    },
    fetch: (url) => {
      if (url.hostname === "api.pipedrive.com")
        return url.pathname.endsWith("/users/me")
          ? jsonResponse(200, { data: { company_id: 9 } })
          : jsonResponse(200, { data: [{ update_time: "2026-10-15T09:00:00Z" }] });
      if (url.hostname === "api.stripe.com")
        return url.pathname === "/v1/account"
          ? jsonResponse(200, { id: "acct_1" })
          : jsonResponse(200, { data: [{ created: 1_000 }] });
      return jsonResponse(404, {});
    },
  });
  const watch = makeWatch({
    home: null,
    dbFile: ":memory:",
    deps: fake.deps,
    roots,
    ...(reads === undefined ? {} : { reads: typeof reads === "function" ? reads : () => reads }),
    ...(chosen === undefined ? {} : { chosen }),
  });
  return { watch, fake };
};

describe("detection", () => {
  it("finds repositories one and two levels down, skipping dependencies", () => {
    expect(findRepositories([root]).map((p) => p.slice(root.length))).toEqual(["/api", "/group/worker"]);
  });
  it("reads manifests, env files and AWS profiles", () => {
    expect(manifestPackages("requirements.txt", "boto3>=1\n# x\n")).toEqual(["boto3"]);
    expect(parseEnv('A="b c" # note\nB=d').get("A")).toBe("b c");
    expect(parseAwsConfig("[profile p]\nsso_session = s\nregion = eu-west-1\n")).toEqual([{ name: "p", region: "eu-west-1", sso: true }]);
  });
});

describe("scan", () => {
  it("finds services, stores working keys and trial-runs suggested checks", async () => {
    const { watch } = makeFixture();
    const scan = await watch.scanner.start();
    const ids = scan.services.map((s) => s.serviceId);
    expect(ids).toEqual(expect.arrayContaining(["github:acme/api", "aws:123456789012", "vendor:pipedrive", "vendor:stripe"]));
    expect(ids).not.toContain("vendor:asana");

    const serialized = JSON.stringify(watch.store.getKv<Scan | null>("scan", null));
    expect(serialized).not.toContain(PIPEDRIVE_KEY);
    expect(serialized).not.toContain(STRIPE_KEY);

    // The same Pipedrive key in two files is one key.
    expect(watch.keys().map((k) => k.vendor).toSorted()).toEqual(["pipedrive", "stripe"]);

    const aws = scan.services.find((s) => s.serviceId === "aws:123456789012")!;
    expect(aws.access[0]!.source).toBe("AWS profile prod, also prod-admin");
    const broken = scan.services.find((s) => s.serviceId === "aws")!.access[0]!;
    expect(aws.access).toHaveLength(1);
    expect(broken.status).toBe("expired");
    expect(broken.detail).toBe("Sign in again: aws sso login --profile old");

    const stripe = scan.services.find((s) => s.serviceId === "vendor:stripe")!;
    expect(stripe.access[0]!.warnings).toContain("can_write");

    const byId = new Map(scan.suggestions.map((s) => [s.checkId, s]));
    expect(byId.get("github:acme/api:ci")?.outcome).toBe("pass");
    // The service label already names the repository.
    expect(byId.get("github:acme/api:ci")?.intent).toBe("CI on main is passing");
    expect(byId.get("aws:123456789012:lambda-errors")?.outcome).toBe("pass");
    expect(byId.get("vendor:pipedrive:deals-moving")?.suggested).toBe(true);
    // Optional checks start unticked.
    expect(byId.get("vendor:stripe:activity")?.suggested).toBe(false);
    // Nothing runs on a schedule before review.
    expect(watch.store.checks().every((c) => c.state === "proposed")).toBe(true);
  });

  it("reads only the logins the person allowed", async () => {
    const all = { github: true, aws: true, envFiles: true };
    const noAws = makeFixture({ ...all, aws: false });
    const withoutAws = await noAws.watch.scanner.start();
    expect(noAws.fake.calls.some((c) => c.command === "aws")).toBe(false);
    expect(withoutAws.services.some((s) => s.vendor === "aws")).toBe(false);
    expect(withoutAws.services.map((s) => s.serviceId)).toContain("github:acme/api");
    const noGithub = makeFixture({ ...all, github: false });
    const withoutGithub = await noGithub.watch.scanner.start();
    expect(noGithub.fake.calls.some((c) => c.command === "gh")).toBe(false);
    expect(withoutGithub.services.some((s) => s.vendor === "github")).toBe(false);
    // With .env files off, vendors are still found in manifests, but no key is read.
    const noEnv = makeFixture({ ...all, envFiles: false });
    const withoutEnv = await noEnv.watch.scanner.start();
    expect(noEnv.watch.keys()).toEqual([]);
    expect(withoutEnv.services.map((s) => s.serviceId)).toEqual(expect.arrayContaining(["vendor:stripe", "vendor:pipedrive"]));
    expect(JSON.stringify(withoutEnv)).not.toContain(PIPEDRIVE_KEY);
  });

  it("lists a stored .env key whose folder is no longer ticked", async () => {
    let roots: ReadonlyArray<string> = [root];
    const { watch } = makeFixture(undefined, () => roots);
    await watch.scanner.start();
    roots = [];
    const again = await watch.scanner.start();
    expect(again.services.find((s) => s.serviceId === "vendor:stripe")!.access.map((a) => a.source)).toEqual(["STRIPE_SECRET_KEY in api/.env, stored by an earlier scan"]);
  });

  it("waits for the person's choice on a new install, not on one that scanned before the choice existed", async () => {
    const { watch } = makeFixture(undefined, undefined, () => false);
    expect(() => watch.scanner.start()).toThrow("has not been told what it may read yet");
    const earlier = makeFixture(undefined, undefined, () => false);
    earlier.watch.store.setKv("scan", { scannedAt: "2026-10-01T00:00:00Z" });
    await expect(earlier.watch.scanner.start()).resolves.toMatchObject({ services: expect.any(Array) });
  });

  it("keeps keys an earlier scan stored from .env files when .env files are turned off", async () => {
    let reads = { github: true, aws: true, envFiles: true };
    const { watch } = makeFixture(() => reads);
    await watch.scanner.start();
    reads = { ...reads, envFiles: false };
    const again = await watch.scanner.start();
    const stripe = again.services.find((s) => s.serviceId === "vendor:stripe")!;
    expect(stripe.reachable).toBe(true);
    expect(stripe.access.map((a) => [a.status, a.source])).toEqual([["works", "STRIPE_SECRET_KEY in api/.env, stored by an earlier scan"]]);
    expect(again.suggestions.some((s) => s.checkId.startsWith("vendor:stripe:"))).toBe(true);
  });

  it("previews each folder's repositories and which logins are here, running nothing that reaches a network", async () => {
    const { watch, fake } = makeFixture();
    const sources = await readSources(watch, [root, join(root, "missing")]);
    expect(sources.folders).toEqual([
      { path: root, exists: true, repositories: 2 },
      { path: join(root, "missing"), exists: false, repositories: 0 },
    ]);
    expect(sources.logins.map((l) => [l.id, l.available])).toEqual([
      ["github", true],
      ["aws", true],
      ["envFiles", true],
    ]);
    expect(sources.logins[1]!.detail).toBe("3 profiles here. Watch reads each account's identity and metrics.");
    // gh's login comes from its own config, with no network call.
    expect(fake.calls.map((c) => [c.command, ...c.args].join(" "))).toEqual(["gh config get user -h github.com"]);
    expect(sources.logins[0]!.detail).toBe("Logged in as octo. Watch reads each repository's CI with that login.");
    // Logins turned off are not looked at.
    const off = makeFixture();
    const quiet = await readSources(off.watch, [root], { github: false, aws: false, envFiles: true });
    expect(off.fake.calls).toEqual([]);
    expect(quiet.logins.slice(0, 2).map((l) => l.available)).toEqual([null, null]);
    expect(quiet.logins[1]!.detail).toBe("Turned off, so Watch does not look at it.");
  });

  it("adds nothing on a second scan", async () => {
    const { watch } = makeFixture();
    await watch.scanner.start();
    const counts = () => [watch.store.services().length, watch.store.checks().length, watch.store.allKeys().length];
    const first = counts();
    await watch.scanner.start();
    expect(counts()).toEqual(first);
  });

  it("applies the review and keeps a removed key removed", async () => {
    const { watch } = makeFixture();
    const scan = await watch.scanner.start();
    const stripeRow = scan.services.find((s) => s.serviceId === "vendor:stripe")!.access[0]!;
    const turnOn = scan.suggestions.filter((s) => s.suggested).map((s) => s.checkId);
    const result = await watch.applyScan({ turnOn: [...turnOn, "vendor:stripe:key"], removeKeys: [stripeRow.accessKey] });
    expect(result.removed).toBe(1);
    expect(watch.store.check("vendor:pipedrive:key")!.state).toBe("on");
    expect(watch.store.check("vendor:stripe:key")!.state).not.toBe("on");
    expect(watch.store.check("vendor:stripe:activity")!.state).toBe("off");

    const again = await watch.scanner.start();
    const row = again.services.find((s) => s.serviceId === "vendor:stripe")!.access[0]!;
    expect(row.status).toBe("removed");
    expect(watch.keys().map((k) => k.vendor)).toEqual(["pipedrive"]);
    // Choices made in review survive the rescan.
    expect(watch.store.check("vendor:pipedrive:key")!.state).toBe("on");
    expect(watch.store.check("vendor:stripe:activity")!.state).toBe("off");
  });

  it("pauses a running check whose key the review removes", async () => {
    const { watch } = makeFixture();
    const scan = await watch.scanner.start();
    await watch.applyScan({ turnOn: ["vendor:stripe:key"], removeKeys: [] });
    expect(watch.store.check("vendor:stripe:key")!.state).toBe("on");
    const stripeRow = scan.services.find((s) => s.serviceId === "vendor:stripe")!.access[0]!;
    await watch.applyScan({ turnOn: ["vendor:stripe:key"], removeKeys: [stripeRow.accessKey] });
    expect(watch.store.check("vendor:stripe:key")!.state).toBe("paused");
  });
});
