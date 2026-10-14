# Plan: CI workflow (and light ESLint)

- **Severity:** P2
- **Effort:** S

## Finding

- There is no `.github/` directory, so nothing runs typecheck, build or tests on push or PR. Merges rely on whoever remembers to run `npm test`.
- Measured on main: `npm ci`, `npm run typecheck`, `npm run build` and `npm test` all pass (9 files, 153 tests, about 6 s). Re-measured 2026-10-14 on 5b98fb1: same, 153/153. The suite is fully mocked and needs no network, so it is CI-safe.
- No linter is configured.

## Proposed fix

1. **`.github/workflows/ci.yml`:**
   ```
   on: push (branches: main), pull_request
   jobs.ci: ubuntu-latest, actions/checkout@v4, actions/setup-node@v4 {node-version: 22, cache: npm}
     npm ci → npm run typecheck → npm run build → npm test → npm audit --omit=dev --audit-level=high
   permissions: contents: read
   concurrency: cancel in-progress per ref
   ```
   Node 22 matches the `Dockerfile` (`node:22-alpine`). `engines` says `>=20.10`, so optionally add a matrix entry for 20.
2. **ESLint, if light:** `eslint` + `typescript-eslint` flat config (`eslint.config.js`), `recommended` rules only, `npm run lint`, and add it to CI. Fix only what fails, as its own commit. If the first run reports more than about 20 findings, ship CI without lint and open a follow-up.
   (Re-audit) `npm audit --omit=dev` is in skill §4 D4 and was missing here. Measured 2026-10-14: 0 vulnerabilities, so it is green today.
3. Once the registry plan lands, add `node scripts/check-versions.mjs` to CI.

## Tests to add

- None as unit tests. The workflow is the test. Verify it on the PR itself: the CI run must go green on the branch.

## Risks, rollout, decisions

- Pin action major versions (v4). Do not use unpinned third-party actions.
- **Founder:** make the CI check required on `main` in branch protection (repo settings, manual).
