## 1. Build

- [ ] 1.1 `vite.config.ts`, `index.html`, Tailwind v4, Fluid Functionalism items under
      `src/web/fluid/`, `MotionConfig` at the root.
- [ ] 1.2 `src/web/client.ts`: a `WatchClient` interface with an HTTP implementation.

## 2. Views

- [ ] 2.1 `src/web/logic.ts` with tests: headline, grouping, default ticks, apply payload.
- [ ] 2.2 `src/web/Setup.tsx`: empty, scanning, review, Add key.
- [ ] 2.3 `src/web/Home.tsx` and `src/web/Details.tsx`.
- [ ] 2.4 `src/web/App.tsx`: sign-in state, view switch.

## 3. Server

- [ ] 3.1 Serve `dist/web` from `src/server/http.ts`; the sign-in link sets the session cookie.

## 4. Verification

- [ ] 4.1 `pnpm vitest run src/web`; `pnpm tsc --noEmit`; `pnpm build`.
- [ ] 4.2 `openspec validate add-watch-page --strict`.
