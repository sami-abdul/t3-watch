## ADDED Requirements

### Requirement: Edit and Delete in Details

Details SHALL offer Edit on each check that is on or paused, with its name, how often it runs in
minutes and its settings as JSON, leaving out a heartbeat's ping token, a vendor check's settings
and those of a kind Watch cannot check. Saving SHALL show Watch's reason when it refuses. Details SHALL offer Delete on each
check that is not a draft, and SHALL ask once before deleting. Details SHALL list deleted checks
apart, each with its history and Restore. The chat view SHALL offer none of these.

#### Scenario: Fixing a moved address

- **WHEN** the person edits an HTTP check that is on and saves a new URL
- **THEN** the check keeps its history, runs again with the new URL within a tick, and Details
  shows the new target

#### Scenario: Deleting and restoring

- **WHEN** the person deletes a check and later presses Restore under Deleted checks
- **THEN** the check leaves Home at once, and comes back paused with its earlier runs
