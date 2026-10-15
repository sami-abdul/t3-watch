## ADDED Requirements

### Requirement: Watch tools

The MCP server SHALL expose `watch_home`, `watch_status`, `watch_check`, `watch_scan`,
`watch_apply`, `watch_set_check`, `watch_draft_check`, `watch_draft_vendor`, `watch_note` and
`watch_set_alerts`, behind the access token. Read-only tools SHALL carry `readOnlyHint`. No tool
SHALL accept or return a key value.

#### Scenario: Pausing from chat

- **WHEN** the agent calls `watch_set_check` with pause
- **THEN** the check stops running and the page shows it paused

### Requirement: Inline view

`watch_home` SHALL name the `ui://t3-watch/home` resource, served with MIME type
`text/html;profile=mcp-app` as one self-contained HTML file. The view SHALL call tools through the
host and open the page for Add key.

#### Scenario: A host without apps

- **WHEN** a host that does not render apps calls `watch_home`
- **THEN** the result's text lists what is broken and what passes

### Requirement: Drafts need a person

A drafted check SHALL be validated and run once, then stored as a draft that does not run on a
schedule until a person turns it on. A drafted vendor SHALL be validated, its key check run when a
key exists, and stored as a draft until approved.

#### Scenario: Invalid draft

- **WHEN** the agent drafts a vendor whose API origin is not https
- **THEN** the tool returns the validation error and stores nothing

### Requirement: Alerts only on change

Each change event SHALL be sent once to the configured alert URL, signed when a secret is set,
and retried on the next tick if the send failed. A passing tick with no change SHALL send nothing.

#### Scenario: Alert URL down

- **WHEN** the alert URL returns 500
- **THEN** the event stays pending and is sent on a later tick
