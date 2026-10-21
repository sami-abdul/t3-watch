## 1. Provider homes

- [x] 1.1 `src/server/providers.ts`, `src/server/providers.test.ts`: the default homes plus each
      enabled T3 Claude Code and Codex instance's home, once each, with the reason for every
      instance left out.
- [x] 1.2 `src/server/proc.ts`: extra environment variables for the CLI `runProc` runs.
- [x] 1.3 `src/server/cli.ts`, `src/server/providers.test.ts`, `src/server/cli.test.ts`:
      `install --all` and `uninstall --all` register and remove the server in each home, one home
      at a time; plain `install` hints at `--all`; unknown flags are refused.
- [x] 1.4 `README.md`: `install --all` for T3 Code with more than one provider account.

## 2. Verify

- [x] 2.1 Tests, typecheck, build and `openspec validate add-install-all-providers --strict`.
- [x] 2.2 Review rounds at high effort, with each finding fixed or declined with a reason: three
      rounds found 8, 10 and 8; 25 fixed, 1 declined in `.wattson/decisions.md`. The scratch run
      after them found two more, a missing home and a multi-line error, both fixed.
- [x] 2.3 The real `claude` and `codex` CLIs register Watch in scratch homes from a scratch T3
      settings file, an inherited `CLAUDE_CONFIG_DIR` among them, and remove it again; the live
      Watch restarts briefly with its alert settings intact and 22 of 22 checks passing.
