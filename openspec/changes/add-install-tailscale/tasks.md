## 1. Tailscale

- [x] 1.1 `src/server/tailscale.ts`, `src/server/tailscale.test.ts`, `src/server/proc.ts`, whose
      `firstLine` the CLI shares: this machine's tailnet name
      and certificates, the HTTPS ports Tailscale serves, the port for Watch, and serving or
      stopping the route, with a reason for every refusal.
- [x] 1.2 `src/server/cli.ts`, `src/server/config.ts`, `src/server/config.test.ts`,
      `src/server/tailscale.test.ts`, `src/server/cli.test.ts`: `install` serves the page and sets
      `publicUrl` and `tailnetUrl` before the service starts, checks the address after, undoes the
      route when the service fails, and takes `--no-tailscale`; `uninstall` stops its own route.
- [x] 1.3 `README.md`: install puts the page on the tailnet.

## 2. Verify

- [x] 2.1 Tests, typecheck, build and `openspec validate add-install-tailscale --strict`.
- [x] 2.2 Review rounds at high effort, with each finding fixed or declined with a reason: three
      rounds found 10 each; 29 fixed, 1 declined in `.wattson/decisions.md`.
- [ ] 2.3 On Leviathan's real Tailscale, against a scratch Watch: the route is made on a free port,
      the HTTPS address answers, and the route is stopped again, leaving the other routes as they
      were; the live Watch restarts briefly with its alert settings intact and 22 of 22 checks
      passing.
