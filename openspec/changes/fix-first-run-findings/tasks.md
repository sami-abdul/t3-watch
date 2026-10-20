## 1. CLI

- [x] 1.1 `src/server/config.ts`, `src/server/cli.ts`, `src/server/mcp-relay.ts`: one helper for
      the local address; `status` uses it.
- [x] 1.2 `src/server/cli.ts`: print the sign-in link only when stdout is a terminal.

## 2. Page

- [x] 2.1 `src/web/ui.tsx`: drop the `m-0` resets that cancel `space-y-*`.
- [x] 2.2 `src/web/client.ts`: Ask why falls back to showing the question.
- [x] 2.3 `src/web/client.ts`, `src/web/Details.tsx`, `src/web/app-entry.tsx`: the folder list
      reads `/api/settings`.

## 3. Alerts

- [x] 3.1 `src/server/alerts.ts`, `src/server/scan.ts`: alert text and CI wording.
- [x] 3.2 `src/server/alerts.ts`, `src/server/extend.ts`, `src/server/mcp.ts`,
      `src/web/client.ts`, `src/web/Details.tsx`, `src/web/app-entry.tsx`, `README.md`: the page
      makes the signing secret; `watch_set_alerts` refuses one; instructions use
      `request_secret`.

- [x] 3.3 `src/server/mcp.ts`, `src/server/chat.test.ts`: `watch_home` puts its summary in the
      structured content as well as the text.

## 4. Checks

- [x] 4.1 `src/server/checks/github.ts`, `src/server/mcp.ts`, `README.md`: `maxAgeSeconds` on
      `github` checks.

## 5. Review follow-ups

- [x] 5.1 `src/server/checks/github.ts`, `src/server/checks.test.ts`, `src/server/mcp.ts`,
      `README.md`: `maxAgeSeconds` needs `workflow`, so another workflow's success cannot hide a
      stalled schedule.
- [x] 5.2 `src/server/mcp.ts`, `src/server/chat.test.ts`: `watch_set_alerts` reads `secret: null`
      as no secret.
- [x] 5.3 `src/web/Details.tsx`: replacing a secret while alerts are on asks first.
- [x] 5.4 `src/server/cli.ts`, `src/server/mcp.ts`, `README.md`: `install` never prints the token;
      the agent instructions say never to fetch the sign-in link.
- [x] 5.5 `src/server/http.ts`, `src/server/extend.ts`, `src/server/chat.test.ts`: the secret
      route takes only the page's signed-in session from the page's own origin.
- [x] 5.6 `src/server/config.ts`, `src/server/config.test.ts`: `localUrl` accepts a bracketed
      IPv6 host.
- [x] 5.7 `src/web/Details.tsx`: the folder list shows a load error instead of falling back.
- [x] 5.8 `src/server/mcp.ts`: every structured result carries the text summary.
- [x] 5.9 `src/server/checks/github.ts`, `src/server/checks.test.ts`: with `maxAgeSeconds`, finished
      runs that were all skipped or cancelled fail as stale.
- [x] 5.10 `src/server/config.ts`, `src/server/config.test.ts`: `loadConfig` strips IPv6 brackets
      so `listen` gets a plain address.
- [x] 5.11 `src/server/cli.ts`: the install hint names the node binary install used, quoted.
- [x] 5.12 `src/server/http.ts`, `src/server/extend.ts`, `src/server/chat.test.ts`: the page check
      accepts a forwarding proxy's host, and its comment states what it does not stop.
- [x] 5.13 `src/web/Details.tsx`: the folder list retries on each refresh until it loads.
- [x] 5.14 `src/web/Details.tsx`: the replace prompt clears when alerts turn off.
- [x] 5.15 `src/web/Details.tsx`: the replace prompt resets, rather than hides, when alerts go off.
- [x] 5.16 `src/server/checks/github.ts`, `src/server/checks.test.ts`: with no success in the runs
      read, fail only when those runs reach back past `maxAgeSeconds`.
- [x] 5.17 `src/server/http.ts`, `src/server/chat.test.ts`: drop the X-Forwarded-Host trust;
      `publicUrl` names a proxy's origin.
- [x] 5.18 `src/web/Details.tsx`: a late folder-list reply cannot overwrite a newer one.
- [x] 5.19 `src/server/cli.ts`, `src/server/cli.test.ts`: the systemd unit and the printed commands
      quote their paths.
- [x] 5.20 `src/server/config.ts`: one helper strips IPv6 brackets.

## 6. Verification

- [x] 6.1 Tests for each server change in `src/server/config.test.ts`, `src/server/chat.test.ts`,
      `src/server/scan.test.ts` and `src/server/checks.test.ts`; `pnpm test`.
- [x] 6.2 `pnpm typecheck`; `pnpm build`; `openspec validate fix-first-run-findings --strict`.
- [x] 6.3 On a running install: `t3-watch status` with a non-loopback host, the page in a
      browser, Make a signing secret, and a GitHub check with `maxAgeSeconds` against a real
      scheduled workflow.
