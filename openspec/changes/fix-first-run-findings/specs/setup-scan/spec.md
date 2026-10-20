## ADDED Requirements

### Requirement: CI check wording

Setup SHALL word a repository's CI check as "CI on <branch> is passing", leaving the repository
to the service label it is shown with.

#### Scenario: A repository with Actions runs

- **WHEN** setup proposes a CI check for example/api on main
- **THEN** its intent is "CI on main is passing" and its service label is example/api
