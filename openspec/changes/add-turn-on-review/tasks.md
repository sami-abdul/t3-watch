## 1. Targets

- [x] 1.1 `src/server/targets.ts`, `src/server/targets.test.ts`: a plain sentence for what each
      kind of check contacts, with no secret in it.
- [x] 1.2 `src/server/scan.ts`, `src/server/state.ts`, `src/server/mcp.ts`, `src/server/targets.test.ts`:
      the state carries each check's target and each suggestion's target and cadence;
      `watch_scan` gives them to agents.

## 2. The page

- [x] 2.1 `src/web/logic.ts`, `src/web/logic.test.ts`, `src/web/Setup.tsx`, `src/web/App.tsx`,
      `src/server/scan.test.ts`: targets on suggested checks, and the list of everything Watch
      these changes, checks turned on, paused and keys removed, before it does; a running check
      whose key is removed pauses.
- [x] 2.2 `src/web/Details.tsx`: each check's target.

## 3. Verify

- [x] 3.1 Tests, typecheck, build and `openspec validate add-turn-on-review --strict`.
- [x] 3.2 Review rounds at high effort, with each finding fixed or declined with a reason: three
      rounds found 9, 10 and 10; 28 fixed, 1 declined as a follow-up in `.wattson/decisions.md`.
- [x] 3.3 In a browser on a scratch Watch: the review shows targets, Watch these lists what it
      turns on first, and Back changes nothing; the live Watch restarts briefly with its alert
      settings intact and 22 of 22 checks passing.
