## ADDED Requirements

### Requirement: Connect alerts panel

The Alerts section in Details SHALL guide the person through three numbered steps, each marked
done when it is: make a signing secret, ask the Watch thread to set up alerts, and send a test
alert. The secret SHALL show once and only on the page. The second step SHALL copy the request on
the page and send it from the chat view. The third SHALL be available once alerts have an
address, and SHALL show the result. Home SHALL say when alerts are off while checks are on, or
when the last test alert was not accepted, and SHALL open the panel.

#### Scenario: First connection

- **WHEN** the person makes a secret, the Watch thread sets the address, and the person sends a
  test the webhook accepts
- **THEN** all three steps show as done and the section says alerts go to the webhook's host,
  signed

#### Scenario: A test fails

- **WHEN** the last test alert got 401
- **THEN** Home says the last test was not accepted, and its button opens the panel
