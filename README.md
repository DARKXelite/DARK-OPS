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

## Operational records, saved views and turf execution

- The Operations record explorer consolidates maintenance, assignments, fuel issues, turf plans/applications, store movements/issues, goods receipts, closing counts, incidents, run logs and local expenses without copying or mutating their source documents.
- Use global search, date bounds, source tabs, paging and the View drawer to inspect raw saved fields. CSV exports provide a portable report; JSON exports preserve source records for audit or troubleshooting.
- Named record views store only the filter definition in the current browser's local storage. They are not shared across devices or users and do not save operational transactions.
- Turf plans can be opened from the application register. For linked, planned tasks, “Record stock issue” atomically posts the inventory decrement, creates a store_movements issue row with the turf plan ID, and changes the plan to Issued. Issue quantity is capped at the saved plan quantity and current stock is checked inside the Firestore transaction.
- Completing a linked issue requires reconciliation of the full issued quantity into applied, returned-to-store and unaccounted quantities. Returned material is added back to inventory with a linked TURF_RETURN movement; any unaccounted quantity requires a written explanation. No return or stock adjustment is inferred automatically.
- Planned tasks may be cancelled with a named actor and reason. Cancelled records are retained for history. Older/legacy Issued records without a linked stock movement are flagged for review rather than falsely treated as reconciled.
- Advanced Analytics adds turf lifecycle counts and data-completeness signals for missing turf product/area/quantity links, missing fuel rates/machine links, incomplete maintenance attribution, unreferenced movements, open incidents and unresolved count variances. These are review prompts, not proof of loss or physical work completion.
- The main dashboard cards and existing general issue / receipt / count business rules are unchanged. A production rollout still needs live Firebase/browser acceptance tests and deployed Firestore rules that permit the new plan-and-inventory transaction writes for the intended staff roles.

## Physical closing stock and decision intelligence

- The Store tab records a physical closing quantity for a selected item and date. It stores the expected book balance, physical count, signed variance, cost exposure, count owner, notes, ledger coverage and review status in `stock_counts`.
- Count capture is audit-only and never silently changes on-hand stock. Variances appear in the main Operational Intelligence panel and the Advanced Analytics view. A reviewer can resolve an investigated variance with required notes; this clears the active alert but preserves the count history and does not change stock.
- For historical dates, the expected closing balance is reconstructed from current on-hand quantity and later-dated movement records. Treat this as an estimate until legacy movement history has been reconciled. A date is interpreted as end-of-day; same-day later transactions are not distinguishable from the date-only record.
- Advanced Analytics includes ABC inventory value classification, XYZ demand variability, moving-average/trend forecast, estimated economic order quantity (EOQ), service-factor safety stock, reorder points, days-of-cover/stockout risk, robust MAD issue-volume anomaly detection, physical-count variance exposure, fleet fuel-per-engine-hour comparison, and data-quality alerts.
- Decision models are deterministic and explainable. Lead time, order cost, holding rate and service factor are assumptions. Recommendations are not purchase orders and must be checked against real supplier terms and operating plans.
- Usage forecasts and ABC/XYZ classifications use recorded `ISSUE` movements. Existing fuel and turf logs have not been automatically deducted from inventory or backfilled into the movement ledger. Until a reviewed migration is completed, consumption-driven calculations are partial and explicitly labeled.
