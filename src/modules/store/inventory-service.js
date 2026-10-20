/**
 * Inventory posting boundary.
 *
 * All stock-changing workflows update the item balance and append an immutable
 * movement record in the same Firestore transaction. Never change on-hand stock
 * with a plain CRUD update once an item has been created.
 */
export function createInventoryService({ db, CONFIG, doc, collection, runTransaction, serverTimestamp, num }) {
  const number = value => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  };
  const requiredText = (value, label) => {
    const text = String(value ?? "").trim();
    if (!text) throw new Error(label + " is required");
    return text;
  };
  const stableId = (prefix, value) => {
    // Two independent 32-bit rolling hashes make deterministic Firestore-safe IDs
    // without storing supplier invoice text in the document path.
    const text = String(value).trim().toLowerCase();
    let a = 0x811c9dc5, b = 0x9e3779b9;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      a = Math.imul(a ^ c, 0x01000193) >>> 0;
      b = Math.imul(b ^ (c + i), 0x85ebca6b) >>> 0;
    }
    return prefix + "_" + a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
  };
  const movementRef = () => doc(collection(db, CONFIG.COL.movements));
  const itemRefFor = id => doc(db, CONFIG.COL.inventory, id);
  const qtyOf = item => Math.max(0, num(item.stockQuantity));

  async function createItemWithOpeningBalance(itemData) {
    const name = requiredText(itemData.partName ?? itemData.itemName, "Item name");
    const quantity = number(itemData.stockQuantity ?? 0);
    const rate = number(itemData.unitCost ?? 0);
    if (!Number.isFinite(quantity) || quantity < 0) throw new Error("Opening stock must be zero or greater");
    if (!Number.isFinite(rate) || rate < 0) throw new Error("Unit cost must be zero or greater");
    const itemRef = doc(collection(db, CONFIG.COL.inventory));
    const moveRef = quantity > 0 ? movementRef() : null;
    await runTransaction(db, async tx => {
      const now = serverTimestamp();
      tx.set(itemRef, { ...itemData, partName: name, stockQuantity: quantity, unitCost: rate, createdAt: now, updatedAt: now });
      if (moveRef) tx.set(moveRef, {
        itemId: itemRef.id, itemName: name, category: itemData.category || "Other",
        unit: itemData.unit || "Nos", movementType: "OPENING", quantityDelta: quantity,
        quantityBefore: 0, quantityAfter: quantity, unitCost: rate, value: rate * quantity,
        reason: "Opening balance", reference: "OPENING", createdAt: now
      });
    });
    return { itemRef, movementRef: moveRef };
  }

  async function postGoodsInward({
    itemId, expectedCategory, itemName, unit = "Nos", quantity, rate, gstPercent,
    taxableAmount, gstAmount, total, supplier, invoiceNumber, receiptDate, notes = ""
  }) {
    const q = number(quantity), r = number(rate), gst = number(gstPercent);
    const taxable = number(taxableAmount), tax = number(gstAmount), invoiceTotal = number(total);
    const supplierName = requiredText(supplier, "Supplier");
    const invoice = requiredText(invoiceNumber, "Invoice / GRN reference");
    requiredText(receiptDate, "Receipt date");
    if (!itemId) throw new Error("Select a valid inventory item");
    if (!Number.isFinite(q) || q <= 0) throw new Error("Receipt quantity must be greater than zero");
    if (!Number.isFinite(r) || r < 0) throw new Error("Unit rate must be zero or greater");
    if (!Number.isFinite(gst) || gst < 0 || gst > 100) throw new Error("GST must be between 0 and 100%");
    if (![taxable, tax, invoiceTotal].every(Number.isFinite) || taxable < 0 || tax < 0 || invoiceTotal < 0) throw new Error("Receipt totals are invalid");
    if (Math.abs(taxable - +(q * r).toFixed(2)) > 0.02) throw new Error("Taxable amount does not match quantity × rate");
    if (Math.abs(tax - +(taxable * gst / 100).toFixed(2)) > 0.02 || Math.abs(invoiceTotal - +(taxable + tax).toFixed(2)) > 0.02) throw new Error("GST or invoice total does not reconcile");

    const receiptId = stableId("grn", itemId + "|" + supplierName + "|" + invoice);
    const receipt = doc(db, CONFIG.COL.inwards, receiptId);
    const move = doc(db, CONFIG.COL.movements, "in_" + receiptId);
    const itemRef = itemRefFor(itemId);
    await runTransaction(db, async tx => {
      const itemSnap = await tx.get(itemRef);
      const receiptSnap = await tx.get(receipt);
      if (!itemSnap.exists()) throw new Error("Item no longer exists");
      if (receiptSnap.exists()) throw new Error("This supplier invoice / GRN has already been posted for this item");
      const current = itemSnap.data();
      if (current.category !== expectedCategory) throw new Error("Item category changed. Refresh and retry");
      const oldQty = number(current.stockQuantity ?? 0);
      const oldCost = number(current.unitCost ?? 0);
      if (!Number.isFinite(oldQty) || oldQty < 0) throw new Error("Current stock balance is invalid; reconcile it before receiving stock");
      const newQty = oldQty + q;
      // Moving weighted average is valid only when the existing carrying cost is known.
      // Do not silently value unknown legacy stock at zero or fabricate a blended rate.
      const newCost = oldQty === 0 ? r : oldCost > 0 ? +((oldQty * oldCost + q * r) / newQty).toFixed(4) : 0;
      const now = serverTimestamp();
      tx.update(itemRef, { stockQuantity: newQty, unitCost: newCost, costStatus: oldQty > 0 && oldCost <= 0 ? "REVIEW_REQUIRED" : "KNOWN", updatedAt: now });
      tx.set(receipt, {
        itemId, itemName: itemName || current.partName || current.itemName || "Unnamed item",
        category: expectedCategory, unit, quantity: q, rate: r, gstPercent: gst,
        taxableAmount: taxable, gstAmount: tax, total: invoiceTotal,
        supplier: supplierName, invoiceNumber: invoice, receiptDate, notes: String(notes || ""),
        quantityBefore: oldQty, quantityAfter: newQty, unitCostBefore: Number.isFinite(oldCost) ? oldCost : 0,
        unitCostAfter: newCost, createdAt: now, transactionType: "INWARD"
      });
      tx.set(move, {
        itemId, itemName: itemName || current.partName || current.itemName || "Unnamed item",
        category: expectedCategory, unit, movementType: "INWARD", quantityDelta: q,
        quantityBefore: oldQty, quantityAfter: newQty, unitCost: r, value: +(q * r).toFixed(2),
        supplier: supplierName, invoiceNumber: invoice, receiptId, reference: invoice,
        reason: "Goods receipt", notes: String(notes || ""), createdAt: now
      });
    });
    return { receiptRef: receipt, movementRef: move };
  }

  async function postLocalPurchaseStock({ itemId, quantity, rate, reference = "", performedBy = "Local expense entry" }) {
    const q = number(quantity), r = number(rate);
    if (!itemId) throw new Error("Select an inventory item");
    if (!Number.isFinite(q) || q <= 0) throw new Error("Purchase stock quantity must be greater than zero");
    if (!Number.isFinite(r) || r < 0) throw new Error("Purchase unit rate must be zero or greater");
    const itemRef = itemRefFor(itemId), move = movementRef();
    await runTransaction(db, async tx => {
      const snap = await tx.get(itemRef);
      if (!snap.exists()) throw new Error("Item no longer exists");
      const item = snap.data(), before = number(item.stockQuantity ?? 0), oldCost = number(item.unitCost ?? 0);
      if (!Number.isFinite(before) || before < 0) throw new Error("Current stock balance is invalid; reconcile it before adding purchase stock");
      const after = before + q;
      const cost = before === 0 ? r : oldCost > 0 ? +((before * oldCost + q * r) / after).toFixed(4) : 0;
      const now = serverTimestamp();
      tx.update(itemRef, { stockQuantity: after, unitCost: cost, costStatus: before > 0 && oldCost <= 0 ? "REVIEW_REQUIRED" : "KNOWN", updatedAt: now });
      tx.set(move, {
        itemId, itemName: item.partName || item.itemName || "Unnamed item", category: item.category || "Other",
        unit: item.unit || "Nos", movementType: "LOCAL_PURCHASE", quantityDelta: q,
        quantityBefore: before, quantityAfter: after, unitCost: r, value: +(q * r).toFixed(2),
        reason: "Local expense stock addition", reference: String(reference || "").trim(),
        performedBy: String(performedBy || "").trim(), createdAt: now
      });
    });
    return { movementRef: move };
  }

  async function issueStock({ itemId, quantity, reason, reference = "", issuedTo = "", performedBy = "" }) {
    const q = number(quantity);
    const why = requiredText(reason, "Issue reason");
    if (!itemId) throw new Error("Select an inventory item");
    if (!Number.isFinite(q) || q <= 0) throw new Error("Issue quantity must be greater than zero");
    const itemRef = itemRefFor(itemId), move = movementRef();
    await runTransaction(db, async tx => {
      const snap = await tx.get(itemRef);
      if (!snap.exists()) throw new Error("Item no longer exists");
      const item = snap.data(), before = number(item.stockQuantity ?? 0);
      if (!Number.isFinite(before) || before < 0) throw new Error("Current stock balance is invalid; reconcile it before issuing stock");
      if (q > before + 1e-9) throw new Error("Insufficient stock. Available: " + before + " " + (item.unit || "units"));
      const after = Math.max(0, before - q), cost = Math.max(0, number(item.unitCost ?? 0)), now = serverTimestamp();
      tx.update(itemRef, { stockQuantity: after, updatedAt: now });
      tx.set(move, {
        itemId, itemName: item.partName || item.itemName || "Unnamed item", category: item.category || "Other",
        unit: item.unit || "Nos", movementType: "ISSUE", quantityDelta: -q,
        quantityBefore: before, quantityAfter: after, unitCost: cost, value: +(q * cost).toFixed(2),
        reason: why, reference: String(reference || "").trim(), issuedTo: String(issuedTo || "").trim(),
        performedBy: String(performedBy || "").trim(), createdAt: now
      });
    });
    return { movementRef: move };
  }

  async function adjustStock({ itemId, quantityDelta, reason, reference = "", performedBy = "" }) {
    const delta = number(quantityDelta);
    const why = requiredText(reason, "Adjustment reason");
    if (!itemId) throw new Error("Select an inventory item");
    if (!Number.isFinite(delta) || delta === 0) throw new Error("Adjustment must be a non-zero quantity");
    const itemRef = itemRefFor(itemId), move = movementRef();
    await runTransaction(db, async tx => {
      const snap = await tx.get(itemRef);
      if (!snap.exists()) throw new Error("Item no longer exists");
      const item = snap.data(), before = number(item.stockQuantity ?? 0);
      if (!Number.isFinite(before) || before < 0) throw new Error("Current stock balance is invalid; reconcile it before adjusting stock");
      const after = before + delta;
      if (after < -1e-9) throw new Error("Adjustment would make stock negative. Available: " + before);
      const normalizedAfter = Math.max(0, after), cost = Math.max(0, number(item.unitCost ?? 0)), now = serverTimestamp();
      tx.update(itemRef, { stockQuantity: normalizedAfter, updatedAt: now });
      tx.set(move, {
        itemId, itemName: item.partName || item.itemName || "Unnamed item", category: item.category || "Other",
        unit: item.unit || "Nos", movementType: "ADJUSTMENT", quantityDelta: delta,
        quantityBefore: before, quantityAfter: normalizedAfter, unitCost: cost, value: +(Math.abs(delta) * cost).toFixed(2),
        reason: why, reference: String(reference || "").trim(), performedBy: String(performedBy || "").trim(), createdAt: now
      });
    });
    return { movementRef: move };
  }

  /**
   * Posts a turf-plan issue as one atomic operation: reduce inventory, append the
   * movement ledger row, and advance the plan to Issued. Existing issue workflows
   * remain unchanged; this path is opt-in for explicitly linked turf plans.
   */
  async function issueStockForTurfPlan({ planId, itemId, quantity, reason = "Turf plan issue", reference = "", issuedTo = "", performedBy = "" }) {
    const q = number(quantity);
    const why = requiredText(reason, "Issue reason");
    requiredText(planId, "Turf plan");
    if (!itemId) throw new Error("The turf plan has no linked inventory item; reconcile the product link first");
    if (!Number.isFinite(q) || q <= 0) throw new Error("Issue quantity must be greater than zero");
    const itemRef = itemRefFor(itemId), planRef = doc(db, CONFIG.COL.plans, planId), move = movementRef();
    await runTransaction(db, async tx => {
      const itemSnap = await tx.get(itemRef);
      const planSnap = await tx.get(planRef);
      if (!itemSnap.exists()) throw new Error("Inventory item no longer exists");
      if (!planSnap.exists()) throw new Error("Turf plan no longer exists");
      const plan = planSnap.data(), item = itemSnap.data();
      const status = String(plan.status ?? "Planned").trim().toLowerCase();
      if (!["planned", "partially issued", "issued"].includes(status)) throw new Error("Only a Planned or partially issued turf record can receive stock");
      if (status !== "planned" && !(plan.issueMovementId || (Array.isArray(plan.issueMovementIds) && plan.issueMovementIds.length))) {
        throw new Error("This legacy issue has no linked stock movement. Reconcile it before posting more stock");
      }
      if (String(plan.productId ?? plan.itemId ?? "") !== String(itemId)) throw new Error("Selected inventory item does not match the saved turf plan");
      const plannedQty = number(plan.targetQty ?? plan.plannedQty ?? plan.requestedQty ?? plan.quantity ?? plan.qty);
      if (!Number.isFinite(plannedQty) || plannedQty <= 0) throw new Error("The saved turf plan has no valid planned quantity");
      const alreadyIssued = Math.max(0, number(plan.issuedQty ?? plan.issuedQuantity ?? 0));
      const remainingQty = Math.max(0, plannedQty - alreadyIssued);
      if (remainingQty <= 1e-9) throw new Error("The full planned quantity has already been issued");
      if (q > remainingQty + 1e-9) throw new Error("Issue quantity cannot exceed the remaining planned quantity (" + remainingQty + ")");
      const before = number(item.stockQuantity ?? 0), cost = number(item.unitCost ?? 0);
      if (!Number.isFinite(before) || before < 0) throw new Error("Current stock balance is invalid; reconcile it before issuing stock");
      if (q > before + 1e-9) throw new Error("Insufficient stock. Available: " + before + " " + (item.unit || "units"));
      const after = Math.max(0, before - q), now = serverTimestamp();
      const totalIssued = alreadyIssued + q;
      const newPlanStatus = totalIssued >= plannedQty - 1e-9 ? "Issued" : "Partially Issued";
      const oldMovementIds = Array.isArray(plan.issueMovementIds) ? plan.issueMovementIds : (plan.issueMovementId ? [plan.issueMovementId] : []);
      const planReference = String(reference || ("TURFPLAN-" + planId)).trim();
      tx.update(itemRef, { stockQuantity: after, updatedAt: now });
      tx.set(move, {
        itemId, itemName: item.partName || item.itemName || plan.productName || "Unnamed item",
        category: item.category || plan.category || "Other", unit: item.unit || plan.unit || "Nos",
        movementType: "ISSUE", quantityDelta: -q, quantityBefore: before, quantityAfter: after,
        unitCost: Math.max(0, cost), value: +(q * Math.max(0, cost)).toFixed(2),
        reason: why, reference: planReference, issuedTo: String(issuedTo || plan.targetArea || "").trim(),
        performedBy: String(performedBy || "").trim(), linkedPlanId: planId, turfPlanId: planId,
        targetArea: String(plan.targetArea || plan.area || "").trim(), createdAt: now
      });
      tx.update(planRef, {
        status: newPlanStatus, issuedQty: totalIssued, lastIssuedQty: q, issuedAt: now,
        lastIssuedAt: now, issuedBy: String(performedBy || "").trim(),
        issuedTo: String(issuedTo || plan.targetArea || "").trim(),
        issueMovementId: plan.issueMovementId || move.id,
        issueMovementIds: [...oldMovementIds, move.id], latestIssueMovementId: move.id,
        issueReference: planReference, updatedAt: now
      });
    });
    return { movementRef: move };
  }

  /**
   * Reconciles the issued quantity into applied, returned-to-store and explicitly
   * unaccounted quantities. Any physical return increases stock and writes a
   * matching movement in the same transaction. Unaccounted quantity needs notes.
   */
  async function completeTurfPlan({ planId, appliedQty, returnedQty = 0, unaccountedQty = 0, appliedBy, applicationNotes = "" }) {
    requiredText(planId, "Turf plan");
    const applied = number(appliedQty), returned = number(returnedQty), unaccounted = number(unaccountedQty);
    const actor = requiredText(appliedBy, "Applied by");
    const notes = String(applicationNotes || "").trim();
    if (![applied, returned, unaccounted].every(Number.isFinite) || applied <= 0 || returned < 0 || unaccounted < 0) {
      throw new Error("Enter a positive applied quantity and non-negative returned / unaccounted quantities");
    }
    if (unaccounted > 1e-9 && !notes) throw new Error("Add notes to explain any unaccounted quantity");
    const planRef = doc(db, CONFIG.COL.plans, planId);
    const now = serverTimestamp();
    let returnMove = null;
    await runTransaction(db, async tx => {
      const planSnap = await tx.get(planRef);
      if (!planSnap.exists()) throw new Error("Turf plan no longer exists");
      const plan = planSnap.data();
      if (!["issued", "partially issued"].includes(String(plan.status ?? "").trim().toLowerCase())) throw new Error("Only an Issued or partially issued turf plan can be reconciled");
      if (!plan.issueMovementId) throw new Error("This legacy issue has no linked stock movement. Reconcile it before marking the plan applied");
      const issued = number(plan.issuedQty);
      if (!Number.isFinite(issued) || issued <= 0) throw new Error("The recorded issue quantity is missing or invalid");
      if (Math.abs(applied + returned + unaccounted - issued) > 1e-6) {
        throw new Error("Applied + returned + unaccounted quantities must equal the issued quantity (" + issued + ")");
      }
      const itemId = String(plan.productId ?? plan.itemId ?? "");
      let itemRef = null, item = null, before = 0, after = 0, cost = 0;
      if (returned > 0) {
        if (!itemId) throw new Error("The plan has no linked inventory item; reconcile before returning stock");
        itemRef = itemRefFor(itemId);
        const itemSnap = await tx.get(itemRef);
        if (!itemSnap.exists()) throw new Error("Inventory item no longer exists; cannot post the return");
        item = itemSnap.data();
        before = number(item.stockQuantity ?? 0);
        cost = Math.max(0, number(item.unitCost ?? 0));
        if (!Number.isFinite(before) || before < 0) throw new Error("Current stock balance is invalid; reconcile it before returning stock");
        after = before + returned;
        returnMove = movementRef();
      }
      if (returned > 0) {
        tx.update(itemRef, { stockQuantity: after, updatedAt: now });
        tx.set(returnMove, {
          itemId, itemName: item.partName || item.itemName || plan.productName || "Unnamed item",
          category: item.category || plan.category || "Other", unit: item.unit || plan.unit || "Nos",
          movementType: "TURF_RETURN", quantityDelta: returned, quantityBefore: before, quantityAfter: after,
          unitCost: cost, value: +(returned * cost).toFixed(2), reason: "Unused turf product returned to store",
          reference: String(plan.issueReference || ("TURFPLAN-" + planId)), performedBy: actor,
          linkedPlanId: planId, turfPlanId: planId, returnForMovementId: plan.issueMovementId, createdAt: now
        });
      }
      tx.update(planRef, {
        status: "Applied", appliedQty: applied, returnedQty: returned, unaccountedQty: unaccounted,
        appliedBy: actor, applicationNotes: notes, appliedAt: now,
        returnMovementId: returnMove?.id || "", updatedAt: now
      });
    });
    return { returnMovementRef: returnMove };
  }

  async function cancelTurfPlan({ planId, cancelledBy, reason }) {
    requiredText(planId, "Turf plan");
    const actor = requiredText(cancelledBy, "Cancelled by");
    const why = requiredText(reason, "Cancellation reason");
    const planRef = doc(db, CONFIG.COL.plans, planId);
    await runTransaction(db, async tx => {
      const planSnap = await tx.get(planRef);
      if (!planSnap.exists()) throw new Error("Turf plan no longer exists");
      const plan = planSnap.data();
      if (String(plan.status ?? "Planned").trim().toLowerCase() !== "planned") throw new Error("Only a Planned turf record can be cancelled");
      tx.update(planRef, { status: "Cancelled", cancelledBy: actor, cancellationReason: why, cancelledAt: serverTimestamp(), updatedAt: serverTimestamp() });
    });
  }

  return { createItemWithOpeningBalance, postGoodsInward, postLocalPurchaseStock, issueStock, adjustStock, issueStockForTurfPlan, completeTurfPlan, cancelTurfPlan };
}
