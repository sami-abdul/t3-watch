## ADDED Requirements

### Requirement: Targets before turning checks on

Every check SHALL have a target: one plain sentence saying what it contacts, without any secret.
The review SHALL show the target of each suggested check, and Details the target of each check.
Watch these SHALL first list every check it will turn on, with its target and how often it runs,
and turn them on only when the person confirms. Saving with no checks SHALL not need the list.

#### Scenario: Turning on three checks

- **WHEN** the person ticks three suggested checks and presses Watch these
- **THEN** the page lists the three, each with what it contacts and how often, and turns them on
  only after Turn them on

#### Scenario: Backing out

- **WHEN** the person presses Back on that list
- **THEN** no check changes state and the review is as they left it
