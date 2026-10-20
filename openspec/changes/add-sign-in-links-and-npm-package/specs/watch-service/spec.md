## ADDED Requirements

### Requirement: One-time sign-in links

The page SHALL sign a browser in only through a one-time code: a random code stored as a hash,
valid for 10 minutes, deleted when used. `t3-watch url` and `t3-watch install` SHALL print a link
with such a code and SHALL NOT print the access token. `/signin` SHALL refuse a used, expired or
unknown code and SHALL NOT accept the access token.

#### Scenario: A link used twice

- **WHEN** a browser opens a sign-in link and a second browser opens the same link
- **THEN** the first is signed in and the second gets a refusal that says to make a new link

#### Scenario: An old link

- **WHEN** a sign-in link is opened 11 minutes after it was made
- **THEN** it is refused

### Requirement: Loopback listener

When `host` names one address that is not loopback and not every interface, the service SHALL also
listen on 127.0.0.1 at the same port. If that bind fails, the service SHALL log it and keep
serving on `host`.

#### Scenario: Bound to a tailnet address

- **WHEN** `host` is a tailnet address and the service starts
- **THEN** the page answers on the tailnet address and on 127.0.0.1 at the same port

### Requirement: Installable package

The packed npm tarball SHALL contain the built server, page and inline view, the vendor catalog
and the CLI, and SHALL run `t3-watch` after `npm install -g` with no build step.

#### Scenario: Installing the tarball

- **WHEN** the packed tarball is installed with `npm install -g` into an empty prefix
- **THEN** `t3-watch` prints its help, starts, and answers `t3-watch status`
