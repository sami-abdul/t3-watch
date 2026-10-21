## 1. The project

- [x] 1.1 `src/server/project.ts`, `src/server/project.test.ts`, `src/server/providers.ts`, whose
      T3 data folder lookup it shares: the workspace folder, its two notes written once, Watch's
      project found in T3's database, and `t3 project add` with each outcome said plainly.
- [x] 1.2 `src/server/cli.ts`, `src/server/cli.test.ts`: `install` adds the project, and takes
      `--no-project`; `uninstall` leaves it and says so.
- [x] 1.3 `README.md`: the Watch thread lives in its own project.

## 2. Verify

- [x] 2.1 Tests, typecheck, build and `openspec validate add-watch-project --strict`.
- [x] 2.2 Review rounds at high effort, with each finding fixed or declined with a reason: three
      rounds found 10, 7 and 9; 25 fixed, 1 declined in part in `.wattson/decisions.md`.
- [ ] 2.3 The real `t3` CLI adds the project to a scratch T3 data folder, once, and T3's own
      database lists it; the live Watch restarts briefly with its alert settings intact and 22 of
      22 checks passing.
