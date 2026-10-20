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
- `t3-watch start` prints the sign-in link only to a terminal, so systemd and launchd logs never
  get the token. `install` never prints it: agents run `install`, and some agent shells are
  terminals. It says to run `t3-watch url` yourself, and the agent instructions say never to
  fetch the link.
- The page keeps its vertical spacing: headings and text no longer carry a margin reset that
  overrides `space-y-*`.
- Ask why shows the question on the page when the browser has no clipboard, as on a plain-HTTP
  tailnet address, instead of failing silently.
- Alerts read cleanly: "Watch check failed: example/api: CI on main is passing. ..." rather than
  "... is passing is failing". Setup words its CI checks "CI on main is passing" because the
  service label already names the repository.
- The alert signing secret is made by Watch on the page (Details, Alerts, Make a signing secret)
  and shown once, only to the page's signed-in session; replacing a secret while alerts are on
  asks first. `watch_set_alerts` refuses a secret. The agent instructions use T3's
  `request_secret` so the person pastes the secret into a private card, and `signature.secretRef`
  on the webhook task, so the secret never enters a transcript.
- `watch_home` puts its text summary in the structured content as well. Claude Code shows the
  model only the structured content, so a Claude Watch thread saw just the page address.
- A `github` check that names a `workflow` can take `maxAgeSeconds`: it then also fails when that
  workflow's newest successful run is older than that, which catches a schedule that stopped.
- The Details folder list shows the configured folders, not the folders of the last scan.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `watch-service`: status and sign-in output; GitHub freshness.
- `watch-chat`: alert text; alert secret made on the page and refused over MCP; Home's
  summary for clients that read structured content.
- `watch-page`: spacing, Ask why without a clipboard, the alerts secret control, the folder list.
- `setup-scan`: CI check wording.

## Impact

`src/server/cli.ts`, `src/server/config.ts`, `src/server/alerts.ts`, `src/server/extend.ts`,
`src/server/mcp.ts`, `src/server/scan.ts`, `src/server/http.ts`, `src/server/checks/github.ts`,
`src/web/ui.tsx`, `src/web/client.ts`, `src/web/Details.tsx`, `src/web/app-entry.tsx`,
`README.md` and their tests. No schema change. Existing alert settings keep working; a stored
secret stays until the person makes a new one.
