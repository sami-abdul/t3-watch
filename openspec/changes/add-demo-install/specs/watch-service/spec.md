## ADDED Requirements

### Requirement: A demo with sample checks

`t3-watch demo` SHALL start a Watch in a new folder, listening on 127.0.0.1 only whatever the
environment sets, holding sample products whose checks pass and fail, with history, a draft
waiting for the person, a new check to review and alerts connected. Every command, request and
alert in the demo SHALL get a canned answer. As a sample Watch it SHALL refuse to take or remove
a key, make a signing secret, scan or change what it may read, from the page and from agents, so
it runs no real command, sends nothing off the machine and reads no real folder, AWS profile or
key. Its session cookie SHALL have a name of its own and last until the browser closes, and its
sign-in words SHALL point at the demo, not at a real Watch. It SHALL print a one-time sign-in link
and SHALL remove its folder however it stops, short of a kill no process can catch.

#### Scenario: Trying the page

- **WHEN** someone runs `t3-watch demo` and opens the link it prints
- **THEN** Home shows sample products with one broken, a draft and a new check to review, and no
  request has left the machine

#### Scenario: Stopping the demo

- **WHEN** the person stops the demo with Ctrl-C
- **THEN** the demo's folder is gone, and a Watch on the same machine is still signed in
