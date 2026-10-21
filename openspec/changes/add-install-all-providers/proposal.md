## Why

`install` registers Watch's MCP server in the default Claude Code and Codex homes only. T3 Code
runs agents from several homes at once, one per provider instance, such as a second Claude
account in `~/.claude-night`. A Watch thread on any of those has no Watch tools until someone
registers the server there by hand, as HQ did for one account on 2026-10-20.

## What Changes

- **`install --all`.** Besides the default homes, `install --all` reads T3's settings and adds
  the MCP server to every enabled Claude Code and Codex instance's home, with
  `CLAUDE_CONFIG_DIR` or `CODEX_HOME` set as T3 sets them and T3's own binary when the instance
  names one. Each home is registered once. Instances Watch cannot register with, or that are
  turned off, are listed with the reason. Without T3 it registers the default homes and says so.
- **`uninstall --all`** removes the server from the same homes.
- **A hint.** Plain `install` says how many more provider homes T3 runs and to use `--all`.
- `runProc` takes extra environment variables for the CLI it runs.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `watch-service`: install and uninstall across T3's provider homes.

## Impact

A new `src/server/providers.ts` and `src/server/providers.test.ts`; `src/server/cli.ts`,
`src/server/proc.ts` and `README.md`. Nothing changes for people who do not pass `--all`, apart
from the hint.
