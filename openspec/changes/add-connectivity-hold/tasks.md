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

- [x] 4.1 `src/server/config.ts`, `src/server/connectivity.ts`, `src/server/connectivity.test.ts`:
      one loopback helper for both files; checks on the local network, the tailnet or `.local`
      names need no internet, so they are never held and never vouch for the link.
- [x] 4.2 `src/server/connectivity.ts`, `src/server/connectivity.test.ts`, `src/server/runner.ts`,
      `src/server/app.ts`, `src/server/chat.test.ts`: every failure probes, with answers reused for 15 seconds; the link state
      lives in memory, a pass outranks a probe that began before it, and offline lapses 30 minutes
      after the last failed probe.
- [x] 4.3 `src/server/connectivity.ts`, `src/server/config.ts`, `src/server/state.ts`,
      `src/web/Home.tsx`, `src/web/logic.test.ts`, `src/server/chat.test.ts`,
      `src/server/connectivity.test.ts`: probe addresses must parse; holding stops
      after an hour offline, and the notice says so.
- [x] 4.4 `src/server/hosts.ts`, `src/server/hosts.test.ts`, `src/server/config.ts`,
      `src/server/connectivity.ts`, `src/server/connectivity.test.ts`: one BlockList classifier for
      hosts; checks on the local network and the tailnet are held while offline, and only checks
      that reach the internet prove the link.
- [x] 4.5 `src/server/store.ts`, `src/server/runner.ts`, `src/server/runner.test.ts`,
      `src/server/chat.test.ts`, `src/server/state.ts`, `src/web/Home.tsx`, `src/web/logic.test.ts`:
      a check's failures are held at most an hour in a row, counted from its runs, and the notice
      says so.
- [x] 4.6 `src/server/store.ts`, `src/server/runner.ts`, `src/server/runner.test.ts`: only a failure
      that would change the check's state probes.
- [x] 4.7 `src/server/store.ts`, `src/server/runner.ts`, `src/server/runner.test.ts`,
      `src/server/chat.test.ts`: the cap counts an hour of the check's runs in one query, and a run
      recorded past it keeps the streak going while Watch stays offline.
- [x] 4.8 `src/server/runner.ts`, `src/server/connectivity.ts`, `src/server/runner.test.ts`: while
      Watch counts itself offline, a repeat failure probes and is held too, which keeps the notice
      up and the check's real failure reason in place.
- [x] 4.9 `src/server/hosts.ts`, `src/server/hosts.test.ts`, `src/server/config.ts`,
      `src/server/connectivity.ts`, `src/server/connectivity.test.ts`: unspecified addresses are this
      machine, the tailnet folds into the local network, `bareHost` lives in `hosts.ts`, vendor
      checks count by their API origin, and a check whose address does not parse is not held.

## 5. Verification

- [x] 5.1 `pnpm test`; `pnpm typecheck`; `pnpm build`; `openspec validate add-connectivity-hold --strict`.
- [x] 5.2 On a throwaway instance whose probe addresses are unreachable: a failing check is held
      with no event, and the page shows the notice; with the probe answering, the same failure
      makes an event.

## 6. Two runs before a failure

- [x] 6.1 `src/server/store.ts`, `src/server/runner.ts`, `src/server/runner.test.ts`: a non-passing
      run after a pass, or a new check's first, is pending and runs again within a minute; only the
      second in a row fails the check and makes an event.
- [x] 6.2 `src/server/runner.test.ts`, `src/server/chat.test.ts`: tests that expected a failure on one
      run wait for the confirming run.
- [x] 6.3 `README.md`: one bad run does not alert.
- [x] 6.5 `src/server/store.ts`, `src/server/runner.ts`, `src/server/store.test.ts`: the pending
      outcome lives on the check, so the next run that is not held confirms or clears it whenever
      it comes; state changes and a new definition clear it; existing databases gain the column.
- [x] 6.6 `src/server/runner.ts`, `src/server/runner.test.ts`: a run someone asks for records its
      result as it is.
- [x] 6.7 `src/server/store.ts`, `src/server/runner.test.ts`: a pending failure confirmed by a run
      that could not run makes an event; `recordHeld` and `recordPending` take a check id.
- [x] 6.8 `src/server/store.ts`, `src/server/state.ts`, `src/web/Home.tsx`,
      `src/server/runner.test.ts`: pending runs and checks read "Failed once, checking again" in
      the history, the status and on Home.
- [x] 6.9 `src/server/runner.ts`, `src/server/runner.test.ts`: a pause, snooze or new definition
      made during the probe wins over the run.
- [x] 6.10 `src/server/store.ts`, `src/server/store.test.ts`, `src/server/runner.test.ts`: a new key
      clears a pending run, the column migration survives another process adding it first, and
      `recordRun` reads the pending run from the check.
- [x] 6.11 `src/server/pending.ts`, `src/server/store.ts`, `src/server/state.ts`,
      `src/server/mcp.ts`, `src/web/Home.tsx`, `src/web/logic.test.ts`, `src/server/runner.test.ts`:
      the pending run keeps its outcome, summary and time, worded by outcome in one place, and
      shows in the history, the status, Home and the check's reply.
- [x] 6.12 `src/server/runner.ts`, `src/server/store.ts`, `src/server/runner.test.ts`: a change made
      at any point in a run wins over it, measured from the check as the run began, and an
      identical definition no longer counts as a change.
- [x] 6.13 `src/server/store.ts`, `src/server/store.test.ts`: a removed key clears a pending run, a
      stored pending run is checked field by field, and its summary is capped like the history's.
- [x] 6.14 `src/server/mcp.ts`, `src/server/runner.test.ts`: the `watch_set_check` reply drops its
      unreachable pending line, since `watch_check` carries the pending run, and the probe-pause
      test waits on the probe instead of a timer.
- [x] 6.4 `pnpm test`; `pnpm typecheck`; `pnpm build`; `openspec validate add-connectivity-hold --strict`;
      on a throwaway instance, a check that fails once and then passes makes no event, and one that
      fails twice in a row makes one.

## 7. A probe list that disagrees

- [x] 7.1 `src/server/connectivity.ts`, `src/server/connectivity.test.ts`: a check that reaches the
      internet while Watch counts itself offline sets off a fresh probe; two that fail within an
      hour flag the probe list, which stops holding, and any probe that answers clears it.
- [x] 7.2 `src/server/state.ts`, `src/web/Home.tsx`, `src/web/logic.test.ts`, `src/server/runner.ts`,
      `src/server/runner.test.ts`: Home and the text
      status say the probe addresses do not answer while such checks pass, and point at
      `probeUrls`.
- [x] 7.3 `README.md`: the probe-list notice.
- [x] 7.5 `src/server/connectivity.ts`, `src/server/connectivity.test.ts`: the doubt lasts until a
      probe answers or a restart, a passing check rechecks the list at most every 5 minutes while
      it lasts, and a recheck that began before a newer answer counts nothing.
- [x] 7.6 `src/server/notices.ts`, `src/server/state.ts`, `src/web/Home.tsx`, `README.md`: the
      notices share one wording with the config path, and the README says a restart clears the
      doubt too.
- [x] 7.7 `src/server/runner.ts`, `src/server/runner.test.ts`: the runner awaits the recheck, so the
      test syncs on it instead of a timer.
- [ ] 7.4 `pnpm test`; `pnpm typecheck`; `pnpm build`; `openspec validate add-connectivity-hold --strict`;
      on a throwaway instance with a probe address that refuses and a check that reaches the
      internet, a failing check is recorded once the list is flagged, and Home shows the notice.
