## ADDED Requirements

### Requirement: Keep secrets in check settings out of shared reads

The state the page and the inline view read, every MCP result, and every HTTP answer that carries
a check SHALL carry its settings without secrets: a heartbeat check's token left out, and an HTTP
address cut to its origin and the path parts known to be safe, with a password, the query string
and any other path part shown as "…". The state SHALL NOT carry a heartbeat check's ping address,
and SHALL carry a vendor draft only as its name, the API origin it reads and its test. The page
SHALL fetch a check's stored settings, and a heartbeat check's ping address, with a POST that
answers only a signed-in browser on the page and refuses the agents' token, in one read that
includes the version Edit saves against. A heartbeat check an agent drafts SHALL still give that
agent its ping URL.

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

#### Scenario: An agent pauses a check

- **WHEN** a request with the agents' token pauses a heartbeat check, or an HTTP check whose
  address has a password
- **THEN** the check in the answer carries neither the token nor the password

#### Scenario: A vendor draft with a key written into it

- **WHEN** an agent drafts a vendor whose description has a key in a header or a query
- **THEN** the state and `watch_state` show the draft as its name, its API origin and its test,
  and the key appears in neither

#### Scenario: A short token in an address

- **WHEN** an HTTP check watches `https://hc.example.com/ping/AbCdEfGhIjKlMnOp`
- **THEN** its address shows as `https://hc.example.com/ping/…`

#### Scenario: A page on plain HTTP

- **WHEN** a signed-in browser on a plain HTTP address away from localhost asks for a check's
  settings, sending its Origin but no fetch metadata
- **THEN** Watch answers with them

#### Scenario: Settings read before another tab saves

- **WHEN** Edit's settings were read before another tab saved the check
- **THEN** the form carries the version they came from, and Watch refuses its save instead of
  writing the older settings back
