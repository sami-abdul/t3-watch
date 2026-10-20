## ADDED Requirements

### Requirement: Offline line in the status

While Watch counts itself offline, the text status from `watch_status` and `watch_home` SHALL
start with a line saying since when Watch cannot reach the internet and that failures of checks
which need it are held for up to an hour each.

#### Scenario: Asking while offline

- **WHEN** the person asks the Watch thread for status while Watch is offline
- **THEN** the first line of the answer says Watch is offline and its checks are on hold
