## Why

The page is where a person knows and decides: what is broken, what waits on them, and the
buttons to turn checks on, pause them and add keys. Keys are pasted here, never in chat.

## What Changes

- The service serves one web app at `/`, signed in with the link `t3-watch url` prints.
- **Setup:** an empty install shows one button, Set up Watch. While the scan runs the page says
  what it is reading, with no spinner. The review lists access, then checks with their first
  result, each ticked by default when it worked, and one Watch these N button. Services found
  without access offer Add key: one field, a link to the vendor's key page, tested on save.
- **Home:** "N things are broken" or "All clear", one row per failing check with its summary,
  the agent's latest note on it, and Pause, Run now and Ask in chat; checks that could not run;
  drafts the agent proposed, with Turn on and Discard; passing checks folded into one line;
  Add services to scan again.
- **Details:** every check with cadence, state and recent runs, with Turn on, Pause, Snooze and
  Run now; keys with Remove; settings for scan roots and alerts.
- Built with Fluid Functionalism (Base UI flavor) and its motion tokens, wrapped in
  `MotionConfig reducedMotion="user"`. The same components build the inline chat view in
  `add-watch-chat`.

## Capabilities

### New Capabilities

- `watch-page`: setup, Home and Details in the browser.

## Impact

New `src/web/**`, `vite.config.ts`, `index.html`; the server serves `dist/web`.
