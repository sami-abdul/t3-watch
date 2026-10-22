## 1. The video

- [x] 1.1 `scripts/record-demo.ts`, `package.json`, `pnpm-lock.yaml`, `tsconfig.json`: the recording
      script, with `playwright-core` for development and `scripts/` type-checked.
- [x] 1.2 `docs/demo.mp4`, `docs/demo.gif`, `README.md`: the recorded demo, shown in the README.

## 2. Verify

- [x] 2.1 Tests, typecheck, build and `openspec validate add-demo-video --strict`.
- [x] 2.2 Review rounds at high effort, with each finding fixed or declined with a reason. Three
      rounds found 10, 8 and 7: 24 fixed and 1 declined.
- [x] 2.3 Frames from each scene checked by eye against the script, and no demo process, folder or
      port left after recording. The video runs 60.1 seconds; a recording stopped with SIGINT, and
      another with SIGTERM, left no demo, folder, frames or open port, and the committed video as it
      was.
