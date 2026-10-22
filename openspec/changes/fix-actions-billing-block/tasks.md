## 1. The GitHub check

- [x] 1.1 `src/server/checks/github.ts`, `src/server/checks.test.ts`: read a failed run's jobs and
      the annotations of a job that never started; say plainly when GitHub refused it for billing,
      as a check that could not run; real failures first; an unreadable answer says it could not
      tell; a stale schedule still fails; each run read once.
- [x] 1.2 `src/server/runner.test.ts`: a repository blocked on billing alerts once, not on every
      push, and a recovery after it alerts as usual.

## 2. Verify

- [x] 2.1 Tests, typecheck, build and `openspec validate fix-actions-billing-block --strict`.
- [x] 2.2 Review rounds at high effort, with each finding fixed or declined with a reason. Three
      rounds found 11, 9 and 10: 28 fixed, 1 fixed in part and 1 declined.
- [x] 2.3 Against the real blocked run with the real gh, then live: the Watch restarts briefly with
      its alert settings intact and its checks passing, and the blocked repository's check reads
      "GitHub didn't run CI: Actions is blocked on billing". The real gh read the run's jobs and
      annotation once, then only the list of runs. Live from 02:44 UTC on 22 October after a
      restart of about a second, with signed alerts intact; at 02:54 UTC the check read so, under
      Could not run, with the other 21 passing, and its one change, from failed, was accepted by
      the webhook.
