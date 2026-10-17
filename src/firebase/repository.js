/**
 * Small, injectable boundary for ordinary Firestore CRUD operations.
 * Complex workflows (transactions and batch writes) remain explicit at call sites.
 */
export function createFirestoreRepository({ db, CONFIG, collection, doc, addDoc, updateDoc, deleteDoc, increment }) {
  const collectionName = key => CONFIG.COL[key] || key;
  return {
    add(key, data) { return addDoc(collection(db, collectionName(key)), data); },
    update(key, id, patch) { return updateDoc(doc(db, collectionName(key), id), patch); },
    remove(key, id) { return deleteDoc(doc(db, collectionName(key), id)); },
    increment(key, id, field, amount) { return updateDoc(doc(db, collectionName(key), id), { [field]: increment(amount) }); }
  };
}
