## ADDED Requirements

### Requirement: Hold a sudden empty list of runs

Each GitHub check result read from `gh run list` SHALL record how many runs it listed and for
which workflow, branch and repository. When `gh run list` answers with no runs at all, and the
latest of the check's runs that counted a listing found runs for the same workflow, branch and
repository, the check SHALL report that GitHub listed no runs for them, though it had them before.
Watch SHALL hold that result for up to an hour of the check's runs in a row, keeping the check's
state and summary, with no change event and without probing its own link, since gh answered. A pause, a snooze
or a resume SHALL NOT clear what the check's runs listed; an edit to another workflow, branch or
repository SHALL. A run kept from before listings were counted SHALL count by the runs it kept. A
result that lasts past the hour SHALL be recorded with that summary. A check whose runs never
listed any SHALL still say "No finished runs yet".

#### Scenario: GitHub lists nothing for a moment

- **WHEN** a passing check's next run finds no runs for main, and the run after finds them again
- **THEN** the check stays passing, no change event is made, and the empty run shows as held

#### Scenario: The list stays empty

- **WHEN** GitHub lists no runs for main in acme/api for longer than an hour of the check's runs
- **THEN** the check could not run, its summary reads "GitHub listed no runs for main in acme/api,
  though it had them before", and one change event is made

#### Scenario: A check that was not passing

- **WHEN** a check that could not read its runs finds no runs at all
- **THEN** its summary still says why it could not read them, and the empty run shows as held

#### Scenario: A snooze in between

- **WHEN** a check whose runs listed some is snoozed, resumed, and then finds no runs
- **THEN** the empty list is held as before

#### Scenario: An edit to another branch

- **WHEN** a check whose runs listed some for main is edited to a branch with no runs
- **THEN** its summary reads "No finished runs yet"

#### Scenario: A repository with no runs yet

- **WHEN** a check's runs have never listed any
- **THEN** its summary reads "No finished runs yet", as before
