## Why

Watch 0.5.1 has a recorded demo but no public site. Alerts require T3 Code, and the catalog
does not yet cover several common developer services. Sami authorized the site, Slack alerts,
more GET-only vendor descriptions and release 0.6.0 on 24 October.

## What Changes

- Publish a static site at t3-watch.lfglabs.ai on the appin60 Cloudflare Pages account. It carries
  the existing recording, checks, installation steps, registry and source links, a favicon,
  Open Graph image and security.txt. Only that subdomain's DNS record is authorized.
- Let a signed-in browser save a Slack incoming webhook through the page. Encrypt its URL with
  the existing keyring, never return it through the state or MCP, and deliver change alerts and
  test messages independently of T3 alerts. Keep existing T3 settings and delivery working.
- Add GET-only catalog descriptions for Vercel, Cloudflare, Neon, Supabase, Render, Twilio,
  SendGrid, Resend and Linear where the current engine can prove a key works. Check endpoints
  and permissions against vendor documentation, and document any incompatible vendor.
- Publish 0.6.0 to npm and the MCP Registry, then update Leviathan's live service and confirm
  watch_status and existing alert settings. Read the newest session's last rate_limits event
  before each release step, and stop at 70 percent weekly usage.

## Capabilities

### New Capabilities

- `watch-site`: the public introduction and installation page.

### Modified Capabilities

- `watch-service`: Slack delivery, vendor descriptions and release 0.6.0.
- `watch-page`: Slack configuration and test results.

## Impact

`site/`, `scripts/build-site.ts`, `docs/launch/`, `README.md`, `catalog/`, `src/server/`,
`src/web/Alerts.tsx`, `src/web/client.ts`, `src/web/logic.ts`, `package.json`, `server.json`
and this change's artifacts. No new runtime dependencies or hosted Watch service.
