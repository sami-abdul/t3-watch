## 1. Service

- [x] 1.1 `src/server/connectivity.ts`, `src/server/connectivity.test.ts`, `src/server/config.ts`,
      `src/server/config.test.ts`:
      the link tracker: a recent internet pass, one shared probe reused for a minute, `probeUrls`,
      and the offline state stored with the time it began.
- [ ] 1.2 `src/server/runner.ts`, `src/server/store.ts`, `src/server/app.ts`,
      `src/server/runner.test.ts`: a non-passing result from a check that needs the internet is
      held while Watch is offline; heartbeats and loopback HTTP checks never are.

## 2. Page and chat

- [ ] 2.1 `src/server/state.ts`, `src/web/Home.tsx`: the state carries the link; Home shows the
      offline notice.
- [ ] 2.2 `src/server/state.ts`, `src/server/chat.test.ts`: the text status leads with the offline
      line.

## 3. Docs

- [ ] 3.1 `README.md`: what Watch does when its own link is down, and `probeUrls`.

## 4. Verification

- [ ] 4.1 `pnpm test`; `pnpm typecheck`; `pnpm build`; `openspec validate add-connectivity-hold --strict`.
- [ ] 4.2 On a throwaway instance whose probe addresses are unreachable: a failing check is held
      with no event, and the page shows the notice; with the probe answering, the same failure
      makes an event.
