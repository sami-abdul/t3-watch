## ADDED Requirements

### Requirement: Slow link line on Home

While Watch counts its link slow and is not offline, Home SHALL say since when its connection has
been slow and that web and vendor checks whose connections time out or drop are held for up to an hour each.

#### Scenario: A slow spell

- **WHEN** Watch held a check's failure because its link is slow
- **THEN** Home says the connection has been slow since then, and that nothing alerts for those
  checks meanwhile
