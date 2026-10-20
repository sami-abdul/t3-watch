## ADDED Requirements

### Requirement: Offline notice

While Watch counts itself offline, Home SHALL say since when it cannot reach the internet, that
failures of checks which need it are held for up to an hour each, and that nothing alerts
meanwhile.

#### Scenario: Watch loses its link

- **WHEN** Watch holds a failure because it is offline
- **THEN** Home shows the offline notice above the checks until Watch is online again
