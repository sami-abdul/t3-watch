## ADDED Requirements

### Requirement: Private Slack setup
The Alerts panel SHALL let a signed-in browser save, replace, disconnect and test a Slack
incoming-webhook URL. It SHALL clear the input after saving and show only configured status and
delivery results. A sample Watch SHALL refuse to save or send real Slack alerts.

#### Scenario: Save and reload
- **WHEN** a person saves a valid Slack webhook URL and reloads the page
- **THEN** the page shows Slack as configured without showing the saved URL
- **AND** test and disconnect controls are available
