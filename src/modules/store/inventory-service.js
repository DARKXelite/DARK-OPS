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


/**
 * Atomically records a diesel/petrol issue and deducts the selected fuel SKU.
 * The stock check runs inside the transaction so concurrent issues cannot overspend stock.
 */
export async function postFuelIssue({ db, CONFIG, doc, collection, runTransaction, serverTimestamp, num }, {
  itemId, machineId, machineName, fuelType, litres, issueDate, issuedBy = "", notes = ""
}) {
  const quantity = Number(litres);
  if (!itemId) throw new Error("Select a fuel inventory item");
  if (!["Diesel", "Petrol"].includes(fuelType)) throw new Error("Fuel type must be Diesel or Petrol");
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Litres must be greater than zero");
  if (!issueDate || !/^\\d{4}-\\d{2}-\\d{2}$/.test(issueDate)) throw new Error("Select a valid issue date");

  const logRef = doc(collection(db, CONFIG.COL.fuel));
  await runTransaction(db, async tx => {
    const itemRef = doc(db, CONFIG.COL.inventory, itemId);
    const snap = await tx.get(itemRef);
    if (!snap.exists()) throw new Error("Fuel inventory item no longer exists");
    const item = snap.data();
    if (String(item.category || "").trim().toLowerCase() !== "fuel") {
      throw new Error("Selected inventory item is not in the Fuel category");
    }
    const itemName = String(item.partName ?? item.itemName ?? item.name ?? "").trim().toLowerCase();
    if (itemName !== fuelType.toLowerCase()) {
      throw new Error("Selected inventory item does not match the fuel type");
    }
    const unit = String(item.unit ?? item.uom ?? item.stockUnit ?? "").trim().toLowerCase();
    if (!["litre", "litres", "liter", "liters", "l"].includes(unit)) {
      throw new Error("Fuel inventory unit must be Litre");
    }
    const oldStock = Number(num(item.stockQuantity));
    if (!Number.isFinite(oldStock) || oldStock < 0) throw new Error("Fuel stock quantity is invalid");
    if (quantity > oldStock) throw new Error(`Insufficient ${fuelType} stock. Available: ${oldStock} L`);

    const timestamp = serverTimestamp();
    tx.update(itemRef, {
      stockQuantity: Number((oldStock - quantity).toFixed(3)),
      lastFuelIssueId: logRef.id,
      updatedAt: timestamp
    });
    tx.set(logRef, {
      inventoryItemId: itemId,
      machineId: machineId || "",
      machineName: machineName || "",
      fuelType,
      litres: quantity,
      issueDate,
      issuedBy: String(issuedBy || "").trim(),
      notes: String(notes || "").trim(),
      timestamp,
      createdAt: timestamp,
      transactionType: "FUEL_ISSUE"
    });
  });
  return { logRef };
}
