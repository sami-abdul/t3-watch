## 1. MCP

- [x] 1.1 `src/server/mcp.ts`: server, instructions, the ten tools, the app resource.
- [x] 1.2 Mount `/mcp` in `src/server/http.ts` behind the token; `src/server/mcp-relay.ts` for
      `t3-watch mcp`.

## 2. Drafts, notes, alerts

- [x] 2.1 Draft checks and vendors in `src/server/drafts.ts`: validate, trial-run, store, approve,
      discard; API routes for the page.
- [x] 2.2 `src/server/alerts.ts`: deliver pending change events with HMAC, retry on failure.

## 3. Inline view

- [x] 3.1 `src/web/app-entry.tsx` and `app.html`: the Home view over an MCP Apps client; single-file
      build into `dist/app/index.html`.

## 4. Docs

- [x] 4.1 README: install, the Watch thread, alerts through a T3 webhook task, adding vendors.

## 5. Verification

- [x] 5.1 Tests: tool list and annotations, a tool call round trip over HTTP, draft validation,
      alert delivery and retry, signature. `pnpm vitest run`.
- [x] 5.2 `pnpm tsc --noEmit`; `pnpm build`; `openspec validate add-watch-chat --strict`.
