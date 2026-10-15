## Why

A small team's breaks hide in the joins: a rotated key, a CI that went red on a branch nobody
watches, a nightly job that stopped running, a vendor that started returning 401. Uptime tools
see URLs, not these. An agent could check them, but an agent checking on a timer costs tokens on
every tick and gives a different answer each time. The checks need to be cheap, deterministic and
always on, so an agent is only involved when something changed.

## What Changes

- A Node service, `t3-watch`, that runs on the machine that stays on. It keeps its state in one
  SQLite file under `~/.t3-watch` (or `T3_WATCH_HOME`).
- **Check kinds as code:** HTTP (status and optional text), GitHub Actions through the `gh` CLI,
  AWS CloudWatch metrics through the `aws` CLI, heartbeats (a job pings a URL), and vendor checks
  driven by a vendor description.
- **Vendors as data:** one JSON file per vendor in `catalog/`, saying how to spot it in a
  project, which variable names hold its key, how to send the key, which read-only call proves the
  key works, and which checks to offer. A starter catalog of about ten vendors ships. The engine
  only sends GET requests to the description's API origin.
- **Keys encrypted at rest** with a per-install key file. No route, log or result returns a
  value.
- **A scheduler** that runs approved checks on their cadence, records each run, and records a
  change event when a check moves between passing, failing and unknown. Checks can be paused,
  and snoozed until a time.
- **An HTTP API** on 127.0.0.1 (configurable) guarded by an access token, plus an unauthenticated
  heartbeat route that accepts only a check's own heartbeat token.
- **A CLI:** `t3-watch start` runs the service in the foreground; `t3-watch install` makes it a
  user service (systemd on Linux, launchd on macOS), registers its MCP endpoint with Codex and
  Claude Code when their CLIs exist, and prints the page address; `t3-watch uninstall` undoes it;
  `t3-watch url` prints a sign-in link.

## Capabilities

### New Capabilities

- `watch-service`: storage, keys, the vendor engine and catalog, check kinds, the scheduler, the
  HTTP API and the CLI.

## Impact

New repository layout: `src/server/**`, `catalog/*.json`, `bin/t3-watch.js`, `package.json`,
`tsconfig.json`, `vitest.config.ts`, `README.md`, `LICENSE`.

Non-goals: OAuth sign-in vendors, browser flows, Postgres checks, multi-machine sync and hosted
accounts.
