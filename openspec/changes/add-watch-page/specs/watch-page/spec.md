## ADDED Requirements

### Requirement: One button starts setup

With no services the page SHALL show Set up Watch and a sentence saying Watch reads the projects
and logins on this machine, only reads, and keeps keys on this machine. While scanning it SHALL
say what it is reading without a continuously animating indicator.

#### Scenario: First visit

- **WHEN** a signed-in user opens a fresh install
- **THEN** the page shows Set up Watch and nothing else to configure

### Requirement: Review once

The review SHALL list access rows then check rows, each with a tick that starts ticked when the
access works or the check's trial did not come back unknown, and a Watch these N button whose
count follows the ticks. Add key SHALL take one value, test it, and report on its row.

#### Scenario: A rejected key

- **WHEN** a pasted key fails its key check
- **THEN** the row says the vendor rejected it and the key is not kept

### Requirement: Home leads with what is broken

Home SHALL headline the number of failing checks or "All clear", list failing checks first with
the agent's latest note, then checks that could not run, then drafts, then one folded line for
passing checks.

#### Scenario: One failing check

- **WHEN** one check fails and ten pass
- **THEN** Home says "1 thing is broken" and folds the ten into one line

### Requirement: Every way in has a way out

Turn on SHALL have Pause, Snooze SHALL have Resume, an added key SHALL have Remove, and a draft
SHALL have Discard.

#### Scenario: Snoozed check

- **WHEN** a check is snoozed until tomorrow
- **THEN** Details shows until when and offers Resume
