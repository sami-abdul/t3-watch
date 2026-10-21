## Why

Home lists every passing check in one flat list. With twenty checks across a dozen products, a
product's site check and its repository's CI sit far apart, and nothing says which product a check
belongs to. After a rescan, new suggested checks wait in the review, but once a
scan has been applied Home never mentions them, so a scan an agent ran finds checks nobody sees.

## What Changes

- **Products on Home.** Checks are grouped by product: a site check and a repository's CI join
  under the site's own name when their names match once case and punctuation are dropped, such
  as `custom:shop` and `github:acme/shop`, and no other site or repository has that name. A
  repository that joins no site keeps its owner in its name, and vendors and AWS accounts are
  groups of their own. Each group shows how many of its checks pass and its worst state, and the
  groups with a problem come first. Broken and Could not run stay at the top as they are.
- **New checks to review.** When the latest scan holds suggestions nobody has decided on, Home
  says how many and opens the review, which marks them New and has Back to Home. Since the review
  can now open long after its scan, its ticks follow the checks as they stand: one turned on or
  paused since keeps that choice, and only an undecided one takes the scan's suggestion.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `watch-page`: Home grouped by product, and the new-checks notice.

## Impact

`src/web/logic.ts`, `src/web/logic.test.ts`, `src/web/Home.tsx`, `src/web/App.tsx` and
`src/web/Setup.tsx`. The state already carries each suggestion's current state, so nothing changes
on the server.
