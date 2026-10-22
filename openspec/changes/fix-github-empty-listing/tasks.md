## 1. The hold

- [x] 1.1 `src/server/checks/github.ts`: an empty list on a check whose recent runs listed some reads
      as GitHub's, marked to hold.
- [x] 1.2 `src/server/runner.ts`, `src/server/checks/types.ts`, `src/server/connectivity.ts`,
      `src/server/store.ts`: the runner holds such a result for up to an hour, with its own reason
      in the history.
- [x] 1.3 Tests in `src/server/checks.test.ts` and `src/server/runner.test.ts`, from a fixture of an
      empty list after runs.

## 2. Verify

- [x] 2.1 Tests, typecheck, build and `openspec validate fix-github-empty-listing --strict`.
- [x] 2.2 Review rounds at high effort, with each finding fixed or declined with a reason. Three
      rounds found 9, 9 and 8, and the round 2 fixes' tests found 1 more: 13 fixed and 14 declined
      in `.wattson/decisions.md`.
- [ ] 2.3 The live Watch restarts briefly with its alert settings intact and 21 of 22 checks passing.
