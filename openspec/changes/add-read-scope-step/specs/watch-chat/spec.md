## ADDED Requirements

### Requirement: Sources tool

The read-only `watch_sources` tool SHALL say which folders and logins Watch may read, with each
folder's repository count and whether each login is on this machine.

#### Scenario: An agent asks before scanning

- **WHEN** an agent calls `watch_sources`
- **THEN** it gets the saved folders and logins, and whether each is allowed
