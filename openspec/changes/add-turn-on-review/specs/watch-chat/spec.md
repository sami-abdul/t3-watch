## ADDED Requirements

### Requirement: Targets for agents

`watch_scan` SHALL give each suggested check's target, so an agent can tell the person what each
check would contact before turning it on.

#### Scenario: An agent explains a suggestion

- **WHEN** an agent shows a scan's suggestions
- **THEN** each comes with the sentence saying what that check contacts
