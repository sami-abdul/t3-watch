## 1. The listing

- [x] 1.1 `package.json`, `server.json`, `src/server/release.test.ts`: 0.4.0 with `mcpName`, the
      registry entry, and a test that they and the README agree.
- [x] 1.2 `README.md`, `docs/launch/mcp-registry.md`, `.gitignore`: the lead line, free and open
      source under MIT, how the listing is published and updated, and no key file in the repository.
- [x] 1.3 `src/server/version.ts`, `src/server/version-mark.ts`, `src/server/mcp.ts`,
      `src/web/app-entry.tsx`, `src/server/chat.test.ts`: the server writes its own version into the
      inline view as it serves it.

## 2. Verify

- [x] 2.1 Tests, typecheck, build and `openspec validate add-registry-listing --strict`.
- [x] 2.2 Review rounds at high effort, with each finding fixed or declined with a reason. Three
      rounds found 8, 8 and 7: 22 fixed and 1 declined.
- [x] 2.3 Release 0.4.0 to npm and check it from the registry; the live Watch restarts briefly on it
      with its alert settings intact. Published on 22 October with `mcpName` `ai.lfglabs/t3-watch`;
      installed from npm into an empty folder, its demo ran and stopped cleanly. The live Watch
      answered again 0.5 s after its restart, with signed alerts intact, 21 of 22 checks passing
      and the billing-blocked repository under Could not run.
- [x] 2.4 `mcp-publisher validate` and `publish`, and the entry shows in the registry's search.
      Signed in with the DNS proof on lfglabs.ai, published `ai.lfglabs/t3-watch` 0.4.0 at 07:22
      UTC, and both `search=ai.lfglabs/t3-watch` and `search=t3-watch` return it, active and latest.
