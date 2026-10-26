## Why

Cloudflare Web Analytics is installed for the lfglabs.ai zone and injects its beacon into
t3-watch.lfglabs.ai, but the site's Content Security Policy allows only same-origin scripts, so
browsers block it and no page loads are counted. Sami approved counting page loads on the LFG
sites on 26 October. Development is frozen to distribution; this header change counts as
distribution.

## What Changes

- Allow `https://static.cloudflareinsights.com` in `script-src` and add
  `connect-src 'self' https://cloudflareinsights.com` to the site's CSP, so the injected beacon
  loads and reports. The rest of the policy stays as it is.
- Update the deployment notes, which said the site has no analytics.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `watch-site`: the public page counts page loads with Cloudflare Web Analytics.

## Impact

`site/_headers`, `docs/launch/site.md` and this change's artifacts. No service, package or
release change.
