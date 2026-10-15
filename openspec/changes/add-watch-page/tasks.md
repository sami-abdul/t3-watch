## 1. Build

- [x] 1.1 `vite.config.ts`, `index.html`, Tailwind v4, Fluid Functionalism items under
      `src/web/fluid/`, `MotionConfig` at the root.
- [x] 1.2 `src/web/client.ts`: a `WatchClient` interface with an HTTP implementation.

## 2. Views

- [x] 2.1 `src/web/logic.ts` with tests: headline, grouping, default ticks, apply payload.
- [x] 2.2 `src/web/Setup.tsx`: empty, scanning, review, Add key.
- [x] 2.3 `src/web/Home.tsx` and `src/web/Details.tsx`.
- [x] 2.4 `src/web/App.tsx`: sign-in state, view switch.

## 3. Server

- [x] 3.1 Serve `dist/web` from `src/server/http.ts`; the sign-in link sets the session cookie.

## 4. Verification

- [x] 4.1 `pnpm vitest run src/web`; `pnpm typecheck`; `pnpm build:web`.
- [x] 4.2 `openspec validate add-watch-page --strict`.
