## Why

The chat is for understanding and authoring: why something broke, what to do, and "watch this new
thing". A Watch thread in T3 Code should know Watch through tools, show the page inline where the
host supports it, and wake only when something changed.

## What Changes

- **MCP server** at `/mcp` (streamable HTTP, same token) with instructions for the agent and these
  tools:
  - `watch_home`: the Home view as an MCP App (`ui://t3-watch/home`), with a text summary for
    hosts without apps. Read-only.
  - `watch_status`, `watch_check`: state, recent runs and evidence for investigation. Read-only.
  - `watch_scan`, `watch_apply`: setup from chat.
  - `watch_set_check`: turn on, pause, snooze until a time, resume, run now.
  - `watch_draft_check`: the agent proposes a check (kind, config, intent, cadence); the service
    validates it, runs it once and stores it as a draft for the person to turn on.
  - `watch_draft_vendor`: the agent proposes a vendor description; the service validates it, tests
    its key check when a key exists, and stores it as a draft.
  - `watch_note`: the agent leaves a note on a check, shown on Home.
  - `watch_set_alerts`: where change events go (a T3 webhook task URL and optional signing
    secret).
- **Inline view:** the same React components as the page, built into one HTML file served as the
  app resource. Its buttons call the tools; Add key opens the page.
- **Alerts:** each change event is POSTed once to the alert URL as JSON with the check, outcome,
  summary and page link, signed with HMAC-SHA256 when a secret is set. All-green hours send
  nothing. An optional daily digest posts the state once a day.
- **Drafts on the page:** Home lists drafts with Turn on and Discard; approving a vendor draft
  adds it to the local catalog.

## Capabilities

### New Capabilities

- `watch-chat`: the MCP server, the inline view, agent drafts and notes, and alerts.

## Impact

New `src/server/mcp.ts`, `src/server/alerts.ts`, `src/web/app-entry.tsx`, `app.html`; a second
Vite build into `dist/app/index.html`; README section on the Watch thread.
