/**
 * One-button setup. A scan reads the git repositories under the configured roots and the logins
 * on this machine, turns what it can reach into services, keys and proposed checks, and runs each
 * check once so the review shows real results. Secret values stay in this file and the keyring.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, relative } from "node:path";

import type { WatchCore as Watch } from "./app.ts";
import type { Check, KeyRecord } from "./store.ts";
import type { Vendor } from "./vendors.ts";

export type AccessStatus = "works" | "failed" | "expired" | "removed";
export type Warning = "personal_token" | "can_write" | "login_expires";

export interface AccessRow {
  readonly accessKey: string;
  readonly source: string;
  readonly status: AccessStatus;
  readonly detail: string | null;
  readonly account: string | null;
  readonly warnings: ReadonlyArray<Warning>;
  readonly keyId: string | null;
  /** A stored key the review can remove. */
  readonly removable: boolean;
}
export interface FoundService {
  readonly serviceId: string;
  readonly vendor: string;
  readonly label: string;
  readonly foundIn: ReadonlyArray<string>;
  readonly reachable: boolean;
  readonly note: string | null;
  readonly access: ReadonlyArray<AccessRow>;
  /** Present when one pasted key can connect this vendor. */
  readonly addKey: { readonly vendor: string; readonly keyUrl: string } | null;
}
export interface Suggestion {
  readonly checkId: string;
  readonly serviceId: string;
  readonly title: string;
  readonly intent: string;
  readonly outcome: "pass" | "fail" | "unknown";
  readonly summary: string;
  readonly state: Check["state"];
  /** Whether the review ticks it by default. */
  readonly suggested: boolean;
}
export interface Scan {
  readonly scannedAt: string;
  readonly roots: ReadonlyArray<string>;
  readonly repositories: number;
  readonly services: ReadonlyArray<FoundService>;
  readonly suggestions: ReadonlyArray<Suggestion>;
  readonly appliedAt: string | null;
}
export interface ScanStatus {
  readonly running: boolean;
  readonly step: string | null;
  readonly error: string | null;
}

const MAX_REPOS = 150;
const MAX_FILE_BYTES = 256 * 1024;
const SKIP = new Set([
  "node_modules", ".git", "dist", "build", "out", "target", "vendor", ".venv", "venv",
  "__pycache__", ".next", ".turbo", "coverage", "worktrees", ".claude", ".t3",
]);

// ---------------------------------------------------------------- pure detection

/** Package names a manifest declares. Unknown formats give an empty list. */
export const manifestPackages = (fileName: string, text: string): ReadonlyArray<string> => {
  if (fileName === "package.json") {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      return ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]
        .flatMap((field) => {
          const deps = parsed[field];
          return deps !== null && typeof deps === "object" ? Object.keys(deps) : [];
        })
        .map((name) => name.toLowerCase());
    } catch {
      return [];
    }
  }
  if (/^requirements.*\.txt$/.test(fileName))
    return text
      .split("\n")
      .map((line) => line.replace(/#.*/, "").trim())
      .filter((line) => line.length > 0 && !line.startsWith("-"))
      .map((line) => line.split(/[\s<>=!~;[]/)[0]!.toLowerCase())
      .filter((name) => name.length > 0);
  if (fileName === "pyproject.toml")
    // PEP 621 dependency strings and Poetry tables, without a TOML parser.
    return [...text.matchAll(/^\s*"?([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*(?:[<>=!~;"]|=\s)/gm)]
      .map((match) => match[1]!.toLowerCase())
      .filter((name) => !["python", "name", "version", "description", "readme"].includes(name));
  return [];
};
export const isManifest = (name: string) =>
  name === "package.json" || name === "pyproject.toml" || /^requirements.*\.txt$/.test(name);
export const isEnvFile = (name: string) =>
  name === ".env" ||
  (name.startsWith(".env.") && !/\.(example|sample|template|dist|defaults)$/.test(name));

