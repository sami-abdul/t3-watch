## ADDED Requirements

### Requirement: Alert text names the check

An alert's `text` SHALL name what happened before the check, for example "Watch check failed:",
"Watch check passing again:" or "Watch check could not run:", followed by the service, the check's
intent and the summary, so an intent phrased as the healthy state still reads correctly.

#### Scenario: A CI check fails

- **WHEN** the check "CI on main is passing" on service example/api fails
- **THEN** the alert text starts "Watch check failed: example/api: CI on main is passing."

### Requirement: Alert secret never passes through chat

Watch SHALL make the alert signing secret itself, from the page, and show it once there.
`watch_set_alerts` SHALL refuse a secret. The agent instructions SHALL have the agent collect the
secret through the host's private secret prompt and attach it to the webhook task by reference,
and SHALL NOT have the agent generate, hold or repeat the secret.

#### Scenario: An agent passes a secret

- **WHEN** an agent calls `watch_set_alerts` with a `secret`
- **THEN** the call fails, nothing is stored, and the error says to make the secret on the page
