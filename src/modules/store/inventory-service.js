/**
 * Atomically posts a goods receipt and updates inventory balance/cost.
 * The selected category is rechecked inside the transaction to detect stale UI state.
 */
export function createInventoryService({ db, CONFIG, doc, collection, runTransaction, serverTimestamp, num }) {
  async function postGoodsInward({
    itemId, expectedCategory, itemName, unit = "Nos", quantity, rate, gstPercent,
    taxableAmount, gstAmount, total, supplier, invoiceNumber, receiptDate, notes = ""
  }) {
    const receiptRef = doc(collection(db, CONFIG.COL.inwards));
    await runTransaction(db, async tx => {
      const itemRef = doc(db, CONFIG.COL.inventory, itemId);
      const snap = await tx.get(itemRef);
      if (!snap.exists()) throw new Error("Item no longer exists");
      const current = snap.data();
      if (current.category !== expectedCategory) throw new Error("Item category changed. Refresh and retry");
      const oldQty = Math.max(0, num(current.stockQuantity));
      const newQty = oldQty + quantity;
      tx.update(itemRef, { stockQuantity:newQty, unitCost:rate, lastInwardId:receiptRef.id, updatedAt:serverTimestamp() });
      tx.set(receiptRef, {
        itemId, itemName, category:expectedCategory, unit, quantity, rate, gstPercent,
        taxableAmount, gstAmount, total, supplier, invoiceNumber, receiptDate, notes,
        createdAt:serverTimestamp(), transactionType:"INWARD"
      });
    });
    return { receiptRef };
  }
  return { postGoodsInward };
}
