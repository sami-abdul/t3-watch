## 1. Service

- [x] 1.1 `src/server/connectivity.ts`, `src/server/connectivity.test.ts`, `src/server/config.ts`,
      `src/server/config.test.ts`:
      the link tracker: a recent internet pass, one shared probe reused for a minute, `probeUrls`,
      and the offline state stored with the time it began.
- [x] 1.2 `src/server/runner.ts`, `src/server/store.ts`, `src/server/app.ts`,
      `src/server/runner.test.ts`, `src/server/cli.ts`, `src/server/testkit.ts`: a non-passing result from a check that needs the internet is
      held while Watch is offline; heartbeats and loopback HTTP checks never are.

## 2. Page and chat

- [x] 2.1 `src/server/state.ts`, `src/web/Home.tsx`, `src/web/logic.test.ts`: the state carries the link; Home shows the
      offline notice.
- [x] 2.2 `src/server/state.ts`, `src/server/chat.test.ts`: the text status leads with the offline
      line.

## 3. Docs

- [x] 3.1 `README.md`: what Watch does when its own link is down, and `probeUrls`.

## 4. Review follow-ups

- [ ] 4.1 `src/server/config.ts`, `src/server/connectivity.ts`, `src/server/connectivity.test.ts`:
      one loopback helper for both files; checks on the local network, the tailnet or `.local`
      names need no internet, so they are never held and never vouch for the link.
- [ ] 4.2 `src/server/connectivity.ts`, `src/server/connectivity.test.ts`, `src/server/runner.ts`,
      `src/server/app.ts`: every failure probes, with answers reused for 15 seconds; the link state
      lives in memory, a pass outranks a probe that began before it, and offline lapses 30 minutes
      after the last failed probe.
- [ ] 4.3 `src/server/connectivity.ts`, `src/server/config.ts`, `src/server/state.ts`,
      `src/web/Home.tsx`, `src/server/chat.test.ts`: probe addresses must parse; holding stops
      after an hour offline, and the notice says so.

## 5. Verification

- [ ] 5.1 `pnpm test`; `pnpm typecheck`; `pnpm build`; `openspec validate add-connectivity-hold --strict`.
- [ ] 5.2 On a throwaway instance whose probe addresses are unreachable: a failing check is held
      with no event, and the page shows the notice; with the probe answering, the same failure
      makes an event.
