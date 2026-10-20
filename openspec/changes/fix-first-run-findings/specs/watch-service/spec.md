## ADDED Requirements

### Requirement: Status reaches the listening address

`t3-watch status` SHALL query the address Watch is configured to listen on, using 127.0.0.1 only
when Watch listens on all interfaces.

#### Scenario: Watch bound to a tailnet address

- **WHEN** `host` in the config is a tailnet address and the service is running
- **THEN** `t3-watch status` reports it running with its check counts

### Requirement: Sign-in token stays out of logs

`t3-watch start` and `t3-watch install` SHALL print the sign-in link, which carries the access
token, only when standard output is a terminal. Otherwise they SHALL say to run `t3-watch url`.

#### Scenario: Started by systemd

- **WHEN** the service starts with standard output going to the journal
- **THEN** the journal gets the page address and no token

### Requirement: GitHub freshness

A `github` check MAY set `maxAgeSeconds`. When set, the check SHALL also fail when the newest
successful run in its scope started longer ago than that, or when there is no successful run in
the runs it reads, naming how old the newest success is.

#### Scenario: A scheduled workflow GitHub skipped

- **WHEN** a `github` check has `maxAgeSeconds` 21600 and the newest successful run started seven
  hours ago with no failed run since
- **THEN** the run fails with a summary saying the last success was seven hours ago
