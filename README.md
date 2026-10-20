# DARK-OPS

Operations platform for Clover Greens Golf Resort.

## Active application

- `index.html` loads `src/ops-app.js`, the current production single-page application.
- `src/modules/store/inventory-service.js` owns transactional inventory posting: opening balances, goods inward, stock issues and stock adjustments.
- `store_inwards` retains goods receipt documents; `store_movements` is the append-only operational movement ledger.
- `src/main.js` and the extracted modules are a parallel modularization path; do not assume they are the active browser entry until the shell is deliberately migrated.

## Inventory control rules

1. Item master edits must not directly alter on-hand quantity; use issue, receipt or adjustment workflows.
2. Goods receipts validate quantities and invoice arithmetic, reject duplicate supplier/invoice/item combinations, and update stock and movement records in a single Firestore transaction.
3. Issues and adjustments validate against the current transactional balance and block negative stock.
4. Opening balances and every new posted movement create a traceable movement row with before/after balances, unit, reference, reason and timestamp.
5. Weighted-average unit cost is recalculated on receipt when the existing carrying cost is known. Legacy stock with unknown cost remains flagged for review rather than receiving an invented value.
6. A production rollout still requires Firestore security rules, role-based authorization, a live browser/Firestore smoke test and reconciliation of legacy records.

## Local development

Requires Node.js 22 or compatible.

```sh
npm install
npm run dev
npm test
npm run build
```

## Current limitations and next phase

The stock movement ledger applies to transactions posted through the new inventory workflows. Existing fuel and turf records have not yet been backfilled into the ledger, so they must not be treated as a reconciled perpetual stock ledger until migration and duplicate-consumption rules are approved. Next phases should add supplier master records, purchase requisitions/orders, receiving/inspection, returns, lot/expiry tracking for chemicals, multi-store transfers, cycle counts, approval roles, and server-enforced Firestore rules.

## Physical closing stock and decision intelligence

- The Store tab records a physical closing quantity for a selected item and date. It stores the expected book balance, physical count, signed variance, cost exposure, count owner, notes, ledger coverage and review status in `stock_counts`.
- Count capture is audit-only and never silently changes on-hand stock. Variances appear in the main Operational Intelligence panel and the Advanced Analytics view.
- For historical dates, the expected closing balance is reconstructed from current on-hand quantity and later-dated movement records. Treat this as an estimate until legacy movement history has been reconciled. A date is interpreted as end-of-day; same-day later transactions are not distinguishable from the date-only record.
- Advanced Analytics includes ABC inventory value classification, XYZ demand variability, moving-average/trend forecast, estimated economic order quantity (EOQ), service-factor safety stock, reorder points, days-of-cover/stockout risk, robust MAD issue-volume anomaly detection, physical-count variance exposure, fleet fuel-per-engine-hour comparison, and data-quality alerts.
- Decision models are deterministic and explainable. Lead time, order cost, holding rate and service factor are assumptions. Recommendations are not purchase orders and must be checked against real supplier terms and operating plans.
- Usage forecasts and ABC/XYZ classifications use recorded `ISSUE` movements. Existing fuel and turf logs have not been automatically deducted from inventory or backfilled into the movement ledger. Until a reviewed migration is completed, consumption-driven calculations are partial and explicitly labeled.
