## 1. Home

- [x] 1.1 `src/web/logic.ts`, `src/web/logic.test.ts`: the product of each check, groups with
      their counts and worst state, and the number of new checks to review.
- [x] 1.2 `src/web/Home.tsx`, `src/web/App.tsx`, `src/web/Setup.tsx`: products in place of the
      flat passing list, the notice that opens the review, Back to Home there, and review ticks
      that follow the checks as they stand.

## 2. Verify

- [x] 2.1 Tests, typecheck, build and `openspec validate add-home-groups --strict`.
- [x] 2.2 Review rounds at high effort, with each finding fixed or declined with a reason: three
      rounds found 9, 10 and 8; 24 fixed, 3 declined in `.wattson/decisions.md`.
- [ ] 2.3 In a browser: the products on a scratch Watch and the new-checks notice after a rescan;
      the live Watch restarts briefly with its alert settings intact and 22 of 22 checks passing.
