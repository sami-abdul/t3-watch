## 1. Headers

- [x] 1.1 `site/_headers`: allow the Cloudflare Web Analytics beacon script and its reporting
      origin in the CSP, changing nothing else.
- [x] 1.2 `docs/launch/site.md`: say the site counts page loads with Cloudflare Web Analytics.

## 2. Verify and deploy

- [x] 2.1 Run `openspec validate site-web-analytics --strict` and `pnpm build:site`.
- [ ] 2.2 Check the latest Codex weekly usage, then run
      `wrangler pages deploy site/dist --project-name t3-watch --branch main` with the appin60
      credential in the environment.
- [ ] 2.3 Fetch https://t3-watch.lfglabs.ai/ with `Accept: text/html` and confirm the new CSP and
      the injected beacon. Load the page in headless Chrome and confirm a 2xx `/cdn-cgi/rum`
      response with no CSP violation.
