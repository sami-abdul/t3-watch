## ADDED Requirements

### Requirement: Tell a billing block from a failing build

When the latest finished run of a workflow failed, the GitHub check SHALL read the run's jobs and
the annotations of a failed job that never started a step. When no job of the run ran its steps
and failed, and a failure annotation says in GitHub's own words that it did not start the job for
billing, such as "The job was not started because recent account payments have failed or your
spending limit needs to be increased", the run SHALL count as not run rather than failed. When
every failed run is such a run, the check SHALL report that it could not run, with the summary
"GitHub didn't run CI: Actions is blocked on billing", naming each such workflow as GitHub names
it. A run whose job ran its steps and failed or timed out SHALL still fail the check, with any
run blocked on billing named after it. The check SHALL look back up to ten runs past a
workflow's runs blocked on billing to the last one that ran, and when that one failed, the check
SHALL fail, naming that run and saying GitHub has not run the workflow since. When the jobs or the
annotations of a run that never started cannot be read, or GitHub has not yet said why its jobs
did not start within ten minutes of the run starting, the check SHALL report that it could not
tell whether GitHub ran the workflow, with each reason, unless a real failure stands behind it or
beside it, in which case the workflow SHALL count as failed. A check with a maximum age SHALL
still fail when its workflow's newest success is older than that, whatever kept GitHub from
running it. A repository that stays blocked SHALL keep the same state from push to push, so it
makes one change event when it becomes blocked and none for each later blocked run. Each run SHALL
be read once GitHub's answer settles it, until the run is started again.

#### Scenario: Actions blocked on billing

- **WHEN** the latest run of CI on main failed, its one job never started, and the job's failure
  annotation says recent account payments have failed or the spending limit needs to be increased
- **THEN** the check could not run, its summary reads "GitHub didn't run CI: Actions is blocked
  on billing", and Home lists it under Could not run rather than Broken

#### Scenario: Another push while blocked

- **WHEN** a repository already blocked on billing gets another push whose run is blocked too, or
  whose jobs GitHub fails to list for a moment
- **THEN** no new change event or alert is made

#### Scenario: A real failure

- **WHEN** the latest run's job ran its steps and one failed or timed out
- **THEN** the check fails as before

#### Scenario: A failure GitHub has not run CI since

- **WHEN** a run on main ran and failed, and GitHub refused every later push for billing
- **THEN** the check still fails, its summary reads "CI failed on main in acme/api; GitHub hasn't
  run CI since: Actions is blocked on billing", and a later push whose jobs cannot be read changes
  nothing

#### Scenario: An answer that cannot be read

- **WHEN** GitHub's list of jobs for a failed run that never started answers with an error
- **THEN** the check could not run, and its summary says it could not tell whether GitHub ran the
  workflow, with the error

#### Scenario: A stale schedule while blocked

- **WHEN** a check with a maximum age of six hours finds its workflow blocked on billing and its
  newest success seven hours old
- **THEN** the check fails, naming the age of the newest success and the billing block
