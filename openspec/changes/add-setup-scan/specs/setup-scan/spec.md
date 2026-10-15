## ADDED Requirements

### Requirement: Find services in projects

The scan SHALL read git repositories under each configured root and match manifests and `.env`
variable names against the catalog, recording for each vendor the project and file that revealed
it. It SHALL NOT return any variable's value.

#### Scenario: A Python project uses Stripe

- **WHEN** a repository's `requirements.txt` lists `stripe`
- **THEN** the scan lists Stripe as found in that repository

### Requirement: Test access once

The scan SHALL test the `gh` login, each AWS profile with `sts get-caller-identity`, and each
catalog key found in a `.env` file with the vendor's key check. A working `.env` key SHALL be
stored encrypted. Two profiles that reach one AWS account SHALL show as one access row.

#### Scenario: Expired SSO login

- **WHEN** an AWS profile's SSO session has expired
- **THEN** its access row says so and names the command that renews it

### Requirement: Propose and trial-run checks

For each reachable service the scan SHALL propose the catalog's checks and run each once without
turning it on. A GitHub repository with no Actions runs SHALL get no CI check.

#### Scenario: A working Pipedrive key

- **WHEN** a Pipedrive key from a `.env` file passes its key check
- **THEN** the review lists the Pipedrive checks, each with the result of one run

### Requirement: Review and apply

Applying SHALL turn on the ticked checks and remove the unticked scan-found keys. A key the user
removed SHALL stay removed on later scans until added again, and checks the user left off SHALL
stay off.

#### Scenario: Scan twice

- **WHEN** setup runs twice with nothing changed
- **THEN** the services, checks and keys are the same after the second run
