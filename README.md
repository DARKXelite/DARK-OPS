# DARK-OPS

Operations platform for Clover Greens Golf Resort.

## Current migration stage

The existing single-page dashboard is preserved in `reference/clover-greens-ops-production-redesign.html`. The application remains a single-page app, but shared concerns are being separated into imported modules so that operational logic can be tested without rewriting every screen at once.

## Project layout

- `index.html`: application shell.
- `src/main.js`: dashboard composition, view renderers, event routing, and live application orchestration.
- `src/firebase/client.js`: existing Firebase client initialization and collection/config constants.
- `src/utils/`: date/time, number, and display formatting helpers.
- `src/ui/dom.js`: DOM query, escaping, and incremental HTML update helpers.
- `src/domain/turf-records.js`: turf record category, status, date, quantity, and inventory matching normalization.
- `src/analytics/cost-analytics.js`: fuel costing, inventory valuation, and monthly cost snapshot calculations.
- `src/styles/app.css`: extracted dashboard styling.
- `reference/`: preserved source snapshot for comparison and rollback.
- `tests/`: smoke and unit tests.
- `.github/workflows/ci.yml`: automated tests and production build.

## Local development

Requires Node.js 22 or compatible.

```sh
npm install
npm run dev
npm test
npm run build
```

## Firebase and data safety

The dashboard retains its existing Firebase browser SDK imports pinned to version 10.7.1. Collection names and the current client configuration are preserved. Keep collection names, query/listener behavior, authentication assumptions, and Firebase access rules as compatibility constraints during the refactor.

Do not commit service-account credentials, private keys, or other server-side secrets. Keep this repository private while reviewing deployment settings.

## Development sequence

1. Keep the single-page user experience while separating concerns into modules.
2. Preserve a known-good HTML reference and behavior-preserving changes.
3. Extract Firebase reads/writes into explicit services in small, tested changes.
4. Add tests for fuel costing, stock valuation, planned-versus-issued turf usage, and auto-reorder suggestions.
5. Change the working `main` only after review and verification.

## Verification status

- JavaScript syntax check and Node.js smoke tests have passed in the initial modular bootstrap.
- The modular helper/service extraction now has automated unit coverage for date normalization, turf record normalization, and cost calculations.
- GitHub Actions runs `npm test` and `npm run build` for this branch.
- A real browser and live Firestore smoke test remains required before deployment.
