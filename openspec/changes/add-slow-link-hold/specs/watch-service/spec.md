## ADDED Requirements

### Requirement: Name why a request got no answer

HTTP and vendor checks SHALL name why a request got no answer from the reason Node's fetch keeps
in its error's cause, in plain words. They SHALL mark the failure as one a slow or failing link
of Watch's own could explain when it is a timeout, a reset or dropped connection, a name lookup
that failed, or an unreachable network; a lookup counts because some systems report one that
failed for want of a connection as a missing name. A refused connection, a certificate error and
any HTTP answer SHALL NOT be marked, and when one of a site's addresses refused while another
timed out, the refusal SHALL decide.

#### Scenario: A connection that times out

- **WHEN** an HTTP check's request fails because the connection timed out
- **THEN** its summary reads "Could not connect: the connection timed out", and the run is marked
  as one a slow link explains

#### Scenario: A server that refuses

- **WHEN** an HTTP check's request is refused by the server
- **THEN** its summary reads "Could not connect: the server refused the connection", and the run
  is not marked

### Requirement: Hold failures while Watch's link is slow

When a web or vendor check on a public internet host fails in a way a slow link explains, Watch
SHALL time its probe, which it reuses for 15 seconds as for the offline hold. Durations, and which
of two pieces of evidence came first, SHALL use a clock that a step of the wall clock does not
move; a probe SHALL be reused only while both clocks call it recent, and spans that should count
time asleep, such as how long a spell lasts, SHALL use the wall clock. An address on the local
network, and a name such as nas or fritz.box, is not a public host. Its link SHALL count as slow when the first probe address to answer
took a second or more, or 400 milliseconds or more while checks on two or more internet sites
newly failed that way within two minutes, names under one domain counting as one site. Failures
that come in one batch of runs SHALL all count before any of them is decided. Probes that all run
out of time while a web request finishes passing, slower than they waited, SHALL count as slow
unless the probe list is in doubt, and so SHALL a recheck whose probes all run out of time just
after such a request, which SHALL NOT count against the probe list. After a quicker request,
probes that run out of time SHALL count against the list as before, so a list a firewall drops is
still found out. While the link is slow, such a
failure SHALL be held as it is while offline: kept in the history as held, the check keeping its
last result, with no change event or alert, for at most an hour of the check's runs in a row, each
due a cadence after the held run began. A failure a slow link does not explain, and any failure of
a check on the local network or the tailnet, SHALL be recorded as usual. A check whose last run was
held SHALL wait up to 45 seconds for an answer instead of 15. Watch SHALL remember when its link
turned slow. Every probe answer SHALL update the spell: one that shows the link slow begins or
extends it, and one that does not ends it. A probe or a check that answers within 400 milliseconds
after a probe began SHALL outrank that probe; going offline SHALL end the spell, and so SHALL 30
minutes without a slow probe.

#### Scenario: The link is slow

- **WHEN** a passing HTTP check's connection times out and the probe takes 2 seconds to answer
- **THEN** the check keeps its passing result, its history shows a run held while the connection
  was slow, and no event is made

#### Scenario: The site is down on a quick link

- **WHEN** a passing HTTP check's connection times out twice in a row and the probe answers
  within 100 milliseconds
- **THEN** the check fails and an event is made, as before

#### Scenario: Two sites at once

- **WHEN** one site's confirming run and another site's first failure both time out in one batch,
  and the probe takes 500 milliseconds to answer
- **THEN** both failures are held

#### Scenario: A device on the local network

- **WHEN** a check on a local network address times out twice while the probe takes 2 seconds
- **THEN** the check fails and an event is made, since the internet's speed says nothing about it
