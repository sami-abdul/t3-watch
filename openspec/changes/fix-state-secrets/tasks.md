## 1. Settings without secrets

- [x] 1.1 `src/server/targets.ts`, `src/server/state.ts`, `src/server/mcp.ts`: settings without
      secrets in the state and `watch_check`, and no ping address in the state.
- [x] 1.2 `src/server/http.ts`: a page-only route for a check's stored settings and ping address.
- [x] 1.3 `src/web/client.ts`, `src/web/app-entry.tsx`, `src/web/logic.ts`, `src/web/Details.tsx`:
      Edit and the ping address fetch them on the page.
- [x] 1.4 Tests in `src/server/targets.test.ts`, `src/server/http.test.ts`, `src/server/chat.test.ts`
      and `src/web/logic.test.ts`.

## 2. The independent review of 05f0d89

- [x] 2.0 Each finding checked before its fix, with a test that fails without it:
      `src/server/http.ts` and `src/server/http.test.ts`, every answer carrying a check without
      secrets; `src/server/state.ts`, `src/web/Home.tsx` and `src/server/chat.test.ts`, vendor
      drafts as name, origin and test; `src/server/targets.ts` and `src/server/targets.test.ts`,
      only safe path parts; `src/server/http.ts`, `src/web/client.ts` and `src/server/http.test.ts`,
      the settings route as a POST; `src/server/http.ts`, `src/web/logic.ts`, `src/web/Details.tsx`
      and `src/web/logic.test.ts`, one read with its version.

## 3. Verify

- [x] 3.1 Tests, typecheck, build and `openspec validate fix-state-secrets --strict`.
- [x] 3.2 Review rounds at high effort, with each finding fixed or declined with a reason. Paused on
      22 October for the account's budget, before the first round, and run after the independent
      review's findings were fixed, on the whole change since c32feb2: three rounds found 7, 10 and
      10, 20 fixed and 7 declined in `.wattson/decisions.md`.
- [x] 3.3 On a scratch Watch in a browser: Edit keeps a stored password, the ping address shows on
      request, and `watch_home` carries no token; then the live Watch restarts briefly with its
      alert settings intact. Checked on the live Watch instead, since its page assets were already
      rebuilt: it answered again 0.4 s after the restart with signed alerts intact; Details shows no
      ping address until Ping address is pressed, then shows it; Edit opens from the stored
      settings. Tests cover a stored password surviving Edit, the route refusing the agents' token,
      and `watch_state`, `watch_home` and `watch_check` carrying no secret.
- [ ] 3.4 Release 0.4.1 to npm, `package.json` and `server.json`, and check it from the registry.
- [ ] 3.5 Move the MCP Registry entry to 0.4.1 and confirm it in the registry's search; restart the
      live Watch briefly with signed alerts intact and 21 of 22 checks passing.
