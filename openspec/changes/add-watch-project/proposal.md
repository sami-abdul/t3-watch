## Why

The README tells people to make a thread named Watch somewhere in T3 Code. Most will make it
inside a repository's project, where the thread inherits that repository's hooks, skills and
memory, and where its agent is one step from editing that code. Watch's thread wants a quiet
place of its own.

## What Changes

- **A Watch project.** `install` makes a folder for the Watch thread, outside Watch's own data,
  holding only an `AGENTS.md` and a `CLAUDE.md` that say what the folder is for. It adds the
  folder to T3 Code as a project named Watch with `t3 project add`. A Watch project T3 already
  has, found by its folder or by Watch's note in it and read from T3's own database, is left as
  it is, and so are those two files once they are there.
- **Clear outcomes.** Without the `t3` CLI, install says T3 Code was not found and goes on.
  `install --no-project` skips the step. `uninstall` leaves the project and its threads, and says
  how to remove it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `watch-service`: install adds a Watch project to T3 Code.

## Impact

A new `src/server/project.ts` and `src/server/project.test.ts`; `src/server/cli.ts`,
`src/server/cli.test.ts` and `README.md`. The folder lives in the platform's data folder:
`~/.local/share/t3-watch/workspace` on Linux, or under `XDG_DATA_HOME`, and
`~/Library/Application Support/t3-watch/workspace` on macOS.
