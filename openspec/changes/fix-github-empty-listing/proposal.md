## Why

Twice on 22 October, for one repository at 15:01 UTC and another at 15:48, GitHub's runs API
briefly answered with no runs at all for main on a repository that had them. Watch read that as
"No finished runs yet", a check that could not run, confirmed it a minute later, alerted, and
recovered when GitHub listed the runs again. A repository does not lose its history between two
reads; GitHub had a moment.

## What Changes

- **Every listing counted.** Each GitHub result read from `gh run list` records how many runs it
  listed and for which workflow, branch and repository. A pause, a snooze or a resume keeps that
  memory, and an edit to another branch or workflow starts it over. Runs kept from before this
  change count by what they kept, so a check resumed after the deploy is covered from its first run.
- **Held, like a slow link.** When `gh run list` answers with no runs at all for a check whose
  latest counted listing had runs for the same workflow, branch and repository, the GitHub check
  marks its result as trouble at GitHub's end that passes. The runner holds it for up to an hour of
  the check's runs in a row, with no change and no alert, and without probing Watch's link, since
  gh answered; the run shows in the check's history as held, and the next run waits no longer than
  usual.
- **Said plainly if it lasts.** Past the hour the check records "GitHub listed no runs for main in
  acme/api, though it had them before" instead of "No finished runs yet", which stays for a
  repository that has never had runs.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `watch-service`: a GitHub check holds a sudden empty list of runs, and names it if it lasts.

## Impact

`src/server/checks/github.ts`, `src/server/checks/types.ts`, `src/server/runner.ts`,
`src/server/connectivity.ts` and `src/server/store.ts`, with tests in `src/server/checks.test.ts`
and `src/server/runner.test.ts`. No migration and no new package.
