## ADDED Requirements

### Requirement: Only what the person allows

The scan SHALL read only the folders in the saved choice and only the logins it allows: the
GitHub CLI, AWS CLI profiles, and keys in `.env` files. A choice that does not mention a login
SHALL allow it, so an install from before the choice reads as it did. Watch SHALL show, before a
scan, each folder with the number of repositories it holds, and each login with whether it is on
this machine.

#### Scenario: AWS not allowed

- **WHEN** the person unticks AWS CLI profiles and scans
- **THEN** Watch runs no `aws` command and suggests no AWS checks

#### Scenario: Keys in .env files not allowed

- **WHEN** the person unticks keys in `.env` files and scans
- **THEN** Watch opens no `.env` file and stores no key from one
