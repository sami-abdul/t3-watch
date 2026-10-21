## ADDED Requirements

### Requirement: Test alert tool

The `watch_test_alert` tool SHALL send a test alert and return its result without the webhook's
address. The agent instructions SHALL call it after `watch_set_alerts` and tell the person the
result.

#### Scenario: After setup

- **WHEN** the agent has given Watch the webhook's address with `watch_set_alerts`
- **THEN** it calls `watch_test_alert` and tells the person whether the webhook accepted the test
