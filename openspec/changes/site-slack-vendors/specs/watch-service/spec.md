## ADDED Requirements

### Requirement: Independent Slack alerts
Watch SHALL accept a Slack incoming-webhook URL only from a signed-in browser, store it encrypted
using the installation's keyring, and never return it through state, MCP or errors. Slack and T3
delivery SHALL run independently. A failed delivery SHALL retry with a bounded attempt count.

#### Scenario: Slack accepts a change
- **WHEN** a check changes state and Slack alerts are configured
- **THEN** Watch posts a readable message to the configured Slack webhook
- **AND** delivery to T3, if configured, keeps its own success and retry state

#### Scenario: Slack refuses or redirects a message
- **WHEN** Slack refuses, redirects or cannot receive a message
- **THEN** Watch records a failure without exposing the webhook URL
- **AND** it does not follow the redirect with the alert body

### Requirement: Documented GET-only vendor descriptions
New vendor descriptions SHALL use only GET requests supported by public vendor documentation,
remain within their declared origin, and include documented minimum permissions and fixture tests.

#### Scenario: An API needs another method
- **WHEN** a vendor only supports a non-GET key verification call
- **THEN** Watch documents that limitation instead of sending the unsupported method
