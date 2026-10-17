const VIEW_COLLECTIONS = {
  overview: ["fuel","machines","shifts","inventory","plans","maintenance","logs"],
  fleet: ["machines","live","fuel","shifts"],
  fuel: ["fuel","machines"],
  shifts: ["shifts","machines"],
  records: ["maintenance","assignments","fuel","machines","inventory"],
  radar: ["live","zones"],
  zones: ["zones"],
  registry: ["inventory","inwards"],
  users: ["users"],
  incidents: ["logs"],
  turfcare: ["inventory","plans"]
};

/**
 * Owns Firestore realtime subscriptions and keeps the shared client-side cache
 * synchronized. UI effects are injected so the lifecycle can be tested in isolation.
 */
export function createLiveDataListeners({
  db, CONFIG, state, loaded, normDate, collection, onSnapshot,
  getCurrentView, setConnection, onZonesUpdated, updateBadges,
  scheduleRender, onReadError
}) {
  let unsubs = [];

  function collectionAffectsCurrentView(key) {
    return (VIEW_COLLECTIONS[getCurrentView()] || []).includes(key);
  }

  function startListeners() {
    stopListeners();
    setConnection("");
    const caches = Object.fromEntries(Object.keys(CONFIG.COL).map(key => [key, new Map()]));
    Object.keys(CONFIG.COL).forEach(key => { loaded[key] = false; state[key] = []; });
    Object.keys(CONFIG.COL).forEach(key => {
      unsubs.push(onSnapshot(collection(db, CONFIG.COL[key]), snap => {
        const firstSnapshot = !loaded[key];
        const changes = snap.docChanges();
        changes.forEach(change => {
          if (change.type === "removed") caches[key].delete(change.doc.id);
          else {
            const row = { id: change.doc.id, ...change.doc.data() };
            if (key === "fuel") row._d = normDate(row.issueDate ?? row.issuedDate ?? row.date ?? row.transactionDate ?? row.createdDate, row.issuedAt ?? row.issueTimestamp ?? row.timestamp ?? row.createdAt ?? row.createdOn ?? row.updatedAt ?? row.recordedAt);
            if (key === "plans") row._d = normDate(row.date ?? row.issuedDate ?? row.applicationDate ?? row.appliedDate ?? row.issueDate ?? row.transactionDate ?? row.logDate ?? row.plannedDate, row.issuedAt ?? row.issueTimestamp ?? row.timestamp ?? row.appliedAt ?? row.completedAt ?? row.createdAt ?? row.createdOn ?? row.updatedAt ?? row.recordedAt ?? row.createdTime);
            if (key === "shifts") row._d = normDate(row.shiftDate, row.timestamp ?? row.startTime ?? row.endTime);
            caches[key].set(change.doc.id, row);
          }
        });
        if (firstSnapshot || changes.length) state[key] = [...caches[key].values()];
        loaded[key] = true;
        state._v++;
        setConnection("ok");
        if (key === "zones") onZonesUpdated();
        updateBadges(key);
        if (firstSnapshot || changes.length) {
          if (collectionAffectsCurrentView(key)) scheduleRender();
        }
      }, err => {
        console.error(key, err);
        loaded[key] = true;
        setConnection("err");
        onReadError(key, err);
        if (collectionAffectsCurrentView(key)) scheduleRender();
      }));
    });
  }

  function stopListeners() {
    unsubs.forEach(unsubscribe => unsubscribe());
    unsubs = [];
  }

  return { startListeners, stopListeners, collectionAffectsCurrentView };
}
