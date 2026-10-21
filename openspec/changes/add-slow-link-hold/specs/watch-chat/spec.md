## ADDED Requirements

### Requirement: Slow link line in the status

While Watch counts its link slow and is not offline, the text status from `watch_status` and
`watch_home` SHALL start with a line saying since when its connection has been slow and that
web and vendor checks whose connections time out or drop are held for up to an hour each.

#### Scenario: Asking during a slow spell

- **WHEN** the person asks the Watch thread for status while Watch's link is slow
- **THEN** the first line of the answer says the connection is slow and which failures are held