/** Variable names and values from a dotenv file. Values stay on the server. */
export const parseEnv = (text: string): ReadonlyMap<string, string> => {
  const entries = new Map<string, string>();
  for (const raw of text.split("\n")) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(raw);
    if (match === null) continue;
    let value = match[2]!.trim();
    const quoted = /^(["'])(.*?)\1(?:\s+#.*)?$/.exec(value);
    value = quoted !== null ? quoted[2]! : value.replace(/\s+#.*$/, "");
    entries.set(match[1]!, value);
  }
  return entries;
};

const AWS_PACKAGES = ["aws-sdk", "aws-cdk-lib", "boto3", "aioboto3", "aws-cdk"];
export const usesAws = (packages: ReadonlyArray<string>) =>
  packages.some((name) => name.startsWith("@aws-sdk/") || AWS_PACKAGES.includes(name));

export const vendorsInPackages = (vendors: Iterable<Vendor>, packages: ReadonlyArray<string>, python: boolean) =>
  [...vendors].filter((vendor) =>
    (python ? vendor.detect.python : vendor.detect.npm).some((pattern) =>
      packages.some((name) =>
        pattern.endsWith("*") ? name.startsWith(pattern.slice(0, -1)) : name === pattern,
      ),
    ),
  );
export const vendorsInEnv = (vendors: Iterable<Vendor>, names: Iterable<string>) => {
  const list = [...names];
  return [...vendors].filter(
    (v) => v.detect.envPrefix !== undefined && list.some((n) => n.startsWith(v.detect.envPrefix!)),
  );
};

/** `owner/repo` for a GitHub remote, or null. */
export const githubRepository = (remote: string): string | null => {
  const match =
    /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9][A-Za-z0-9_.-]{0,99})\/([A-Za-z0-9][A-Za-z0-9_.-]{0,99}?)(?:\.git)?\/?$/.exec(
      remote.trim(),
    );
  return match === null ? null : `${match[1]}/${match[2]}`;
};

export interface AwsProfile {
  readonly name: string;
  readonly region: string | null;
  readonly sso: boolean;
}
/** Profiles from the AWS CLI config file, without credentials. */
export const parseAwsConfig = (text: string): ReadonlyArray<AwsProfile> => {
  const profiles: Array<{ name: string; region: string | null; sso: boolean }> = [];
  let current: { name: string; region: string | null; sso: boolean } | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const section = /^\[(?:profile\s+)?([^\]\s]+)\]$/.exec(line);
    if (section !== null) {
      current = line.startsWith("[sso-session") ? null : { name: section[1]!, region: null, sso: false };
      if (current !== null) profiles.push(current);
      continue;
    }
    const pair = /^([a-z_]+)\s*=\s*(.+)$/.exec(line);
    if (current === null || pair === null) continue;
    if (pair[1] === "region") current.region = pair[2]!.trim();
    if (pair[1] === "sso_session" || pair[1] === "sso_start_url") current.sso = true;
  }
  return profiles;
};

const hash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 20);

// ---------------------------------------------------------------- reading the machine

interface FoundKey {
  readonly sourceKey: string;
  readonly source: string;
  readonly value: string;
}
interface Findings {
  readonly repositories: Array<{ path: string; name: string; github: string | null }>;
  readonly vendors: Map<string, { foundIn: Set<string>; keys: Array<FoundKey> }>;
  readonly aws: Set<string>;
}

const readSmall = (file: string) => {
  try {
    const info = statSync(file);
    return info.isFile() && info.size <= MAX_FILE_BYTES ? readFileSync(file, "utf8") : null;
  } catch {
    return null;
  }
};
const listDir = (dir: string) => {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
};
const isRepo = (dir: string) => existsSync(join(dir, ".git"));

/** Git repositories directly under each root, or one level deeper. */
export const findRepositories = (roots: ReadonlyArray<string>) => {
  const found: Array<string> = [];
  for (const root of roots) {
    if (isRepo(root)) found.push(root);
    for (const entry of listDir(root)) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || SKIP.has(entry.name)) continue;
      const dir = join(root, entry.name);
      if (isRepo(dir)) found.push(dir);
      else
        for (const inner of listDir(dir))
          if (inner.isDirectory() && !inner.name.startsWith(".") && !SKIP.has(inner.name) && isRepo(join(dir, inner.name)))
            found.push(join(dir, inner.name));
      if (found.length >= MAX_REPOS) break;
    }
  }
  return [...new Set(found)].slice(0, MAX_REPOS);
};

