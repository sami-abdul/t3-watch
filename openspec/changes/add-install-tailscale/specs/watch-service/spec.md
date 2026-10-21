## ADDED Requirements

### Requirement: Page on the tailnet

When Tailscale runs on the machine with HTTPS certificates on and `publicUrl` is unset or was
set by install, `t3-watch install` SHALL serve the page with `tailscale serve` and never `funnel`,
on Watch's port plus one or the next free HTTPS port, SHALL set `publicUrl` to the machine's
tailnet address on that port before the service starts, and SHALL check afterwards that the
address answers. It SHALL record that address and whether it made the route or found one that
already sent an HTTPS port to Watch alone: a later install uses the route again or puts it back,
and `t3-watch uninstall` and `install --no-tailscale` take down only a route install made, while
it still sends to Watch alone on this machine. It SHALL NOT use a route Funnel opens to the public
internet, and SHALL warn about one that sends to Watch. A `publicUrl` install did not set SHALL be
left alone without asking Tailscale. Otherwise install SHALL point sign-in links at the machine
and say why, naming the command to run when the step needs an administrator.

#### Scenario: A laptop with Tailscale

- **WHEN** Tailscale runs with HTTPS certificates on, no HTTPS port is served, and the person runs
  `t3-watch install`
- **THEN** the page is served at `https://<machine>.<tailnet>.ts.net:8461`, `publicUrl` names that
  address, and sign-in links point there

#### Scenario: Not allowed to serve

- **WHEN** Tailscale refuses the serve command because the user is not its operator
- **THEN** install leaves the page on the machine and prints `sudo tailscale set --operator=$USER`
  to run once before installing again

#### Scenario: Port taken

- **WHEN** another service already uses HTTPS port 8461 on the tailnet
- **THEN** install serves the page on the next free port and leaves the other route as it was

#### Scenario: A route the person made

- **WHEN** the person served Watch on port 9000 themselves, and later runs install and uninstall
- **THEN** install points links at port 9000, and uninstall leaves that route as it is

#### Scenario: A route on Funnel

- **WHEN** a route to Watch on port 9000 is also open through Funnel
- **THEN** install serves the page on another port, keeping it on the tailnet, and warns that port
  9000 puts the page on the public internet
