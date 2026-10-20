## Why

A fresh install on a second always-on machine, followed by a first run through the page, turned
up problems the tests did not catch. Some are cosmetic, one leaks the page's access token into
logs, and one is how the Mac mini install's alert signing secret ended up in a chat transcript:
the agent instructions told the agent to make the secret and pass it as a tool argument, and tool
arguments are part of the transcript. A scheduled GitHub workflow that GitHub skipped for eleven
hours also showed as passing, because the GitHub check reads only the latest run's result.

## What Changes

- `t3-watch status` asks the address Watch listens on, so it works when Watch is bound to a
  tailnet address rather than 127.0.0.1.
- `t3-watch start` and `install` print the sign-in link only to a terminal. Under systemd, launchd
  or an agent's shell they say to run `t3-watch url` instead, so the token stays out of logs and
  transcripts.
- The page keeps its vertical spacing: headings and text no longer carry a margin reset that
  overrides `space-y-*`.
- Ask why shows the question on the page when the browser has no clipboard, as on a plain-HTTP
  tailnet address, instead of failing silently.
- Alerts read cleanly: "Watch check failed: example/api: CI on main is passing. ..." rather than
  "... is passing is failing". Setup words its CI checks "CI on main is passing" because the
  service label already names the repository.
- The alert signing secret is made by Watch on the page (Details, Alerts, Make a signing secret)
  and shown once. `watch_set_alerts` refuses a secret. The agent instructions use T3's
  `request_secret` so the person pastes the secret into a private card, and `signature.secretRef`
  on the webhook task, so the secret never enters a transcript.
- A `github` check can take `maxAgeSeconds`: it then also fails when the newest successful run is
  older than that, which catches a scheduled workflow that stopped running.
- The Details folder list shows the configured folders, not the folders of the last scan.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `watch-service`: status and sign-in output; GitHub freshness.
- `watch-chat`: alert text; alert secret made on the page and refused over MCP.
- `watch-page`: spacing, Ask why without a clipboard, the alerts secret control, the folder list.
- `setup-scan`: CI check wording.

## Impact

`src/server/cli.ts`, `src/server/config.ts`, `src/server/alerts.ts`, `src/server/extend.ts`,
`src/server/mcp.ts`, `src/server/scan.ts`, `src/server/checks/github.ts`, `src/web/ui.tsx`,
`src/web/client.ts`, `src/web/Home.tsx`, `src/web/Details.tsx`, `src/web/app-entry.tsx`,
`README.md` and their tests. No schema change. Existing alert settings keep working; a stored
secret stays until the person makes a new one.
