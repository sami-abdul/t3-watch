## 1. The product name

- [x] 1.1 `src/server/store.ts`, `src/server/app.ts`: a nullable `product` on services, added on open,
      kept by a rescan, and set or cleared with checks on its length and characters.
- [x] 1.2 `src/server/state.ts`, `src/web/logic.ts`: each check carries its service's product, and Home
      groups by a named product first.
- [x] 1.3 `src/server/mcp.ts`, `README.md`: `watch_set_product`, and the Watch thread's instructions
      and README saying when to use it.
- [x] 1.4 Tests in `src/server/store.test.ts`, `src/web/logic.test.ts` and `src/server/chat.test.ts`.

## 2. Verify

- [x] 2.1 Tests, typecheck, build and `openspec validate add-service-product --strict`.
- [x] 2.2 Review rounds at high effort, with each finding fixed or declined with a reason. Three
      rounds found 9, 9 and 8: 25 fixed and 1 declined in `.wattson/decisions.md`.
- [x] 2.3 On the live Watch: the database gains the column on restart, with signed alerts intact and
      21 of 22 checks passing, and Home's products are as they were. It answered 0.5 s after the
      restart onto the reviewed change, with 22 checks in the same 14 products and nothing named.
- [ ] 2.4 Release 0.5.0 to npm, `package.json` and `server.json`, and move the MCP Registry entry to it.
