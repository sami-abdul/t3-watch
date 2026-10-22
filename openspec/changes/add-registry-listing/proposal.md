## Why

On 22 October Sami approved the launch drafts: Watch goes into the official MCP Registry as
`ai.lfglabs/t3-watch`, proven through a DNS record on lfglabs.ai, under the lead line "An agent on
call for the things nobody watches. Checks run free; your agent wakes only when something
changes.", and it stays free and open source. The registry accepts an npm package only when the
published `package.json` names the entry in `mcpName`, and 0.3.0 does not, so the listing needs a
release. The registry keeps the text each version shipped with, and so does npm, so the lead line
has to be in place before that release.

## What Changes

- **Named for the registry.** `package.json` moves to 0.4.0 with `mcpName` set to
  `ai.lfglabs/t3-watch`, and its description becomes the plainer line: "Monitoring that sets
  itself up from the projects on your machine, and wakes your coding agent only when something
  changes." The draft said "breaks", but a recovery and a check that can't run wake the agent
  too.
- **The entry, in the repository.** `server.json` at the root is what `mcp-publisher publish`
  sends: the name, the lead line as the description, cut to the registry's 100 characters as
  "An agent on call for the things nobody watches. Checks run free; your agent wakes only on a
  change.", version 0.4.0, the repository, and the npm package run as `npx @lfg-labs/t3-watch mcp`
  over stdio. A test keeps it in step with `package.json` and the README, so a release cannot
  name an entry its package does not carry.
- **The lead line.** The README opens with it and says Watch is free and open source under MIT.
  `docs/launch/mcp-registry.md` turns from a draft into how the listing is published and
  updated.
- **One version.** The inline view reported a fixed 0.3.0 to the MCP host. It is now built with a
  mark where its version goes, and the server writes its own version over the mark as it serves
  the view, so the two agree even in a checkout whose view was built before a version change.
- **Shipped.** 0.4.0 goes to npm with the slow-link hold and the billing block, and the entry goes
  to the registry.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `watch-service`: the package names its registry entry, and the inline view reports the
  package's version.

## Impact

`package.json`, `server.json`, `README.md`, `docs/launch/mcp-registry.md`, `.gitignore`,
`src/web/app-entry.tsx`, `src/server/mcp.ts`, the new `src/server/version.ts` and
`src/server/version-mark.ts`, and tests in `src/server/release.test.ts` and
`src/server/chat.test.ts`. No change to what Watch does at run time beyond the version the inline
view reports. No new package and no migration.
