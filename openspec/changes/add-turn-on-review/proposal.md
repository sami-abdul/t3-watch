## Why

The review turns every ticked check on with one press of Watch these, and each check then runs on
its own clock against something: a URL, a repository's CI, an AWS account, a vendor's API with a
stored key. The review names checks by their intent and their trial run, never by what they will
contact, so the person agrees to a schedule of calls they cannot see.

## What Changes

- **Each check's target.** Watch words what each check contacts, such as "GET
  https://example.com/, expecting Welcome" or "Stripe's API at https://api.stripe.com, with
  the key ending 1234", never a secret such as a heartbeat token. The review shows it on every
  suggested check, and Details on every check.
- **Look before turning on.** Watch these first lists every check it will turn on, each with its
  target and how often it runs, with Turn them on and Back. Saving with no checks needs no list.
- **For agents.** `watch_scan` gives each suggestion's target.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `watch-page`: targets in the review and Details, and the list before turning checks on.
- `watch-chat`: targets in `watch_scan`.

## Impact

A new `src/server/targets.ts` and `src/server/targets.test.ts`; `src/server/scan.ts`,
`src/server/state.ts`, `src/server/mcp.ts`, `src/web/Setup.tsx`, `src/web/Details.tsx`,
`src/web/logic.ts` and `src/web/logic.test.ts`.
