## ADDED Requirements

### Requirement: Hold failures while Watch is offline

When a check that needs the internet does not pass, Watch SHALL decide whether it can reach the
internet before recording the result, by probing its probe addresses and counting any answer
within 5 seconds as online. A probe's answer SHALL be reused for 15 seconds, so checks that fail
together share one probe, and a check that passes after a probe began SHALL outrank that probe. While Watch is offline, such a result SHALL be
held: the run SHALL be kept in the check's history marked as held, the check SHALL keep its last
result, and no change event or alert SHALL be made. Watch SHALL probe for a result that would
change the check's state, and, while it already counts itself offline, for any failure, which it
SHALL hold too. Heartbeat checks, checks on this machine and checks whose address does not parse
SHALL never be held; checks on the local network or the tailnet SHALL be held like the rest, and
only a pass from a check that reaches the internet SHALL count as proof that Watch is online. A
vendor check SHALL count by its vendor's API origin. Watch SHALL remember
when it went offline and SHALL count itself online again when a probe answers, when such a check
passes, or 30 minutes after its last failed probe. A check's failures SHALL be held for at most
an hour of its runs in a row, so time Watch spends stopped does not count, and then SHALL be
recorded as usual; a run recorded that way SHALL NOT end the streak while Watch stays offline.

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

### Requirement: Two non-passing runs before a check fails

A check whose last result was a pass, or that has no result yet, SHALL NOT change state on one run
that does not pass. Watch SHALL keep that run in the check's history marked as pending and SHALL
run the check again within 60 seconds, or within its cadence when that is shorter. Only when that
next run does not pass either SHALL the check take its result, with a change event and an alert.
Held runs SHALL NOT count either way. The next run that is not held SHALL confirm or clear a
pending run whenever it comes, and pausing, resuming, snoozing or redefining the check SHALL
clear it. A run someone asks for SHALL record its result as it is. A pending failure confirmed by
a run that could not run SHALL still make an event. A pass, and a change between failing and not
being able to run, SHALL count at once. A pause, snooze, removed key or new definition made while a
run is in flight SHALL win over that run, and applying the same definition again SHALL NOT. The
history, the text status, Home and `watch_check` SHALL show a pending run's result and time, as failed once or could not run once, being checked
again.

#### Scenario: One bad run

- **WHEN** a passing check fails once and passes when it runs again a minute later
- **THEN** it stays passing and no event is made

#### Scenario: Two bad runs in a row

- **WHEN** a passing check fails, and fails again a minute later
- **THEN** it fails after the second run and one event is made

#### Scenario: A run someone asks for

- **WHEN** a person or agent runs a passing check now and it fails
- **THEN** it fails at once and an event is made

#### Scenario: Recovery

- **WHEN** a failing check passes once
- **THEN** it passes at once and an event is made

### Requirement: A probe list that disagrees

When a check that reaches the internet passes while Watch counts itself offline, Watch SHALL probe
again at once, and SHALL count a disagreement when no probe address answers. With two
disagreements in the last hour, Watch SHALL treat its probe list as wrong: it SHALL NOT hold
failures or count itself offline, and Home and the text status SHALL say the probe addresses do
not answer while checks that need the internet pass, and point at `probeUrls`. A probe that
answers SHALL clear the disagreements.

#### Scenario: A network that blocks the probe addresses

- **WHEN** the probe addresses keep failing while a check on a public site keeps passing
- **THEN** after the second disagreement Watch stops holding, a failing check fails as usual, and
  Home names `probeUrls`

#### Scenario: An outage that ends

- **WHEN** Watch was offline and the link comes back, so a check passes and the fresh probe answers
- **THEN** no disagreement is counted
