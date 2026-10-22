## Why

The state the page and the inline view read carries each check's settings as stored: an HTTP
address with a password in it, a token in its path or query string, and a heartbeat's ping token,
with the ping address beside it. The inline view reads that state through `watch_state`, an MCP
tool any client that does not know views lists like any other, so an agent can read it too,
against Watch's rule that a secret never reaches an MCP result.
`watch_check` already leaves out a heartbeat's token but not an address's password. Build 6 kept
secrets out of the sentence that says what a check contacts and kept the rest as a follow-up.

## What Changes

- **Settings without secrets.** The state carries each check's settings with a heartbeat's token
  left out and an address cut to its origin and path, a password, the query string and any part
  that looks like a token shown as "…", the way the target sentence already shows it. The ping
  address leaves the state. `watch_check` gives agents the same settings.
- **The page asks for what it needs.** Edit fetches the check's settings as stored, and a heartbeat
  check's ping address shows when the person asks for it, both from a route that answers only a
  signed-in browser and refuses the agents' token, as Edit and Delete already do. The inline view
  has no Edit and points to the page for the ping address.
- **Drafts still wire jobs.** `watch_draft_check` keeps giving the agent the ping URL of the
  heartbeat check it drafts, which it needs to add the ping to the job.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `watch-service`: shared reads carry check settings without secrets, and the page fetches a
  check's stored settings and ping address on its own.

## Impact

`src/server/targets.ts`, `src/server/state.ts`, `src/server/mcp.ts`, `src/server/http.ts`,
`src/web/client.ts`, `src/web/app-entry.tsx`, `src/web/logic.ts`, `src/web/Details.tsx`, with tests.
No migration: stored settings do not change, only what each read shows of them.
