## ADDED Requirements

### Requirement: Sign-in link tool

The MCP server SHALL offer `watch_sign_in_link`, which returns a one-time sign-in link for the
page. The agent instructions SHALL say to make one only when the person asks to open the page,
that it works once within 10 minutes, and SHALL keep forbidding reading Watch's files or token.

#### Scenario: The person asks for the page

- **WHEN** the person asks the Watch thread for a link to the page
- **THEN** the agent calls `watch_sign_in_link` and gives the link, which signs one browser in
