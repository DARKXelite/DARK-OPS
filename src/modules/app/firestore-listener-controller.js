/**
 * Firestore realtime subscription lifecycle. Subscriptions are view-scoped, role-gated,
 * epoch-protected against stale callbacks, and cleared when the session/view changes.
 */
export function createFirestoreListenerController(context) {
  const {
    VIEW_COLLECTIONS, getCurrentView, CONFIG, RBAC, permissionForCollection,
    setConn, S, LOADED, drawZones, updateBadges,
    onSnapshot, collection, db, normDate, scheduleRender, renderAll, toast
  } = context;
  const unsubs = new Map();
  let listenersStarted = false;
  const listenerEpochs = new Map();

  function collectionAffectsCurrentView(k) {
    return (VIEW_COLLECTIONS[getCurrentView()] || []).includes(k);
  }
  function stopOneListener(k) {
    listenerEpochs.set(k, (listenerEpochs.get(k) || 0) + 1);
    const unsubscribe = unsubs.get(k);
    if (unsubscribe) {
      try { unsubscribe(); } catch (_) {}
      unsubs.delete(k);
    }
  }
  function syncListenersForView() {
    if (!listenersStarted) return;
    setConn('');
    const desired = new Set(VIEW_COLLECTIONS[getCurrentView()] || []);
    Object.keys(CONFIG.COL).forEach(k => {
      const permitted = RBAC.can(permissionForCollection(CONFIG.COL[k], false));
      const shouldListen = desired.has(k) && permitted;
      if (!shouldListen) {
        if (unsubs.has(k)) stopOneListener(k);
        // Clear data not active on this screen, so a role/view transition never keeps
        // displaying a stale collection snapshot. Unauthorised collections never subscribe.
        S[k] = [];
        LOADED[k] = !permitted;
        if (k === 'zones') drawZones();
        if (k === 'logs' || k === 'live') updateBadges(k);
        return;
      }
      if (unsubs.has(k)) return;
  
      const epoch = (listenerEpochs.get(k) || 0) + 1;
      listenerEpochs.set(k, epoch);
      const cache = new Map();
      LOADED[k] = false;
      S[k] = [];
      const unsubscribe = onSnapshot(collection(db, CONFIG.COL[k]), snap => {
        if (listenerEpochs.get(k) !== epoch) return;
        const firstSnapshot = !LOADED[k];
        const changes = snap.docChanges();
        changes.forEach(change => {
          if (change.type === 'removed') cache.delete(change.doc.id);
          else {
            const row = { id: change.doc.id, ...change.doc.data() };
            if (k === 'fuel') row._d = normDate(row.issueDate ?? row.issuedDate ?? row.date ?? row.transactionDate ?? row.createdDate, row.issuedAt ?? row.issueTimestamp ?? row.timestamp ?? row.createdAt ?? row.createdOn ?? row.updatedAt ?? row.recordedAt);
            if (k === 'plans') row._d = normDate(row.date ?? row.issuedDate ?? row.applicationDate ?? row.appliedDate ?? row.issueDate ?? row.transactionDate ?? row.logDate ?? row.plannedDate, row.issuedAt ?? row.issueTimestamp ?? row.timestamp ?? row.appliedAt ?? row.completedAt ?? row.createdAt ?? row.createdOn ?? row.updatedAt ?? row.recordedAt ?? row.createdTime);
            if (k === 'shifts') row._d = normDate(row.shiftDate, row.timestamp ?? row.startTime ?? row.endTime);
            cache.set(change.doc.id, row);
          }
        });
        if (firstSnapshot || changes.length) S[k] = [...cache.values()];
        LOADED[k] = true;
        S._v++;
        setConn('ok');
        if (k === 'zones') drawZones();
        updateBadges(k);
        if (firstSnapshot || changes.length) {
          if (collectionAffectsCurrentView(k)) scheduleRender();
        }
      }, err => {
        if (listenerEpochs.get(k) !== epoch) return;
        console.error(k, err);
        LOADED[k] = true;
        setConn('err');
        toast(`Cannot read “${CONFIG.COL[k]}”: ${err.code || err.message}`, 'err');
        if (collectionAffectsCurrentView(k)) scheduleRender();
      });
      unsubs.set(k, unsubscribe);
    });
  }
  function startListeners() {
    stopListeners();
    setConn('');
    Object.keys(CONFIG.COL).forEach(k => { LOADED[k] = false; S[k] = []; });
    S._v++;
    listenersStarted = true;
    syncListenersForView();
    // Clear the previous session's rendered data immediately, before the new snapshots arrive.
    renderAll();
  }
  function stopListeners() {
    listenersStarted = false;
    [...unsubs.keys()].forEach(stopOneListener);
  }

  return {
    VIEW_COLLECTIONS, collectionAffectsCurrentView, stopOneListener,
    syncListenersForView, startListeners, stopListeners,
    isStarted: () => listenersStarted,
    getUnsubs: () => unsubs,
    getListenerEpochs: () => listenerEpochs
  };
}
