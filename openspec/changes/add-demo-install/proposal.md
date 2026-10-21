## Why

Someone deciding whether to install Watch, and the README that shows them the page, need a Watch
with checks in it. A real install shows its owner's own systems, which cannot go in a public
README, and a fresh one shows nothing until a scan. A demo with sample checks gives the README its
screenshots and lets anyone try the page without connecting an account.

## What Changes

- **`t3-watch demo`.** Starts a Watch in a new folder of its own, on 127.0.0.1 whatever the
  environment says, filled with sample products: a storefront with its CI, a billing API whose
  health check fails with an agent's note on it, docs with a new check to review, a nightly backup
  that pings, an AWS account and a Stripe key, plus a draft waiting for the person, a history of
  changes and alerts already connected. It prints a one-time sign-in link and removes its folder
  when stopped.
- **Nothing real.** Every check, probe and alert in the demo gets a canned answer: no command
  such as gh or aws runs, and no request leaves the machine. As a sample Watch it takes no key,
  makes no signing secret, does not scan and keeps what it may read, whether the page or an
  agent asks, so no real folder, AWS profile or key comes in. The sample key and secret are made
  up when it starts, and its session cookie has a name of its own, so signing in to the demo
  leaves a real Watch's session alone.
- **README screenshots.** The README shows Home, the products with their checks, and Details, all
  taken from the demo, and says how to run it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `watch-service`: a demo Watch with sample checks that reaches nothing real.

## Impact

New `src/server/demo.ts`, `src/server/demo.test.ts`, `docs/home.png`, `docs/checks.png` and
`docs/details.png`. Changed: `src/server/cli.ts`, `src/server/app.ts`, `src/server/scan.ts`,
`src/server/alerts.ts`, `src/server/extend.ts`, `src/server/http.ts`, `src/server/http.test.ts`,
`src/server/vendors.ts` and `README.md`. The screenshots stay out of the npm package, whose files
list does not include `docs/`.
