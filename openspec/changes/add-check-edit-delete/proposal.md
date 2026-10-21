## Why

Details lets a person pause, resume, turn on and run a check, but not change one or get rid of
it. A check whose address moved, or one that runs too often, can only be fixed by an agent
drafting a replacement, and a check nobody wants stays listed and comes back in every rescan.
Someone who did not write every check needs to fix and remove checks themselves, without losing
what each check recorded.

## What Changes

- **Edit in Details.** A check that is on or paused has Edit: its name, how often it runs in
  minutes, and its settings as JSON, the fields an agent drafts it with. Watch checks the settings
  against the check's kind and refuses a field the kind does not have, another repository for a
  repository's own check, and any change to a vendor check's settings. A heartbeat's ping address
  is never shown there and never changes. The check keeps its id, so its runs and changes stay
  with it; one that is on runs again within a tick, and a rescan keeps the person's settings. A
  form opened before the check last changed is refused rather than saved over the change.
- **Delete in Details, keeping history.** Delete asks once, then marks the check deleted: it
  stops running, leaves Home and the review, and no rescan suggests it again, but its runs and
  changes stay. Details lists deleted checks with their history and Restore, which brings one
  back paused.
- **On the page only.** Edit, Delete and Restore answer only a signed-in browser on the Watch
  page, not the token agents hold, so an agent changes a check by drafting one for the person.
  The chat view shows neither. Drafts keep Discard on Home.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `watch-page`: Edit, Delete and Restore in Details.
- `watch-service`: a deleted state that keeps history, edits checked against the kind, and
  routes only the page can use.
- `setup-scan`: a rescan skips deleted checks and keeps edited ones as the person left them.

## Impact

New `src/server/edits.ts` and `src/server/edits.test.ts`. Changed: `src/server/store.ts`,
`src/server/app.ts`, `src/server/extend.ts`, `src/server/http.ts`, `src/server/http.test.ts`,
`src/server/scan.ts`, `src/server/scan.test.ts`, `src/server/state.ts`, `src/server/drafts.ts`,
`src/server/mcp.ts`, `src/server/notices.ts`, `src/server/alerts.ts`, `src/web/client.ts`, `src/web/app-entry.tsx`,
`src/web/App.tsx`, `src/web/Details.tsx`, `src/web/logic.ts`, `src/web/logic.test.ts` and
`README.md`. No migration: deleted is a new value of the existing state column.
