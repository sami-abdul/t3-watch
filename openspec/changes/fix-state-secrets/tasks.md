## 1. Settings without secrets

- [x] 1.1 `src/server/targets.ts`, `src/server/state.ts`, `src/server/mcp.ts`: settings without
      secrets in the state and `watch_check`, and no ping address in the state.
- [x] 1.2 `src/server/http.ts`: a page-only route for a check's stored settings and ping address.
- [x] 1.3 `src/web/client.ts`, `src/web/app-entry.tsx`, `src/web/logic.ts`, `src/web/Details.tsx`:
      Edit and the ping address fetch them on the page.
- [x] 1.4 Tests in `src/server/state.test.ts`, `src/server/http.test.ts`, `src/server/chat.test.ts`
      and `src/web/logic.test.ts`.

## 2. Verify

- [x] 2.1 Tests, typecheck, build and `openspec validate fix-state-secrets --strict`.
- [ ] 2.2 Review rounds at high effort, with each finding fixed or declined with a reason. Paused on
      22 October for the account's budget, before the first round; all three still to run.
- [x] 2.3 On a scratch Watch in a browser: Edit keeps a stored password, the ping address shows on
      request, and `watch_home` carries no token; then the live Watch restarts briefly with its
      alert settings intact. Checked on the live Watch instead, since its page assets were already
      rebuilt: it answered again 0.4 s after the restart with signed alerts intact; Details shows no
      ping address until Ping address is pressed, then shows it; Edit opens from the stored
      settings. Tests cover a stored password surviving Edit, the route refusing the agents' token,
      and `watch_state`, `watch_home` and `watch_check` carrying no secret.
