## Why

Turning alerts on takes steps in two places, the page and the Watch thread, and nothing confirms
the result. A T3 task that holds a different secret refuses every alert, and nobody learns it
until a check fails and no thread wakes. Every restart of a live Watch now has to prove its
webhook still verifies, and today that takes a hand-written script. The page also prints the
webhook's full address into a view that can render inside a chat.

## What Changes

- **Connect alerts panel.** The Alerts section in Details becomes three numbered steps, each
  marked done when it is: make a signing secret on the page, ask the Watch thread to set up
  alerts, and send a test alert. The secret still shows once, on the page only, and reaches the
  T3 task through the private card the Watch thread opens. Home says when alerts are off while
  checks are on, or when the last test was not accepted, with a button to the panel.
- **Test alerts.** A signed `watch.test` event, sent by the panel's button, a new MCP tool
  `watch_test_alert`, or `t3-watch alerts test`. Watch keeps the last result: a 2xx answer means
  the webhook accepted the signature, 401 or 403 means its task lacks Watch's secret, and any
  other answer or none is reported as it is. A browser's test must come from the page's own
  origin. Tests are at least 10 seconds apart, so a double press wakes the thread once. A new
  secret or address clears the last result.
- **Host, not address.** The state, the page and the alert tools name the webhook by host only.
- The agent instructions call `watch_test_alert` after `watch_set_alerts` and tell the person
  the result.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `watch-page`: the Connect alerts panel and Home's alerts notice.
- `watch-service`: test alerts, the `alerts` command and the host-only state.
- `watch-chat`: the `watch_test_alert` tool, host-only replies and the instructions.

## Impact

`src/server/alerts.ts`, `src/server/extend.ts`, `src/server/http.ts`, `src/server/state.ts`,
`src/server/mcp.ts`, `src/server/cli.ts`, `src/web/client.ts`, `src/web/app-entry.tsx`, a new
`src/web/Alerts.tsx`, `src/web/Details.tsx`, `src/web/Home.tsx`, `src/web/App.tsx`,
`src/web/logic.ts`, `README.md`, and tests in `src/server/chat.test.ts`, `src/server/cli.test.ts`
and `src/web/logic.test.ts`. Stored alert settings do not change; a running Watch picks up the
new routes when it restarts.
