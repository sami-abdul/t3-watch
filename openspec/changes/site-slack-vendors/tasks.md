## 1. Site

- [x] 1.1 `site/`, `scripts/build-site.ts`, `package.json`: static page, demo, installation,
      favicon, Open Graph image, security.txt and reproducible site build.
- [x] 1.2 `docs/launch/site.md`, `README.md`: deployment and public site links.
- [x] 1.3 Verify the page in desktop and mobile browsers, publish to appin60 Cloudflare Pages,
      add only t3-watch.lfglabs.ai DNS, and verify HTTPS and assets. Report item 1 to HQ.

## 2. Slack

- [x] 2.1 `src/server/`: encrypted Slack webhook settings, browser-only writes, independent
      delivery, retry bookkeeping and test results, with tests for errors and secret privacy.
- [x] 2.2 `src/web/Alerts.tsx`, `src/web/client.ts`, `src/web/logic.ts`: password input,
      save, disconnect, test and results. Demo accepts no secrets. Verify in a browser.
- [x] 2.3 `README.md`, `site/index.html`: Slack instructions and capabilities. Deploy the
      updated site and report item 2 to HQ.

## 3. Vendor descriptions

- [x] 3.1 `catalog/`, `src/server/vendors.test.ts`: GET-only vendors checked against public
      docs, with fixtures proving success, denied access and configured key handling.
- [x] 3.2 `docs/launch/vendor-sources.md`, `README.md`, `site/index.html`: public source links,
      minimum permissions, unsupported cases and current coverage. Report item 3 to HQ.

## 4. Release and verify

- [x] 4.1 Run `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm build:site` and
      `openspec validate site-slack-vendors --strict`. Review changes and fix confirmed findings.
- [x] 4.2 Run gitleaks, commit by explicit path in small steps and push finished work to main.
- [x] 4.3 `package.json`, `server.json`: 0.6.0 together. Check the weekly budget before each
      publishing step, publish npm, test a clean install and publish the MCP Registry entry.
- [x] 4.4 Verify npm and registry 0.6.0, update Leviathan's live service, confirm watch_status
      answers and existing alerts remain configured. Record evidence in this file and report
      item 4 to HQ. Stop cleanly if the weekly budget reaches 70 percent.

Site evidence, 24 October: main a74c519, Cloudflare Pages project t3-watch and the one
authorized CNAME live. Chrome verified HTTPS and all assets at 200, video playback at
60.13 seconds, exact clipboard commands and no overflow at 360, 390, 720, 1280 and 1440 pixels.
259 tests, both typechecks, strict validation and gitleaks passed. HQ received item 1.

Slack evidence, 24 October: 269 tests pass, with ten new tests covering encrypted storage,
reopen, URL restrictions, separate T3 and Slack queues, twenty-attempt limit, redirects,
Retry-After, obsolete results, markup, browser authorization, demo refusal and MCP privacy.
Typechecks and all builds pass. A disposable Watch in Chrome passed masked save, input clearing,
a mocked Slack test and disconnect at desktop and phone sizes. No real Slack message was sent.
A narrow wrapping fix in src/web/ui.tsx closed the check actions' existing mobile overflow.
The live site explicitly labels Slack as coming in 0.6.0 until the npm release.

Vendor evidence, 24 October: nine JSON descriptions add Vercel, Cloudflare, Neon, Supabase,
Render, SendGrid, Resend, GitLab.com and DigitalOcean. docs/launch/vendor-sources.md records
each public endpoint, authentication and permissions source, with the Twilio and Linear limits.
64 catalog tests pass, including 55 new cases. An additional scan test discovers all nine
management keys without reading project credentials as management tokens. No real vendor key
was used.

Release candidate verification, 24 October: 325 tests, typechecks, all builds and strict
OpenSpec validation pass at 0.6.0. Manual diff review checked browser authorization, secret
redaction, independent queue accounting, stale in-flight results and documented API contracts.
The npm dry run contains 68 files with Slack server code and all nine new descriptions,
with no site build, credential file or signing key.

Released 24 October from bb3643a: npm and the MCP Registry both list 0.6.0 as latest.
A clean npm install contains the Slack module and all 21 descriptions, starts its demo,
signs a browser in, renders Slack, refuses a sample webhook and stops cleanly. The live
service on Leviathan was rebuilt and restarted. Its MCP handshake reports 0.6.0 and
watch_status answers with 21 of 22 checks passing, the same baseline as before. All 22
remain on; the existing unknown check remains unknown. Hash comparisons confirm the
configuration and T3 alert settings did not change. The signed live test was accepted
with HTTP 202. Slack stays unconfigured until a person pastes their own webhook on the page.
The site now describes released Slack and vendor support. HTTPS, assets and mobile layout
were checked again. Weekly usage was 25 percent before publication and the live update.
