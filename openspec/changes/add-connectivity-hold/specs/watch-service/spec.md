## ADDED Requirements

### Requirement: Hold failures while Watch is offline

When a check that needs the internet does not pass, Watch SHALL decide whether it can reach the
internet before recording the result. It SHALL count itself online when another check that needs
the internet passed in the last 2 minutes, and otherwise SHALL probe its probe addresses, counting
any answer within 5 seconds as online. A probe's answer SHALL be reused for 60 seconds, and checks
that fail at the same time SHALL share one probe. While Watch is offline, such a result SHALL be
held: the run SHALL be kept in the check's history marked as held, the check SHALL keep its last
result, and no change event or alert SHALL be made. HTTP checks on localhost or a loopback address
and heartbeat checks SHALL never be held. Watch SHALL store when it went offline and SHALL count
itself online again when a probe answers or a check that needs the internet passes.

#### Scenario: The link is down

- **WHEN** a passing HTTP check on a public site fails and no probe address answers
- **THEN** the check still shows its last passing result, its history shows a held run, and no
  event is made

#### Scenario: The site is down, not the link

- **WHEN** a passing HTTP check fails and a probe address answers
- **THEN** the check fails and a change event is made, as before

#### Scenario: A heartbeat while offline

- **WHEN** a heartbeat check goes stale while Watch is offline
- **THEN** it fails and makes an event as usual

### Requirement: Probe addresses can be set

Watch SHALL probe `https://www.gstatic.com/generate_204` and
`https://one.one.one.one/cdn-cgi/trace` unless `config.json` holds a `probeUrls` list of http or
https addresses, which it SHALL probe instead. An empty list SHALL turn holding off. Watch SHALL
NOT write `probeUrls` into `config.json` unless someone set it there.

#### Scenario: A network that blocks the defaults

- **WHEN** `probeUrls` names an address the network allows
- **THEN** Watch probes only that address
