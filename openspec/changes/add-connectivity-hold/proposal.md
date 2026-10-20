## Why

When Watch's own machine loses its connection, every check that needs the internet fails at
once and each failure becomes an alert. On 2026-10-20 Leviathan's saturated, lossy link made 13
of 22 checks fail while the sites themselves answered. People learn to ignore an alert that cries
wolf, and the alerts cannot even leave the machine while the link is down.

## What Changes

- **Watch checks its own link before it calls a failure.** When a check that needs the internet
  does not pass, Watch asks whether it can reach the internet: yes if another such check passed
  in the last 2 minutes, otherwise it probes two public addresses run by different providers, and
  any answer within 5 seconds means it is online. A probe's answer counts for a minute, and
  checks that fail together share one probe.
- **While Watch is offline, those failures are held.** The run is kept in the check's history,
  marked as held, but the check keeps its last result, nothing changes state, and no event or
  alert is made. The check runs again at its normal cadence.
- **Which checks need the internet:** HTTP checks, except those on localhost or a loopback
  address, and GitHub, AWS and vendor checks. Heartbeats are never held.
- **People can see it.** Watch remembers when it went offline. Home and the text status say so
  until a probe answers or a check that needs the internet passes.
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
and the offline state lives in the existing `kv` table.
