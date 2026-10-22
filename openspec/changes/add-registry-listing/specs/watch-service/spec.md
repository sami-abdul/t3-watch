## ADDED Requirements

### Requirement: Name the package for the MCP Registry

The npm package SHALL carry `mcpName` equal to the name of the registry entry in `server.json`,
and the entry SHALL name the same package, at the package's own version, as both its version and
its package's version, run with the `mcp` argument over stdio. The entry's description SHALL fit
the registry's limit of 100 characters. The README SHALL open with the lead line, and the entry's
description SHALL be that line or its shortest faithful cut.

#### Scenario: A release that forgets the entry

- **WHEN** `package.json` moves to a new version, or a new `mcpName`, and `server.json` does not
- **THEN** the tests fail and name the field that differs

#### Scenario: A description past the limit

- **WHEN** the entry's description is longer than 100 characters
- **THEN** the tests fail before anything is published

### Requirement: Report the server's version in the inline view

The inline view SHALL report to the MCP host the version the server reports, which the server
writes into the view as it serves it.

#### Scenario: A view built before a version change

- **WHEN** the server runs from a package at a new version and serves a view built earlier
- **THEN** the view reports the new version to the host, as the server does