const readRepositories = async (watch: Watch, roots: ReadonlyArray<string>, step: (s: string) => void): Promise<Findings> => {
  const vendors = watch.vendors().values();
  const catalog = [...vendors];
  const findings: Findings = { repositories: [], vendors: new Map(), aws: new Set() };
  const found = (vendor: Vendor, where: string) => {
    const entry = findings.vendors.get(vendor.id) ?? { foundIn: new Set<string>(), keys: [] };
    entry.foundIn.add(where);
    findings.vendors.set(vendor.id, entry);
    return entry;
  };
  for (const path of findRepositories(roots)) {
    const name = basename(path);
    step(`Reading ${name}`);
    const remote = await watch.deps.run("git", ["remote", "get-url", "origin"], { cwd: path, timeoutMs: 5000 });
    findings.repositories.push({ path, name, github: remote.code === 0 ? githubRepository(remote.stdout) : null });
    const dirs = [path, ...listDir(path).filter((e) => e.isDirectory() && !e.name.startsWith(".") && !SKIP.has(e.name)).map((e) => join(path, e.name))];
    for (const dir of dirs.slice(0, 40))
      for (const entry of listDir(dir)) {
        if (!entry.isFile() && !entry.isSymbolicLink()) continue;
        const file = join(dir, entry.name);
        const where = `${name}/${relative(path, file)}`;
        if (isManifest(entry.name)) {
          const text = readSmall(file);
          if (text === null) continue;
          const packages = manifestPackages(entry.name, text);
          if (usesAws(packages)) findings.aws.add(where);
          for (const vendor of vendorsInPackages(catalog, packages, entry.name !== "package.json"))
            found(vendor, where);
        } else if (isEnvFile(entry.name)) {
          const text = readSmall(file);
          if (text === null) continue;
          const env = parseEnv(text);
          for (const vendor of vendorsInEnv(catalog, env.keys())) {
            const entryFound = found(vendor, where);
            const keyName = vendor.key?.envNames.find((n) => (env.get(n) ?? "").length >= 8);
            if (keyName === undefined) continue;
            const value = env.get(keyName)!;
            // The same key copied into several files is one access row.
            if (entryFound.keys.some((k) => k.value === value)) continue;
            entryFound.keys.push({
              sourceKey: `env:${hash(`${file}\0${keyName}`)}`,
              source: `${keyName} in ${where}`,
              value,
            });
          }
        }
      }
  }
  return findings;
};

// ---------------------------------------------------------------- the scan

