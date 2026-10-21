## 1. Why a request got no answer

- [x] 1.1 `src/server/checks/network.ts`, `src/server/checks/http.ts`, `src/server/checks/types.ts`,
      `src/server/checks/vendor.ts`, `src/server/vendors.ts`, `src/server/checks.test.ts`,
      `src/server/testkit.ts`: the reason in words, a mark for what a slow link explains, and a
      longer wait after a held run.

## 2. Holding on a slow link

- [x] 2.1 `src/server/connectivity.ts`, `src/server/connectivity.test.ts`, `src/server/proc.ts`:
      probes timed by a steady clock, the two thresholds with failures on several hosts at once,
      and when a slow spell begins and ends.
- [x] 2.2 `src/server/runner.ts`, `src/server/store.ts`, `src/server/runner.test.ts`: hold what a
      slow link explains as while offline, under the same cap, and run the next one patiently.

## 3. Saying so

- [x] 3.1 `src/server/notices.ts`, `src/server/state.ts`, `src/web/Home.tsx`, `src/web/logic.test.ts`,
      `README.md`: the slow-link line on Home and in the text status, and the README's account.

## 4. Verify

- [x] 4.1 Tests, typecheck, build and `openspec validate add-slow-link-hold --strict`.
- [x] 4.2 Review rounds at high effort, with each finding fixed or declined with a reason: three
      rounds found 15, 11 and 12; 35 fixed, and 3 declined in whole or in part in
      `.wattson/decisions.md`.
- [ ] 4.3 On a scratch Watch with a slowed probe and a check whose connection times out: the run
      is held and Home says the connection is slow; the live Watch restarts briefly with its
      alert settings intact and 22 of 22 checks passing.
