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
- [x] 2.3 The live Watch restarts briefly with its alert settings intact and 21 of 22 checks passing.
      It answered 0.4 s after the restart at 16:24 UTC on 22 October, and signed alerts kept
      delivering. GitHub's dips went on, so 19 of 22 passed: of the four CI checks HQ had snoozed
      during them and the worker resumed on the new code, two held an empty list on their first run
      and again at 16:40 with no change event, one kept passing, and one listed its runs and sent a
      recovery alert, as the old code had left it at "No finished runs yet". A fifth repository's
      pending dip cleared. Asked directly at 16:41, GitHub listed the runs of all four.

## 3. Release

- [ ] 3.1 Release 0.5.1 to npm, `package.json` and `server.json`, with the README saying how Watch
      holds GitHub's empty lists, after one review round at high, and move the MCP Registry entry
      to it.
- [ ] 3.2 A clean install of the published package starts, and the registry lists 0.5.1 as latest.
