## 1. Skeleton

- [x] 1.1 `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `LICENSE`,
      `bin/t3-watch.js`.

## 2. Core

- [x] 2.1 `src/server/config.ts`: home folder, `config.json` with port, host, token, roots and
      alert settings; created on first start.
- [x] 2.2 `src/server/store.ts`: SQLite schema and queries for services, checks, runs, events,
      keys, drafts, notes and the last scan.
- [x] 2.3 `src/server/keys.ts`: AES-256-GCM key store with a per-install key file.
- [x] 2.4 `src/server/vendors.ts` and `catalog/*.json`: description schema, loader, starter
      catalog of about ten vendors.

## 3. Checks

- [x] 3.1 `src/server/checks/*.ts`: `http`, `github`, `aws_metric`, `heartbeat`, `vendor`.
- [x] 3.2 `src/server/runner.ts`: due checks, concurrency 4, runs, change events, pause and snooze.

## 4. Surface

- [x] 4.1 `src/server/http.ts`: token auth, sign-in link, JSON API, heartbeat route, static page.
- [x] 4.2 `src/server/cli.ts`: `start`, `install`, `uninstall`, `url`, `status`.

## 5. Verification

- [x] 5.1 Tests: `src/server/**/*.test.ts` for keys, vendor engine, each check kind, runner events
      and HTTP auth. `pnpm vitest run src/server`.
- [x] 5.2 `pnpm tsc --noEmit`.
- [x] 5.3 `openspec validate add-watch-service --strict`.
