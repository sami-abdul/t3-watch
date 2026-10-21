## ADDED Requirements

### Requirement: Install in every provider home

`t3-watch install --all` SHALL register Watch's MCP server in the default Claude Code and Codex
homes and in the home of every enabled Claude Code and Codex instance in T3 Code's settings,
setting `CLAUDE_CONFIG_DIR` or `CODEX_HOME` the way T3 does and running the instance's binary when
it names one. It SHALL register each home once, SHALL list each instance it leaves out with the
reason, and SHALL fall back to the default homes when T3's settings are missing or unreadable.
`t3-watch uninstall --all` SHALL remove the server from the same homes. Plain `install` SHALL say
how many more homes `--all` would cover.

#### Scenario: Two Claude accounts

- **WHEN** T3 runs a Claude Code instance with home `~/.claude-night` and the person runs
  `t3-watch install --all`
- **THEN** Watch's server is added with `CLAUDE_CONFIG_DIR` set to that folder, as well as in the
  default home

#### Scenario: An instance Watch cannot use

- **WHEN** T3 also runs an OpenCode instance and a Codex instance that is turned off
- **THEN** install lists both as skipped, with the reason, and registers the rest
