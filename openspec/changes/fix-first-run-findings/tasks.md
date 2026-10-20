## 1. CLI

- [x] 1.1 `src/server/config.ts`, `src/server/cli.ts`, `src/server/mcp-relay.ts`: one helper for
      the local address; `status` uses it.
- [x] 1.2 `src/server/cli.ts`: print the sign-in link only when stdout is a terminal.

## 2. Page

- [x] 2.1 `src/web/ui.tsx`: drop the `m-0` resets that cancel `space-y-*`.
- [x] 2.2 `src/web/client.ts`, `src/web/Home.tsx`: Ask why falls back to showing the question.
- [ ] 2.3 `src/web/client.ts`, `src/web/Details.tsx`, `src/web/app-entry.tsx`: the folder list
      reads `/api/settings`.

## 3. Alerts

- [ ] 3.1 `src/server/alerts.ts`, `src/server/scan.ts`: alert text and CI wording.
- [ ] 3.2 `src/server/alerts.ts`, `src/server/extend.ts`, `src/server/mcp.ts`,
      `src/web/client.ts`, `src/web/Details.tsx`, `src/web/app-entry.tsx`, `README.md`: the page
      makes the signing secret; `watch_set_alerts` refuses one; instructions use
      `request_secret`.

## 4. Checks

- [ ] 4.1 `src/server/checks/github.ts`, `src/server/mcp.ts`, `README.md`: `maxAgeSeconds` on
      `github` checks.

## 5. Verification

- [ ] 5.1 Tests for each server change in `src/server/*.test.ts`; `pnpm test`.
- [ ] 5.2 `pnpm typecheck`; `pnpm build`; `openspec validate fix-first-run-findings --strict`.
- [ ] 5.3 On a running install: `t3-watch status` with a non-loopback host, the page in a
      browser, Make a signing secret, and a GitHub check with `maxAgeSeconds` against a real
      scheduled workflow.
