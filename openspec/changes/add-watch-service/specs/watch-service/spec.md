## ADDED Requirements

### Requirement: Deterministic check kinds

The service SHALL run checks of kind `http`, `github`, `aws_metric`, `heartbeat` and `vendor`.
Each run SHALL produce an outcome of pass, fail or unknown, a one-line summary and evidence.
A check that cannot reach its target or cannot read the reply SHALL be unknown, not fail, unless
the reply proves a failure (for example a 401 from a vendor).

#### Scenario: HTTP check against a down URL

- **WHEN** an `http` check expects 200 and the URL returns 503
- **THEN** the run fails with a summary naming the status

#### Scenario: GitHub CLI missing

- **WHEN** a `github` check runs and `gh` is not installed
- **THEN** the run is unknown and says to install the GitHub CLI

### Requirement: Vendors are data

Each vendor SHALL be one JSON description validated on load. The vendor engine SHALL send only
GET requests, only to the description's API origin, with the key placed as the description says
(bearer, header or basic). A description SHALL declare a key check and MAY declare freshness
checks that read a list and compare its newest timestamp with a maximum age. Descriptions from
`catalog/` and approved local descriptions SHALL load together, local ones winning by id.

#### Scenario: A description asks for another host

- **WHEN** a check's path resolves to a host other than the description's API origin
- **THEN** the engine refuses the request and the run is unknown

#### Scenario: A rejected key

- **WHEN** the key check gets 401 or 403
- **THEN** the run fails with "key rejected"

### Requirement: Keys never leave the service

Keys SHALL be stored encrypted with AES-256-GCM under a per-install key file readable only by
its owner. No API response, MCP result, log line or error message SHALL contain a key value.

#### Scenario: Listing keys

- **WHEN** the page lists keys
- **THEN** each shows its vendor, label, source and last four characters only

### Requirement: Scheduler and change events

The scheduler SHALL run every approved, unpaused and unsnoozed check when it is due, at most four
at a time, record the run, and record a change event when the outcome differs from the previous
run's. A check's first run SHALL record an event only when it fails.

#### Scenario: A passing check fails

- **WHEN** a check that passed now fails
- **THEN** one change event records the failure and later failing runs add no event

### Requirement: Token-guarded HTTP

The HTTP server SHALL bind to 127.0.0.1 unless configured otherwise. Every `/api` and `/mcp`
route SHALL require the access token as a bearer header or the session cookie set by the
sign-in link. `POST /hb/<token>` SHALL need no other auth and SHALL accept only a known
heartbeat token.

#### Scenario: No token

- **WHEN** a request to `/api/state` carries no token
- **THEN** the server answers 401

### Requirement: Install as a user service

`t3-watch install` SHALL write a systemd user unit on Linux or a launchd agent on macOS that
runs `t3-watch start`, enable it, register the MCP endpoint with `codex mcp add` and
`claude mcp add` when those CLIs exist, and print the page's sign-in link. `t3-watch uninstall`
SHALL remove the unit and the MCP registrations and keep the data.

#### Scenario: Codex not installed

- **WHEN** `codex` is not on PATH during install
- **THEN** install skips that registration and says how to add it later
