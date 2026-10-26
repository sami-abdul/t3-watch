## ADDED Requirements

### Requirement: Page-load counting
The public site SHALL let Cloudflare Web Analytics count page loads. Its Content Security Policy
SHALL allow scripts from `https://static.cloudflareinsights.com` and connections to
`https://cloudflareinsights.com`, and SHALL otherwise keep its same-origin rules. The site SHALL
set no cookies of its own and load no other third-party scripts.

#### Scenario: A visitor opens the site
- **WHEN** a visitor's browser loads https://t3-watch.lfglabs.ai/
- **THEN** the injected Cloudflare Web Analytics beacon runs without a CSP violation
- **AND** its report to `/cdn-cgi/rum` succeeds
