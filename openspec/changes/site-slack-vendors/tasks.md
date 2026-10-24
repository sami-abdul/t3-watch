## 1. Site

- [ ] 1.1 `site/`, `scripts/build-site.ts`, `package.json`: static page, demo, installation,
      favicon, Open Graph image, security.txt and reproducible site build.
- [ ] 1.2 `docs/launch/site.md`, `README.md`: deployment and public site links.
- [ ] 1.3 Verify the page in desktop and mobile browsers, publish to appin60 Cloudflare Pages,
      add only t3-watch.lfglabs.ai DNS, and verify HTTPS and assets. Report item 1 to HQ.

## 2. Slack

- [ ] 2.1 `src/server/`: encrypted Slack webhook settings, browser-only writes, independent
      delivery, retry bookkeeping and test results, with tests for errors and secret privacy.
- [ ] 2.2 `src/web/Alerts.tsx`, `src/web/client.ts`, `src/web/logic.ts`: password input,
      save, disconnect, test and results. Demo accepts no secrets. Verify in a browser.
- [ ] 2.3 `README.md`, `site/index.html`: Slack instructions and capabilities. Deploy the
      updated site and report item 2 to HQ.

## 3. Vendor descriptions

- [ ] 3.1 `catalog/`, `src/server/vendors.test.ts`: GET-only vendors checked against public
      docs, with fixtures proving success, denied access and configured key handling.
- [ ] 3.2 `docs/launch/vendor-sources.md`, `README.md`, `site/index.html`: public source links,
      minimum permissions, unsupported cases and current coverage. Report item 3 to HQ.

## 4. Release and verify

- [ ] 4.1 Run `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm build:site` and
      `openspec validate site-slack-vendors --strict`. Review changes and fix confirmed findings.
- [ ] 4.2 Run gitleaks, commit by explicit path in small steps and push finished work to main.
- [ ] 4.3 `package.json`, `server.json`: 0.6.0 together. Check the weekly budget before each
      publishing step, publish npm, test a clean install and publish the MCP Registry entry.
- [ ] 4.4 Verify npm and registry 0.6.0, update Leviathan's live service, confirm watch_status
      answers and existing alerts remain configured. Record evidence in this file and report
      item 4 to HQ. Stop cleanly if the weekly budget reaches 70 percent.
