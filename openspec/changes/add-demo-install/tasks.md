## 1. The demo

- [x] 1.1 `src/server/demo.ts`, `src/server/demo.test.ts`: canned answers for every command and
      request, and the sample products, checks, history, draft, scan and alerts.
- [x] 1.2 `src/server/cli.ts`: `t3-watch demo`, with `--port`, in a new folder on 127.0.0.1, with a
      sign-in link, removing its folder however it stops; `start` and the demo serve the same way.
- [x] 1.3 `src/server/app.ts`, `src/server/scan.ts`, `src/server/alerts.ts`, `src/server/extend.ts`,
      `src/server/http.ts`, `src/server/http.test.ts`, `src/server/vendors.ts`: a sample Watch
      refuses keys, secrets, scans and changes to what it reads; its cookie and sign-in words are
      its own; the catalog loads from any folder name.

## 2. README

- [x] 2.1 `README.md`, `docs/home.png`, `docs/checks.png`, `docs/details.png`: how to run the demo,
      and screenshots of it.

## 3. Verify

- [x] 3.1 Tests, typecheck, build and `openspec validate add-demo-install --strict`.
- [x] 3.2 Review rounds at high effort, with each finding fixed or declined with a reason: three
      rounds found 11, 15 and 8; 33 fixed, 1 declined in `.wattson/decisions.md`.
- [ ] 3.3 The built demo serves the sample page, makes no outside request and leaves no folder
      once stopped; the live Watch restarts briefly on the new `start` with its alert settings
      intact and 22 of 22 checks passing.
- [ ] 3.4 Release 0.3.0 to npm, so the README's `npx @lfg-labs/t3-watch demo` runs the demo, and
      check it from the registry.
