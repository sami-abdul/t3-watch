## Why

At 01:38 UTC on 22 October Watch alerted that CI failed on main in a repository, but the run
never started. GitHub's annotation on its one job says "The job was not started because recent
account payments have failed or your spending limit needs to be increased." That is a billing
block on the account, not a failing build, and every repository that still has Actions on shows
it after each push. Watch read only the run's conclusion, failure, so it reported a broken build.

## What Changes

- **Billing told apart.** When the latest run of a workflow failed, the GitHub check reads the
  run's jobs and, for a job that never started, its annotations. When GitHub's annotation says in
  its own words that it did not start the job for billing, the check says so plainly, "GitHub
  didn't run CI: Actions is blocked on billing", with the workflow's own name, as a check that
  could not run rather than one that failed, so it sits apart from real failures on Home and in
  the status.
- **Once per repository.** A repository blocked on billing stays in that state from push to push,
  so it alerts once when it becomes blocked, not on every push. A real failure or a recovery after
  it alerts as usual.
- **Real failures still win.** A workflow whose job ran and failed or timed out is named as
  before, with any that GitHub refused to start named after it. The check looks back up to ten
  runs past those GitHub refused to the last one that ran, so a branch that broke before the block
  stays broken: "CI failed on main; GitHub hasn't run CI since: Actions is blocked on billing".
- **Unreadable is not failed.** When GitHub's answer about a run that never started cannot be
  read, the check says it could not tell, naming each reason, as it does when the runs themselves
  cannot be read, so a moment's error never turns a blocked repository into a failing one. When a
  real failure stands behind it, or beside it, the check fails either way, so a failing
  repository stays failing. A job that never started with no word from GitHub yet is read again
  for ten minutes after its run started, then counts as GitHub reports it.
- **Stale schedules still fail.** A check with a maximum age still fails when its workflow's newest
  success is older than that, whatever kept GitHub from running it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `watch-service`: the GitHub check tells a billing block from a failing build.

## Impact

`src/server/checks/github.ts`, with tests in `src/server/checks.test.ts` and
`src/server/runner.test.ts`. A failed run costs one `gh api` call for each page of its jobs and at
most two for annotations, once per run until it is started again, since a finished run does not
change, with at most three workflows read at once and each call given longer after a held run; a
passing run costs none. No new package and no migration.
