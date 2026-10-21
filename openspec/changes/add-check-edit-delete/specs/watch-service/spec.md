## ADDED Requirements

### Requirement: Checks are edited, deleted and restored on the page

Watch SHALL edit a check that is on or paused: its intent, from 3 to 200 characters, its cadence,
a whole number of minutes from 1 to 1440, and its settings, which SHALL pass the schema of the
check's kind with no field the kind does not have. A cadence left as it was SHALL stay, whole
minutes or not. Watch SHALL refuse settings that move a check to another repository or another
AWS profile, any change to a vendor check's settings, and an edit made on a version of the check
one, and SHALL keep a heartbeat's token. An edited check SHALL keep its id, runs and changes, and
one that is on SHALL run at the next tick when its settings or cadence changed.

Deleting SHALL mark a check deleted, keeping its runs and changes: it SHALL NOT run, SHALL refuse
every other action until restored, its heartbeat ping address SHALL stop answering, and a change
it had not sent yet SHALL wait unsent and unmarked until it is restored. Restoring SHALL bring a deleted check back paused, on its
vendor's key when its own was removed meanwhile, and SHALL change nothing for a check that is not
deleted. Drafts SHALL be discarded, not deleted. The routes for edit, delete and restore SHALL
answer only a signed-in browser on the page, never the access token.

#### Scenario: An unknown setting

- **WHEN** the person saves an HTTP check's settings with a field named `contain`
- **THEN** Watch refuses, naming the fields an HTTP check has, and the check is unchanged

#### Scenario: The token cannot delete

- **WHEN** a request with the access token asks to delete a check
- **THEN** Watch answers 403 and the check stays as it was
