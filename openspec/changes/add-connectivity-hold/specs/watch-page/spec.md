## ADDED Requirements

### Requirement: Offline notice

While Watch counts itself offline, Home SHALL say since when it cannot reach the internet, that
checks which need it are on hold, and that nothing alerts until the link is back. After an hour
offline it SHALL say instead that failures are recorded again.

#### Scenario: Watch loses its link

- **WHEN** Watch holds a failure because it is offline
- **THEN** Home shows the offline notice above the checks until Watch is online again
