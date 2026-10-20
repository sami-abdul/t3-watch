## ADDED Requirements

### Requirement: Status reaches the listening address

`t3-watch status` SHALL query the address Watch is configured to listen on, using 127.0.0.1 only
when Watch listens on all interfaces.

#### Scenario: Watch bound to a tailnet address

- **WHEN** `host` in the config is a tailnet address and the service is running
- **THEN** `t3-watch status` reports it running with its check counts

### Requirement: Sign-in token stays out of logs

`t3-watch start` SHALL print the sign-in link, which carries the access token, only when
standard output is a terminal, and otherwise SHALL say to run `t3-watch url`. `t3-watch install`
SHALL NOT print the link, because agents run it and some agent shells are terminals; it SHALL
say how to get the link instead.

#### Scenario: Started by systemd

- **WHEN** the service starts with standard output going to the journal
- **THEN** the journal gets the page address and no token

### Requirement: GitHub freshness

A `github` check that names a `workflow` MAY set `maxAgeSeconds`; one without a workflow SHALL
be refused, so another workflow's success cannot hide a stalled schedule. When set, the check
SHALL also fail when the workflow's newest successful run started longer ago than that, naming
how old it is.

#### Scenario: A scheduled workflow GitHub skipped

- **WHEN** a `github` check has `maxAgeSeconds` 21600 and the newest successful run started seven
  hours ago with no failed run since
- **THEN** the run fails with a summary saying the last success was seven hours ago
