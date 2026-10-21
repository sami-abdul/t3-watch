## Why

On 21 October two site checks failed together with "Could not connect: fetch failed" and woke
the Watch thread, though both sites were up. Watch's own WiFi link was slow: the ping averaged
about 850 ms and peaked at 2.1 s, with no loss. The connectivity hold did not apply, because the
probe addresses still answered, only slowly. One of the two checks had flapped the same way six
times since 20 October. Its history shows the pattern: a first run that gave up after 2.4 seconds,
then a confirming run that hit the 10-second connect timeout of Node's fetch. A connection that
times out or resets on a slow link says little about the site, and the summary said nothing about
why, since Node's fetch keeps the reason in its error's cause.

## What Changes

- **Why a request got no answer.** HTTP and vendor checks read the reason from the fetch error's
  cause and name it in words, such as "Could not connect: the connection timed out" or "the
  server refused the connection". They also mark whether a slow or failing link of Watch's own
  could explain it: a timeout, a reset or dropped connection, a name lookup that did not finish,
  an unreachable network. A refused connection, a certificate error and any HTTP answer stay the
  site's.
- **A slow link holds such failures.** For such a failure of a web or vendor check on the
  internet, Watch times the probe it already uses for the offline hold. A probe that takes a
  second or more, or 400 ms or more while checks on two or more sites newly failed that way within
  two minutes, means the link is slow; a batch's failures all count before any is decided. The failure is then
  held as it is while offline: kept in the history as held, no new state, no event, for at most
  an hour of the check's runs. A failure a slow link does not explain, and a check on the local
  network or the tailnet, counts as before.
- **More patience on the next run.** A check whose last run was held waits up to 45 seconds for
  an answer instead of 15. The 10-second connect timeout inside Node's fetch stays, since
  changing it would take another package, and holding covers what it misses.
- **Saying so.** Home and the text status say since when the connection has been slow and that
  checks whose connections time out or drop are held. The spell ends when a probe no longer
  shows it slow, when a probe or a check answers within 400 ms, when Watch goes offline, or 30
  minutes after the last slow probe.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `watch-service`: the reason a request got no answer, and holding what a slow link explains.
- `watch-page`: the slow-link line on Home.
- `watch-chat`: the slow-link line in the text status.

## Impact

New `src/server/checks/network.ts`. Changed: `src/server/checks/http.ts`,
`src/server/checks/types.ts`, `src/server/checks/vendor.ts`, `src/server/vendors.ts`,
`src/server/connectivity.ts`, `src/server/runner.ts`, `src/server/store.ts`,
`src/server/notices.ts`, `src/server/state.ts` and `src/web/Home.tsx`, with tests in
`src/server/checks.test.ts`, `src/server/connectivity.test.ts`, `src/server/runner.test.ts`,
`src/server/testkit.ts` and `src/web/logic.test.ts`, plus `src/server/proc.ts` for a clock
that a step of the wall clock does not move, and `README.md`. No new package and no migration.
