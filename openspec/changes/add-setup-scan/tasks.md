## 1. Scan

- [x] 1.1 `src/server/scan.ts`: repositories under roots, manifests, `.env` names and keys, git
      remotes, `gh` login, AWS profiles grouped by account, catalog matching.
- [x] 1.2 Store services, propose checks with stable ids, trial-run each, save the scan.
- [x] 1.3 Apply: turn on ticked checks, remove unticked keys, remember declined checks and keys.

## 2. API

- [x] 2.1 `POST /api/scan`, `POST /api/apply`, `POST /api/keys` (add a key for a vendor, test it,
      keep it only if it works) in `src/server/http.ts`.

## 3. Verification

- [x] 3.1 `src/server/scan.test.ts` with fixture repositories and fake `gh`, `aws` and HTTP:
      finds services, never returns a value, stores one key per value, proposes and trial-runs
      checks, rescan adds nothing, apply turns on and removes. `pnpm vitest run src/server/scan`.
- [x] 3.2 `pnpm tsc --noEmit`; `openspec validate add-setup-scan --strict`.
- [x] 3.3 A real scan on this machine, reporting what it found.
