# DARK-OPS

Operations platform for Clover Greens Golf Resort.

## Current migration stage

The existing single-page dashboard has been preserved in `reference/clover-greens-ops-production-redesign.html`. The first refactor is intentionally mechanical: shared styling and the existing module script have been extracted into separate files, without intentionally changing business logic or Firestore operations.

## Project layout

- `index.html`: application shell.
- `src/styles/app.css`: extracted dashboard styling.
- `src/main.js`: existing dashboard logic, now loaded as a module file.
- `reference/`: preserved source snapshot for comparisons and rollback.
- `tests/smoke.test.js`: source-loading and Firebase import smoke tests.
- `.github/workflows/ci.yml`: test and production-build checks.

## Local development

Requires Node.js 22 or compatible.

```sh
npm install
npm run dev
npm test
npm run build
```

## Firebase and data safety

The dashboard continues to use the existing Firebase browser SDK imports pinned to version 10.7.1. Treat collection names, query/listener behavior, authentication assumptions, and current Firebase configuration as compatibility constraints. Do not replace the Firebase project or rename collections as part of a UI refactor.

Do not commit service-account credentials, private keys, or other server-side secrets. Keep this repository private while reviewing the browser configuration and deployment rules.

## Development sequence

1. Preserve a baseline and make behavior-preserving structural changes.
2. Keep the SPA build and CI passing.
3. Extract Firebase/data access into tested services in small steps.
4. Add tests for cost calculations, fuel inventory, planned-versus-issued turf usage, and reorder suggestions.
5. Change the working `main` only after review and verification.

## Verification status

- JavaScript syntax checks passed locally.
- Node.js smoke tests passed locally: 3/3.
- GitHub Actions completed successfully for this branch, including dependency installation, smoke tests, and the production Vite build.
- A real browser and live Firestore smoke test has not yet been performed. Do not deploy based solely on a successful bundle build.
