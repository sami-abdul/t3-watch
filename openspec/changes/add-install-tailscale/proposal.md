## Why

The page listens on 127.0.0.1, so it opens only on the machine Watch runs on. Reaching it from a
phone or laptop means learning `tailscale serve`, picking a port that is free, and editing
`publicUrl` by hand, which is what Sami and the worker did on Leviathan on 2026-10-21. Someone
who is not Sami will not.

## What Changes

- **Tailscale in install.** When Tailscale runs on the machine with HTTPS certificates on and
  `publicUrl` is unset, `install` serves the page on the tailnet with `tailscale serve`, never
  `funnel`, on Watch's port plus one or the next free HTTPS port, sets `publicUrl` to the
  machine's tailnet address, and checks after the restart that the address answers. Config
  records that address as `tailnetUrl`, and `tailnetRoute` says whether install made the route or
  found one the person made, so only install's own route is ever taken down. A route on Funnel is
  never used, and one that sends to Watch gets a warning. A `publicUrl` install did not set is left
  alone without asking Tailscale.
- **Clear refusals.** No Tailscale, Tailscale stopped, no tailnet name, certificates off, a
  `publicUrl` that names somewhere else, a port taken by another service, or a user Tailscale will
  not let serve: each leaves the page on the machine and says why, with the one command to run
  when it takes an administrator.
- **`install --no-tailscale`** leaves the page on the machine, taking an earlier install's route
  off the tailnet. **`uninstall`** stops the route install made.
- `config.json` gains `tailnetUrl` and `tailnetRoute`, kept only when install sets both.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `watch-service`: install puts the page on the tailnet.

## Impact

A new `src/server/tailscale.ts` and `src/server/tailscale.test.ts`; `src/server/cli.ts`,
`src/server/cli.test.ts`, `src/server/config.ts`, `src/server/config.test.ts`,
`src/server/proc.ts` and `README.md`. A machine without Tailscale installs as before, with
one more line of output.
