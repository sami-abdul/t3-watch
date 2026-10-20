## Why

When Watch's own machine loses its connection, every check that needs the internet fails at
once and each failure becomes an alert. On 2026-10-20 Leviathan's saturated, lossy link made 13
of 22 checks fail while the sites themselves answered. People learn to ignore an alert that cries
wolf, and the alerts cannot even leave the machine while the link is down. A lossy link is worse
to detect: the probes still answer, so a single dropped request still reads as an outage.

## What Changes

- **Watch checks its own link before it calls a failure.** When a check that needs the internet
  does not pass, Watch probes two public addresses run by different providers, and any answer
  within 5 seconds means it is online. Checks that fail together share one probe, and a check
  that passes meanwhile outranks it.
- **While Watch is offline, those failures are held.** The run is kept in the check's history,
  marked as held, but the check keeps its last result, nothing changes state, and no event or
  alert is made. The check runs again at its normal cadence.
- **Which checks are held:** every check except heartbeats and HTTP checks on this machine.
  Only a pass from a check that reaches the internet proves the link; a pass on the local network
  or the tailnet does not. Watch probes only for a result that would change a check's state.
- **Holding has limits.** A check's failures are held for at most an hour of its own runs in a
  row, so a wrong probe list or a restart cannot hide them for good, and Watch stops counting
  itself offline 30 minutes after its last failed probe.
- **People can see it.** Watch remembers when it went offline. Home and the text status say so
  until a probe answers or a check that needs the internet passes.
- **One bad run does not alert.** A check that was passing fails only when two runs in a row do
  not pass; the second runs within a minute of the first, and a pass counts at once.
- **A probe list that disagrees is flagged.** If the probe addresses fail twice in an hour right
  after a check reached the internet, Watch stops trusting them, records failures as usual and
  says so on Home, pointing at `probeUrls`.
- **The probe addresses can be changed** with `probeUrls` in `config.json`, for networks that block
  the defaults; an empty list turns holding off.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `watch-service`: the connectivity probe, held results and the `probeUrls` setting.
- `watch-page`: the offline notice on Home.
- `watch-chat`: the offline line in the text status.

## Impact

New `src/server/connectivity.ts` and its test. `src/server/runner.ts`, `src/server/store.ts`,
`src/server/app.ts`, `src/server/config.ts`, `src/server/state.ts`, `src/web/Home.tsx` and
`README.md` change. No new dependency, no schema change: held runs use the existing `runs` table
and the offline state lives in memory, so a restart starts online.
