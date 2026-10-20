## ADDED Requirements

### Requirement: Hold failures while Watch is offline

When a check that needs the internet does not pass, Watch SHALL decide whether it can reach the
internet before recording the result, by probing its probe addresses and counting any answer
within 5 seconds as online. A probe's answer SHALL be reused for 15 seconds, so checks that fail
together share one probe, and a check that passes after a probe began SHALL outrank that probe. While Watch is offline, such a result SHALL be
held: the run SHALL be kept in the check's history marked as held, the check SHALL keep its last
result, and no change event or alert SHALL be made. Watch SHALL probe only for a result that
would change the check's state. Heartbeat checks and HTTP checks on this machine SHALL never be
held; checks on the local network or the tailnet SHALL be held like the rest, and only a pass from
a check that reaches the internet SHALL count as proof that Watch is online. Watch SHALL remember
when it went offline and SHALL count itself online again when a probe answers, when such a check
passes, or 30 minutes after its last failed probe. A check's failures SHALL be held at most an
hour in a row, counted from its first held run, and then SHALL be recorded as usual.

#### Scenario: The link is down

- **WHEN** a passing HTTP check on a public site fails and no probe address answers
- **THEN** the check still shows its last passing result, its history shows a held run, and no
  event is made

#### Scenario: The site is down, not the link

- **WHEN** a passing HTTP check fails and a probe address answers
- **THEN** the check fails and a change event is made, as before

#### Scenario: Held for over an hour

- **WHEN** a check's failures have been held for more than an hour in a row and it fails again
- **THEN** the failure is recorded and makes an event, as if Watch were online

#### Scenario: A check on the local network passes while the internet is down

- **WHEN** a check on a LAN address passes and a check on a public site fails, and no probe answers
- **THEN** the public failure is held, because the LAN pass does not prove the internet works

#### Scenario: A heartbeat while offline

- **WHEN** a heartbeat check goes stale while Watch is offline
- **THEN** it fails and makes an event as usual

### Requirement: Probe addresses can be set

Watch SHALL probe `https://www.gstatic.com/generate_204` and
`https://one.one.one.one/cdn-cgi/trace` unless `config.json` holds a `probeUrls` list of http or
https addresses that parse, which it SHALL probe instead. An empty list SHALL turn holding off. Watch SHALL
NOT write `probeUrls` into `config.json` unless someone set it there.

#### Scenario: A network that blocks the defaults

- **WHEN** `probeUrls` names an address the network allows
- **THEN** Watch probes only that address