/** Runs a scan. `step` reports what it is doing for the page. */
export const runScan = async (
  watch: Watch,
  roots: ReadonlyArray<string>,
  step: (text: string) => void,
): Promise<Scan> => {
  const previous = watch.store.getKv<Scan | null>("scan", null);
  const findings = await readRepositories(watch, roots, step);
  const services: Array<FoundService> = [];
  const proposed: Array<{ check: Check; title: string; optional: boolean }> = [];
  const define = (
    serviceId: string,
    id: string,
    kind: Check["kind"],
    intent: string,
    config: Record<string, unknown>,
    keyId: string | null,
    cadenceSeconds: number,
  ) =>
    watch.defineCheck({ id, serviceId, kind, intent, config, keyId, cadenceSeconds, origin: "scan" }, "proposed");

  // GitHub: the machine's gh login reads each repository's Actions.
  const repos = [...new Set(findings.repositories.map((r) => r.github).filter((r): r is string => r !== null))];
  if (repos.length > 0) {
    step("Checking the GitHub login");
    const login = await watch.deps.run("gh", ["api", "user", "--jq", ".login"]);
    const works = login.code === 0;
    const access: AccessRow = {
      accessKey: "machine:gh",
      source: works ? `GitHub CLI, logged in as ${login.stdout.trim()}` : "GitHub CLI",
      status: works ? "works" : "failed",
      detail: works ? null : login.missing ? "Install the GitHub CLI and run gh auth login" : "Run gh auth login",
      account: works ? login.stdout.trim() : null,
      warnings: ["personal_token"],
      keyId: null,
      removable: false,
    };
    const perRepo = async (repo: string) => {
      const serviceId = `github:${repo}`;
      const names = findings.repositories.filter((r) => r.github === repo).map((r) => r.name);
      let note: string | null = works ? null : access.detail;
      if (works) {
        step(`Reading Actions for ${repo}`);
        const [info, runs] = await Promise.all([
          watch.deps.run("gh", ["api", `repos/${repo}`, "--jq", ".default_branch"]),
          watch.deps.run("gh", ["api", `repos/${repo}/actions/runs?per_page=1`, "--jq", ".total_count"]),
        ]);
        const branch = info.code === 0 && info.stdout.trim() !== "" ? info.stdout.trim() : "main";
        if (runs.code === 0 && runs.stdout.trim() === "0") note = "No GitHub Actions runs yet";
        else
          proposed.push({
            check: define(serviceId, `${serviceId}:ci`, "github", `CI on ${branch} in ${repo} is passing`, { repo, branch }, null, 900),
            title: repo,
            optional: false,
          });
      }
      const foundIn = names.map((n) => `${n} (git remote)`);
      watch.upsertService({ id: serviceId, vendor: "github", label: repo, target: repo, reachable: works, note, foundIn });
      services.push({ serviceId, vendor: "github", label: repo, foundIn, reachable: works, note, access: [access], addKey: null });
    };
    for (let i = 0; i < repos.length; i += 6) await Promise.all(repos.slice(i, i + 6).map(perRepo));
  }

  // AWS: each CLI profile, grouped by the account it reaches.
  const configFile = process.env.AWS_CONFIG_FILE ?? join(homedir(), ".aws", "config");
  const profiles = parseAwsConfig(readSmall(configFile) ?? "");
  if (profiles.length > 0 || findings.aws.size > 0) {
    step("Trying each AWS profile");
    const results = await Promise.all(
      profiles.map(async (profile) => {
        const result = await watch.deps.run("aws", ["sts", "get-caller-identity", "--profile", profile.name, "--output", "json"]);
        const account = result.code === 0 ? (/"Account"\s*:\s*"(\d{12})"/.exec(result.stdout)?.[1] ?? null) : null;
        return { profile, account, expired: account === null && profile.sso && /expired|sso|token/i.test(result.stderr), missing: result.missing };
      }),
    );
    const accounts = new Map<string, Array<AwsProfile>>();
    for (const r of results) if (r.account !== null) accounts.set(r.account, [...(accounts.get(r.account) ?? []), r.profile]);
    const broken = results.filter((r) => r.account === null);
    const brokenRow: Array<AccessRow> =
      broken.length === 0
        ? []
        : [{
            accessKey: "machine:aws:broken",
            source: `AWS profile${broken.length === 1 ? "" : "s"} ${broken.map((b) => b.profile.name).join(", ")}`,
            status: broken.every((b) => b.expired) ? "expired" : "failed",
            detail: broken.some((b) => b.missing)
              ? "Install the AWS CLI"
              : broken.every((b) => b.expired)
                ? `Sign in again: aws sso login --profile ${broken[0]!.profile.name}`
                : "These profiles could not reach AWS",
            account: null,
            warnings: [],
            keyId: null,
            removable: false,
          }];
    const foundIn = [...findings.aws, ...(profiles.length > 0 ? ["AWS CLI profiles on this machine"] : [])];
    // Profiles that could not sign in get one row of their own, not one per account.
    if (accounts.size === 0 || brokenRow.length > 0) {
      const note = brokenRow[0]?.detail ?? "No AWS login on this machine";
      watch.upsertService({ id: "aws", vendor: "aws", label: "AWS", target: null, reachable: false, note, foundIn });
      services.push({ serviceId: "aws", vendor: "aws", label: "AWS", foundIn, reachable: false, note, access: brokenRow, addKey: null });
    }
    for (const [account, group] of accounts) {
      // Prefer a profile that names a region, since metric checks need one.
      const profile = group.find((p) => p.region !== null) ?? group[0]!;
      const serviceId = `aws:${account}`;
      const label = `AWS account ${account}`;
      const note = profile.region === null ? "Set a region on this profile to watch Lambda errors" : null;
      watch.upsertService({ id: serviceId, vendor: "aws", label, target: account, reachable: true, note, foundIn });
      services.push({
        serviceId, vendor: "aws", label, foundIn, reachable: true, note,
        access: [
          {
            accessKey: `machine:aws:${account}`,
            source: `AWS profile ${profile.name}${group.length > 1 ? `, also ${group.filter((p) => p !== profile).map((p) => p.name).join(", ")}` : ""}`,
            status: "works",
            detail: profile.sso ? "Watch only reads. SSO logins expire; renew with aws sso login" : "Watch only reads",
            account,
            warnings: profile.sso ? ["login_expires"] : [],
            keyId: null,
            removable: false,
          },
        ],
        addKey: null,
      });
      if (profile.region !== null)
        proposed.push({
          check: define(serviceId, `${serviceId}:lambda-errors`, "aws_metric", "No Lambda function errors in the last hour", {
            profile: profile.name, region: profile.region, namespace: "AWS/Lambda", metric: "Errors",
            statistic: "Sum", periodSeconds: 3600, windowSeconds: 3600, comparison: ">", threshold: 0, missingIsOk: true,
          }, null, 900),
          title: label,
          optional: false,
        });
    }
  }

  // Vendors: keys from .env files, keys added on the page, and sign-in vendors.
  const existingKeys = watch.store.allKeys();
  for (const [vendorId, entry] of findings.vendors) {
    const vendor = watch.vendors().get(vendorId)!;
    const serviceId = `vendor:${vendor.id}`;
    const access: Array<AccessRow> = [];
    let working: KeyRecord | null = null;
    if (vendor.key !== undefined) {
      step(`Testing ${vendor.label} keys`);
      for (const found of entry.keys) {
        const warnings: Array<Warning> = [
          ...(vendor.key.personal === true ? (["personal_token"] as const) : []),
          ...(vendor.key.canWrite !== undefined && new RegExp(vendor.key.canWrite).test(found.value) ? (["can_write"] as const) : []),
        ];
        const stored = watch.store.keyBySource(found.sourceKey);
        // A key someone removed stays removed until they add it again.
        if (stored !== null && stored.removedAt !== null) {
          access.push({ accessKey: found.sourceKey, source: found.source, status: "removed", detail: "You removed this key. Add it again with Add key", account: null, warnings, keyId: null, removable: false });
          continue;
        }
        if (stored !== null && stored.removedAt === null) {
          working ??= stored;
          access.push({ accessKey: found.sourceKey, source: found.source, status: "works", detail: null, account: stored.account, warnings, keyId: stored.id, removable: true });
          continue;
        }
        const added = await watch.addKey({ vendor: vendor.id, value: found.value, source: found.source, sourceKey: found.sourceKey, label: `${vendor.label} key` });
        if (added.ok) {
          working ??= watch.store.allKeys().find((k) => k.id === added.key.id) ?? null;
          access.push({ accessKey: found.sourceKey, source: found.source, status: "works", detail: null, account: added.key.account, warnings, keyId: added.key.id, removable: true });
        } else
          access.push({ accessKey: found.sourceKey, source: found.source, status: "failed", detail: added.summary, account: null, warnings, keyId: null, removable: false });
      }
      for (const key of existingKeys.filter((k) => k.vendor === vendor.id && k.removedAt === null && k.sourceKey === null)) {
        working ??= key;
        access.push({ accessKey: `key:${key.id}`, source: `Added on the page, ending ${key.last4}`, status: "works", detail: null, account: key.account, warnings: vendor.key.personal === true ? ["personal_token"] : [], keyId: key.id, removable: true });
      }
    }
    const reachable = working !== null;
    const note = reachable
      ? null
      : vendor.signIn === "oauth"
        ? `Signing in to ${vendor.label} is not built yet`
        : `Add a ${vendor.label} key so Watch can reach it`;
    const foundIn = [...entry.foundIn];
    watch.upsertService({ id: serviceId, vendor: vendor.id, label: vendor.label, target: null, reachable, note, foundIn });
    services.push({
      serviceId, vendor: vendor.id, label: vendor.label, foundIn, reachable, note, access,
      addKey: vendor.key === undefined ? null : { vendor: vendor.id, keyUrl: vendor.key.keyUrl },
    });
    if (working !== null)
      for (const definition of vendor.checks)
        proposed.push({
          check: define(serviceId, `${serviceId}:${definition.id}`, "vendor", definition.intent, { vendor: vendor.id, check: definition.id }, working.id, vendor.cadenceSeconds),
          title: vendor.label,
          optional: definition.type === "fresh" && definition.optional === true,
        });
  }

  step("Running each check once");
  const suggestions: Array<Suggestion> = [];
  for (let i = 0; i < proposed.length; i += 4)
    suggestions.push(
      ...(await Promise.all(
        proposed.slice(i, i + 4).map(async ({ check, title, optional }) => {
          const result = await watch.runner.trial(check);
          const state = watch.store.check(check.id)!.state;
          return {
            checkId: check.id,
            serviceId: check.serviceId,
            title,
            intent: check.intent,
            outcome: result.outcome,
            summary: result.summary,
            state,
            suggested: state === "on" || (state === "proposed" && !optional && result.outcome !== "unknown"),
          };
        }),
      )),
    );

  const scan: Scan = {
    scannedAt: watch.now(),
    roots,
    repositories: findings.repositories.length,
    services: services.toSorted((a, b) => Number(b.reachable) - Number(a.reachable) || a.label.localeCompare(b.label)),
    suggestions,
    appliedAt: previous?.appliedAt ?? null,
  };
  watch.store.setKv("scan", scan);
  return scan;
};

