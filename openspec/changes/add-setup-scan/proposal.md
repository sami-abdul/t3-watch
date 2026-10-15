## Why

Monitoring tools fail at the first step: they ask you to register every service by hand. The
projects and logins on a developer's machine already say what they run: package manifests name
the vendors, `.env` files hold their keys, git remotes name the repositories, and the `gh` and
`aws` CLIs are logged in. Setup should read all of that and show one page to approve.

## What Changes

- A scan reads every git repository under the configured root folders (two levels deep), their
  direct subfolders, `package.json`, `requirements*.txt`, `pyproject.toml`, the variable names in
  `.env` files, and the `origin` remote. It skips `node_modules`, `.git`, build output, virtual
  environments and nested worktrees.
- It matches what it read against the vendor catalog and tests access with one read each: the
  `gh` login, each AWS CLI profile (grouped by the account it reaches), and each catalog key found
  in a `.env` file. A working key is stored encrypted; its value never leaves the service.
- For each reachable service it proposes checks from the catalog and runs each once, so the
  review shows real results before anything is on.
- The review lists access, then checks, with ticks. Applying turns ticked checks on and removes
  keys the user unticked. A removed key stays removed on later scans until it is added again.
  Checks the user left off stay off on later scans.
- Rescans are idempotent: stable ids per vendor and target, nothing duplicated.
- Warnings, not gates: personal tokens, keys that can write (a Stripe secret key), and AWS SSO
  logins that expire.

## Capabilities

### New Capabilities

- `setup-scan`: finding services, testing access, proposing and trial-running checks, review and
  apply.

## Impact

New `src/server/scan.ts`, `src/server/scan.test.ts`; API routes `POST /api/scan`,
`POST /api/apply`, `POST /api/keys` in `src/server/http.ts`.
