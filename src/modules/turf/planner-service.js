/**
 * Builds and commits planned turf-application records as one Firestore batch.
 * Validation and UI feedback remain in the caller; this service owns the write payload.
 */
export function createTurfPlannerService({ db, CONFIG, collection, doc, writeBatch, ymd, addDays, getInventory, now = () => Date.now() }) {
  async function saveWeeklyPlan({ start, weeks, days }) {
    const batch = writeBatch(db);
    const baseDate = new Date(start + "T00:00:00");
    let count = 0;
    for (let w = 0; w < weeks; w++) {
      const weekStartStr = ymd(new Date(baseDate.getTime() + w * 7 * 86400000));
      days.forEach((apps, dayIndex) => {
        const targetDateStr = addDays(weekStartStr, dayIndex);
        apps.forEach(app => {
          const product = getInventory().find(i => i.id === app.pId);
          const docRef = doc(collection(db, CONFIG.COL.plans));
          batch.set(docRef, {
            weekStart: weekStartStr,
            date: targetDateStr,
            dayIndex,
            productId: app.pId,
            productName: product ? product.partName : "Unknown",
            category: product ? product.category : "Fertilizers",
            targetQty: app.totQty,
            unit: app.unit,
            targetArea: app.area,
            scope: app.scope,
            notes: "Planned via Weekly Planner",
            status: "Planned",
            createdAt: now()
          });
          count++;
        });
      });
    }
    await batch.commit();
    return { count };
  }
  return { saveWeeklyPlan };
}
