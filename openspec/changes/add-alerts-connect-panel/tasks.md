## 1. Test alerts

- [x] 1.1 `src/server/alerts.ts`, `src/server/chat.test.ts`: `sendTestAlert` sends a signed
      `watch.test` event, keeps the last result and spaces tests 10 seconds apart; a new secret or
      address clears the result; change events and tests share the signing.
- [x] 1.2 `src/server/extend.ts`, `src/server/http.ts`, `src/server/chat.test.ts`:
      `POST /api/alerts/test` for the access token, or a signed-in page from its own origin.
- [x] 1.3 `src/server/mcp.ts`, `src/server/chat.test.ts`: `watch_test_alert`; `watch_alerts` and
      `watch_set_alerts` name the host only; the instructions call the test after
      `watch_set_alerts`.
- [x] 1.4 `src/server/cli.ts`, `src/server/cli.test.ts`, `README.md`: `t3-watch alerts` and
      `t3-watch alerts test`.

## 2. The page

- [x] 2.1 `src/server/state.ts`, `src/web/logic.ts`, `src/web/logic.test.ts`: the state carries
      `on`, `host`, `signed` and `lastTest`, never the address; the panel's step states.
- [x] 2.2 `src/web/Alerts.tsx`, `src/web/Details.tsx`, `src/web/client.ts`,
      `src/web/app-entry.tsx`: the three-step panel on the page and in the chat view.
- [x] 2.3 `src/web/Home.tsx`, `src/web/App.tsx`: Home's notice when alerts are off or the last
      test was not accepted, opening the panel.

## 3. Verify

- [x] 3.1 Tests, typecheck, build and `openspec validate add-alerts-connect-panel --strict`.
- [x] 3.2 Review rounds at high effort, with each finding fixed or declined with a reason: three
      rounds found 10, 10 and 8; 27 fixed, 1 declined in `.wattson/decisions.md`.
- [x] 3.3 On Leviathan after a short restart: the panel in a browser, a test alert from the page
      accepted and reported by `t3-watch alerts`, and 22 of 22 checks passing. `t3-watch alerts test`
      is proven on a scratch Watch, so the live thread wakes once.
