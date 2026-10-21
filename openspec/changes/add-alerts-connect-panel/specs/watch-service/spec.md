## ADDED Requirements

### Requirement: Test alerts

Watch SHALL send a test alert on request: one POST of a `watch.test` event to the alert address,
signed like change events, whose text says no check changed. It SHALL keep the last result with
its time and say whether the webhook accepted it: a 2xx answer is accepted, 401 or 403 means the
webhook refused Watch's signature, and any other answer or no answer is reported as such. A
request SHALL carry the access token, or come from a signed-in page on its own origin. A test
within 10 seconds of the last one SHALL be refused. A new signing secret or alert address SHALL
clear the last result. `t3-watch alerts test` SHALL send one through the running service and exit
non-zero unless the webhook accepted it.

#### Scenario: The task holds another secret

- **WHEN** the webhook answers 401 to a test alert
- **THEN** the result says the webhook refused Watch's signature and that its task needs a new
  secret through the Watch thread

#### Scenario: A double press

- **WHEN** a second test is requested 3 seconds after the first
- **THEN** it is refused and the webhook receives one test

#### Scenario: Another site

- **WHEN** a page on another origin posts to the test route with the signed-in browser's cookie
- **THEN** Watch refuses it and sends nothing

### Requirement: Alert address stays out of views

Watch's state and its alert tools SHALL name the alert webhook by its host only, never by its
full address.

#### Scenario: State

- **WHEN** alerts go to a T3 webhook
- **THEN** the state names the webhook's host and whether alerts are signed, and does not contain
  the address
