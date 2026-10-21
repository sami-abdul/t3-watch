## 1. The service

- [x] 1.1 `src/server/edits.ts`, `src/server/edits.test.ts`, `src/server/store.ts`,
      `src/server/app.ts`, `src/server/extend.ts`: edit a check that is on or paused, checked
      against its kind and the version the form opened on; delete one, keeping its runs and
      changes and letting go of the login choice's hold; restore one, paused; other actions refuse
      a deleted check.
- [x] 1.2 `src/server/http.ts`, `src/server/http.test.ts`: the edit, delete and restore routes,
      for a signed-in browser on the page only; a deleted heartbeat's ping address stops answering.
- [x] 1.3 `src/server/scan.ts`, `src/server/scan.test.ts`, `src/server/state.ts`,
      `src/server/drafts.ts`, `src/server/mcp.ts`, `src/server/notices.ts`, `src/server/alerts.ts`:
      a rescan skips deleted checks, even one deleted while it runs, and keeps edited ones; the
      review and apply leave deleted checks out; their unsent changes wait; a draft never reuses
      a deleted check's id, and no note lands on one.

## 2. The page

- [x] 2.1 `src/web/client.ts`, `src/web/app-entry.tsx`, `src/web/logic.ts`, `src/web/logic.test.ts`,
      `src/web/Details.tsx`, `src/web/App.tsx`, `README.md`: Edit and Delete on each check in
      Details, Deleted checks with History and Restore, none of it in the chat view.

## 3. Verify

- [x] 3.1 Tests, typecheck, build and `openspec validate add-check-edit-delete --strict`.
- [x] 3.2 Review rounds at high effort, with each finding fixed or declined with a reason: three
      rounds found 10, 15 and 6; 29 fixed, and 2 declined in whole or in part in
      `.wattson/decisions.md`.
- [ ] 3.3 In a browser on a scratch Watch: edit a check and see it run with the new settings,
      delete one and restore it with its history; the live Watch restarts briefly with its alert
      settings intact and 22 of 22 checks passing.
