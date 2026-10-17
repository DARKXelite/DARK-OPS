# DARK-OPS

Operations platform for Clover Greens Golf Resort.

## Current migration stage

The existing single-page dashboard is preserved in `reference/clover-greens-ops-production-redesign.html`. The application remains a single-page app, while feature screens, shared utilities, and data services are extracted into testable modules incrementally.

## Project layout

- `index.html`: application shell.
- `src/main.js`: application composition, shared state, screen wiring, and event handlers.
- `src/firebase/client.js`: existing Firebase client initialization and collection/config constants.
- `src/firebase/live-listeners.js`: Firestore subscription lifecycle, incremental cache updates, and current-view render gating.
- `src/firebase/repository.js`: standard CRUD adapter for ordinary Firestore writes.
- `src/utils/`: date/time, number, and display formatting helpers.
- `src/ui/dom.js`: DOM query, escaping, and incremental HTML update helpers.
- `src/ui/navigation.js`: SPA navigation groups, route switching, and render orchestration.
- `src/domain/turf-records.js`: turf record category, status, date, quantity, and inventory matching normalization.
- `src/analytics/cost-analytics.js`: fuel costing, inventory valuation, and monthly cost snapshots.
- `src/modules/fleet/fleet-module.js`: Fleet Ops listing, filtering/sorting, machine cards, and machine create/edit form.
- `src/modules/turf/turf-ops-module.js`: Turf Ops overview, weekly calendar, stock views, and application records.
- `src/modules/turf/planner-service.js`: atomic batch persistence for weekly planned turf tasks.
- `src/modules/store/inventory-service.js`: goods-inward transaction updating item stock/cost and receipt ledger together.
- `src/styles/app.css`: extracted dashboard styling.
- `reference/`: preserved source snapshot for comparison and rollback.
- `tests/`: smoke tests and unit tests for data helpers, services, Fleet Ops, Turf Ops, and navigation.
- `.github/workflows/ci.yml`: automated test and production-build checks.

## Local development

Requires Node.js 22 or compatible.

```sh
npm install
npm run dev
npm test
npm run build
```

## Firebase and data safety

The dashboard keeps its existing Firebase browser SDK imports pinned to version 10.7.1. Existing client configuration values and Firestore collection names are preserved. Treat collection names, query/listener behavior, authentication assumptions, and Firebase access rules as compatibility constraints.

Ordinary add/update/delete/increment operations go through the repository adapter. The weekly turf planner writes as a batch, and goods inward updates the stock master plus receipt ledger in one transaction. These are deliberately explicit, tested use cases rather than generic writes.

Do not commit service-account credentials, private keys, or other server-side secrets. Keep this repository private while reviewing deployment settings.

## Development sequence

1. Keep the single-page user experience while separating features into modules.
2. Preserve a known-good HTML reference and prefer behavior-preserving changes.
3. Extract remaining write workflows and master screens into explicit services.
4. Expand tests for stock changes, fuel costs, planned-versus-issued turf usage, and reorder suggestions.
5. Complete a live browser/Firestore smoke test before deployment.
6. Merge to `main` only after review and verification.

## Verification status

- Previous modular extraction, Fleet Ops, Turf Ops, navigation, repository, and listener changes have passed GitHub Actions tests and Vite production builds.
- New planner batch and goods-inward service changes have their own mock-based tests; CI is running for the latest branch head.
- A real browser and live Firestore smoke test remains required before deployment.
