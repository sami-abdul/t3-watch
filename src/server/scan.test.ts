import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { makeWatch } from "./app.ts";
import { findRepositories, manifestPackages, parseAwsConfig, parseEnv, type Scan } from "./scan.ts";
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

const makeFixture = () => {
  const fake = fakeDeps({
    commands: {
      git: () => ({ stdout: "git@github.com:acme/api.git\n" }),
      gh: (args) => {
        const joined = args.join(" ");
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
  const watch = makeWatch({ home: null, dbFile: ":memory:", deps: fake.deps, roots: () => [root] });
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
});
