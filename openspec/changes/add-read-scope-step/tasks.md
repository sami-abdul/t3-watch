## 1. What Watch reads

- [x] 1.1 `src/server/config.ts`, `src/server/config.test.ts`: `reads`, kept only as booleans, with
      everything allowed when it is missing.
- [x] 1.2 `src/server/scan.ts`, `src/server/app.ts`, `src/server/cli.ts`, `src/server/scan.test.ts`:
      the scan skips the GitHub CLI, AWS profiles or `.env` files when they are not allowed, and a
      preview of the folders and logins.
- [x] 1.3 `src/server/extend.ts`, `src/server/mcp.ts`, `src/server/http.ts`, `src/server/state.ts`,
      `src/server/chat.test.ts`: `/api/setup` to read the choice and, from the page alone, save it;
      `watch_sources`; a new install scans only once the person has chosen; turning a login off
      pauses its checks until it is turned on again.

## 2. The page

- [x] 2.1 `src/web/Setup.tsx`, `src/web/client.ts`, `src/web/app-entry.tsx`: the step, with
      ticks for folders and logins, a folder to add, and Scan these; read-only in the chat view.
- [x] 2.2 `src/web/App.tsx`, `src/web/Home.tsx`, `README.md`: the step comes before the first
      scan and before Add services.

## 3. Verify

- [x] 3.1 Tests, typecheck, build and `openspec validate add-read-scope-step --strict`.
- [x] 3.2 Review rounds at high effort, with each finding fixed or declined with a reason: three
      rounds found 10 each; 28 fixed, 2 declined in `.wattson/decisions.md`.
- [ ] 3.3 In a browser on a scratch Watch: the step lists folders and logins, an unticked login is
      not read, and the review follows; the live Watch restarts briefly with its alert settings
      intact and 22 of 22 checks passing.