/** Turns ticked checks on and removes unticked keys. */
export const applyScan = async (
  watch: Watch,
  input: { readonly turnOn: ReadonlyArray<string>; readonly removeKeys: ReadonlyArray<string> },
) => {
  const scan = watch.store.getKv<Scan | null>("scan", null);
  if (scan === null) throw new Error("Run setup first");
  const rows = scan.services.flatMap((s) => s.access);
  const removedKeyIds = new Set<string>();
  for (const accessKey of input.removeKeys) {
    const row = rows.find((r) => r.accessKey === accessKey);
    if (row === undefined || !row.removable || row.keyId === null) continue;
    watch.removeKey(row.keyId);
    removedKeyIds.add(row.keyId);
  }
  const turnOn = new Set(input.turnOn);
  const failures: Array<{ id: string; message: string }> = [];
  let turnedOn = 0;
  for (const suggestion of scan.suggestions) {
    const check = watch.store.check(suggestion.checkId);
    if (check === null) continue;
    const usesRemovedKey = check.keyId !== null && removedKeyIds.has(check.keyId);
    if (turnOn.has(check.id) && !usesRemovedKey) {
      if (check.state === "on") {
        turnedOn += 1;
        continue;
      }
      try {
        await watch.setCheck(check.id, "on");
        turnedOn += 1;
      } catch (error) {
        failures.push({ id: check.id, message: error instanceof Error ? error.message : String(error) });
      }
    } else if (check.state === "proposed") watch.store.setCheckState(check.id, "off", watch.now());
    else if (check.state === "on" && !turnOn.has(check.id)) await watch.setCheck(check.id, "pause");
  }
  const states = new Map(watch.store.checks().map((c) => [c.id, c.state]));
  watch.store.setKv("scan", {
    ...scan,
    appliedAt: watch.now(),
    suggestions: scan.suggestions.map((s) => ({ ...s, state: states.get(s.checkId) ?? s.state })),
    services: scan.services.map((s) => ({
      ...s,
      access: s.access.map((a) =>
        a.keyId !== null && removedKeyIds.has(a.keyId)
          ? { ...a, status: "removed" as const, detail: "Removed", keyId: null, removable: false }
          : a,
      ),
    })),
  });
  return { turnedOn, removed: removedKeyIds.size, failures };
};

/** Runs one scan at a time in the background and reports its step. */
export const makeScanner = (watch: Watch, roots: () => ReadonlyArray<string>) => {
  let status: ScanStatus = { running: false, step: null, error: null };
  let current: Promise<Scan> | null = null;
  return {
    status: () => status,
    start: () => {
      if (current !== null) return current;
      status = { running: true, step: "Starting", error: null };
      current = runScan(watch, roots(), (step) => {
        status = { ...status, step };
      })
        .then((scan) => {
          status = { running: false, step: null, error: null };
          return scan;
        })
        .catch((error: unknown) => {
          status = { running: false, step: null, error: error instanceof Error ? error.message : String(error) };
          throw error;
        })
        .finally(() => {
          current = null;
        });
      return current;
    },
  };
};
export type Scanner = ReturnType<typeof makeScanner>;
