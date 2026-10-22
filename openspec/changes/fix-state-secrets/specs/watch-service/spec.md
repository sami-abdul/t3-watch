## ADDED Requirements

### Requirement: Keep secrets in check settings out of shared reads

The state the page and the inline view read, and every MCP result, SHALL carry a check's settings
without secrets: a heartbeat check's token left out, and an HTTP address cut to its origin and
path, with a password, the query string and any path part that looks like a token shown as "…".
The state SHALL NOT carry a heartbeat check's ping address. The page SHALL fetch a check's stored
settings, and a heartbeat check's ping address, from a route that answers only a signed-in browser
and refuses the agents' token. A heartbeat check an agent drafts SHALL still give that agent its
ping URL.

#### Scenario: An address with a password and a token

- **WHEN** an HTTP check watches `https://user:hunter2@api.example/v1/status?key=abc`
- **THEN** the state and `watch_check` show its address as `https://api.example/v1/status?…`,
  and neither the password nor the key appears in them

#### Scenario: A heartbeat check

- **WHEN** a heartbeat check is on
- **THEN** its token and ping address are in neither the state, `watch_state` nor `watch_check`,
  and the page shows the ping address when the person asks for it

#### Scenario: An agent asks for the stored settings

- **WHEN** a request with the agents' token asks for a check's stored settings
- **THEN** Watch refuses it and says to use the Watch page

#### Scenario: Editing on the page

- **WHEN** the person presses Edit on an HTTP check whose address has a password
- **THEN** the form shows the stored address, and saving it unchanged keeps the password
