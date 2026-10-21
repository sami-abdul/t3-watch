## Why

Set up Watch starts reading at once: every git repository under a list of folders the person
never saw, the `.env` files in them, the GitHub CLI login and every AWS CLI profile. Someone who is
not Sami wants to see and decide what Watch may read before it reads anything, and to change it
before a rescan.

## What Changes

- **What Watch may read.** Before the first scan, and before each Add services, the page shows
  the folders Watch would read, each with how many repositories it holds, and three logins: the
  GitHub CLI, AWS CLI profiles, and keys in `.env` files. Each is a tick, all ticked to begin with,
  and the person can add a folder. Scan these saves the choice and scans only what is ticked.
- **The choice is kept.** `config.json` gains `reads`, with `github`, `aws` and `envFiles`; an
  install without it reads everything, as today. Rescans, `watch_scan` and the chat view use the
  saved choice. The chat view shows it, with a button to the page to change it.
- **For agents.** A read-only MCP tool, `watch_sources`, says what Watch may read.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `setup-scan`: the scan reads only the folders and logins the person allowed.
- `watch-page`: the step before the scan.
- `watch-chat`: `watch_sources`, and the step shown read-only in the chat view.

## Impact

`src/server/config.ts`, `src/server/scan.ts`, `src/server/app.ts`, `src/server/cli.ts`,
`src/server/extend.ts`, `src/server/mcp.ts`, `src/web/client.ts`, `src/web/app-entry.tsx`,
`src/web/Setup.tsx`, `src/web/App.tsx`, `src/web/Home.tsx`, `README.md`, and tests in
`src/server/config.test.ts`, `src/server/scan.test.ts` and `src/server/chat.test.ts`.
