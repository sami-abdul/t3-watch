## Why

On 22 October Sami approved recording the 60-second demo from the launch brief: on the demo
install, with sample data only and nothing from a real Watch, shown in the README. A video says in
a minute what the three screenshots leave out: Watch noticing a failure, the agent's note on it,
turning on a check the agent wrote, and signed alerts. Recorded by hand, it would go stale with the
next change to the page, so a script records it from the demo and can record it again.

## What Changes

- **A recording script.** `scripts/record-demo.ts` starts this checkout's demo, the same program
  `npx @lfg-labs/t3-watch demo` runs, drives the page in Chrome through the brief's eight scenes
  with a caption for each, and captures the frames Chrome paints. ffmpeg turns them into
  `docs/demo.mp4` and `docs/demo.gif`, the GIF with fewer frames and colours so it can play at the
  top of the README. The terminal scenes show the demo's real output,
  typed into a page drawn as a terminal. The script stops the demo, which removes its folder, and
  touches no other Watch.
- **In the README.** Under "Try it first", the GIF plays in place and links to the MP4.
- **Tooling.** `playwright-core` becomes a development dependency; Chrome and ffmpeg come from the
  machine, and the script names what is missing. `tsconfig.json` type-checks `scripts/`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `watch-service`: the README carries a recorded demo, and the repository can record it again.

## Impact

`scripts/record-demo.ts`, `docs/demo.mp4`, `docs/demo.gif`, `README.md`, `package.json`,
`pnpm-lock.yaml` and `tsconfig.json`. Nothing in the package changes; `docs/` and `scripts/` are
not published to npm.
