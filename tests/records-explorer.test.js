import test from "node:test";
import assert from "node:assert/strict";
import { buildOperationalRecordFeed, filterOperationalRecordFeed, summarizeTurfLifecycle } from "../src/modules/records/record-explorer.js";

const state = {
  plans: [
    { id: "p1", date: "2026-10-20", productName: "Greens fertilizer", status: "Planned", targetArea: "Greens" },
    { id: "p2", date: "2026-10-18", productName: "Pesticide", status: "Applied", appliedQty: 4, issueMovementId: "m2" }
  ],
  movements: [{ id: "m1", createdAt: "2026-10-19", itemName: "Diesel", movementType: "ISSUE", quantityDelta: -12 }]
};
const dateFor = (source, row) => source === "plans" ? row.date : String(row.createdAt || "").slice(0, 10);

test("activity feed preserves source records and normalizes dates", () => {
  const feed = buildOperationalRecordFeed(state, ["plans", "movements"], dateFor);
  assert.equal(feed.length, 3);
  assert.equal(feed.find(r => r.id === "m1").source, "movements");
  assert.equal(feed.find(r => r.id === "p1").record.productName, "Greens fertilizer");
});

test("activity feed filters by source, free-text query and inclusive date bounds", () => {
  const feed = buildOperationalRecordFeed(state, ["plans", "movements"], dateFor);
  assert.deepEqual(filterOperationalRecordFeed(feed, { source: "plans" }).map(r => r.id), ["p1", "p2"]);
  assert.deepEqual(filterOperationalRecordFeed(feed, { query: "diesel" }).map(r => r.id), ["m1"]);
  assert.deepEqual(filterOperationalRecordFeed(feed, { from: "2026-10-19", to: "2026-10-20" }).map(r => r.id), ["p1", "m1"]);
});

test("date filters exclude records with unknown dates instead of silently admitting them", () => {
  const rows = [{ id: "missing", source: "logs", date: "", record: { issueDescription: "Unknown date" } }];
  assert.equal(filterOperationalRecordFeed(rows, { from: "2026-10-01" }).length, 0);
});

test("turf lifecycle separates planned, issued, applied, cancelled and missing evidence", () => {
  const plans = [
    { date: "2026-10-18", status: "Planned" },
    { date: "2026-10-19", status: "Issued" },
    { date: "2026-10-20", status: "Applied", appliedQty: 3, issueMovementId: "move-1" },
    { date: "2026-10-17", status: "Applied" },
    { date: "2026-10-17", status: "Cancelled" }
  ];
  assert.deepEqual(summarizeTurfLifecycle(plans, "2026-10-20"), {
    planned: 1, issued: 1, applied: 2, cancelled: 1, overdue: 1,
    issuedWithoutMovementLink: 2, appliedWithoutRecordedQuantity: 1, total: 5, tracked: 3
  });
});
