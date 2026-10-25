/** Shared turf product, date, status and unit normalization rules. */
export function createTurfDomainModule(deps) {
  const { S, itemName, normDate, num, ymd } = deps;
function getSunday(d) {
  const dt = new Date(d + "T00:00:00");
  const day = dt.getDay();
  const diff = dt.getDate() - day;
  return ymd(new Date(dt.setDate(diff)));
}
function isTurfCategory(category) {
  const c = String(category || '').toLowerCase();
  return /fertiliz|fertilis|pesticid|enhancement|turf enhancer|turf improver|growth enhancer/.test(c);
}
function turfCategoryLabel(category) {
  const c = String(category || '').toLowerCase();
  if (/fertiliz|fertilis/.test(c)) return 'Fertilizers';
  if (/pesticid/.test(c)) return 'Pesticides';
  if (/enhancement|turf enhancer|turf improver|growth enhancer/.test(c)) return 'Turf Enhancements';
  return 'Other';
}
function turfRecordDate(plan) {
  if (plan && plan._d) return plan._d;
  const dateValue = plan && (plan.date ?? plan.issuedDate ?? plan.applicationDate ?? plan.appliedDate ?? plan.issueDate ?? plan.transactionDate ?? plan.logDate ?? plan.plannedDate ?? plan.createdDate);
  return normDate(dateValue, plan && (plan.issuedAt ?? plan.issueTimestamp ?? plan.appliedAt ?? plan.completedAt ?? plan.timestamp ?? plan.createdAt ?? plan.createdOn ?? plan.updatedAt ?? plan.recordedAt ?? plan.createdTime));
}
function turfRecordProductName(plan) {
  if (!plan) return '';
  const nested = plan.product && typeof plan.product === 'object' ? (plan.product.name ?? plan.product.productName ?? plan.product.partName ?? plan.product.itemName) : plan.product;
  const nestedItem = plan.item && typeof plan.item === 'object' ? (plan.item.name ?? plan.item.productName ?? plan.item.partName ?? plan.item.itemName) : plan.item;
  return String(plan.productName ?? plan.itemName ?? plan.inventoryItemName ?? plan.inventoryName ?? plan.partName ?? plan.stockItemName ?? plan.productLabel ?? nested ?? nestedItem ?? plan.chemicalName ?? plan.fertilizerName ?? plan.materialName ?? plan.name ?? plan.title ?? '').trim();
}
function turfRecordQuantity(plan) {
  return num(plan && (plan.actualQty ?? plan.appliedQty ?? plan.applicationQty ?? plan.issuedQty ?? plan.issuedQuantity ?? plan.issueQty ?? plan.issueQuantity ?? plan.quantityIssued ?? plan.qtyIssued ?? plan.quantityOut ?? plan.qtyOut ?? plan.quantityUsed ?? plan.usedQuantity ?? plan.qtyUsed ?? plan.dispensedQty ?? plan.quantity ?? plan.qty ?? plan.targetQty ?? plan.plannedQty ?? plan.requestedQty));
}
function turfRecordStatus(plan) {
  const raw = String(plan && (plan.status ?? plan.applicationStatus ?? plan.issueStatus ?? plan.transactionType ?? plan.movementType ?? plan.recordType ?? plan.entryType ?? plan.logType ?? plan.actionType ?? plan.state ?? plan.action) || 'Planned').trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (/\bnot applied\b|\bpending\b|\bplanned\b|\bscheduled\b/.test(raw)) return 'Planned';
  if (/\b(applied|completed|complete|consumed|used|done)\b/.test(raw)) return 'Applied';
  if (/\b(issued|issue|dispensed|released|given out|outward|withdrawn|consumption|stock out|quantity out|out)\b/.test(raw)) return 'Issued';
  if (/\b(cancelled|canceled|void|rejected)\b/.test(raw)) return 'Cancelled';
  return 'Planned';
}
function turfProductForPlan(plan) {
  if (!plan) return null;
  const productId = plan.productId ?? plan.productID ?? plan.itemId ?? plan.inventoryId ?? plan.inventoryItemId ?? plan.inventoryItemDocId ?? plan.productDocId ?? plan.stockItemId ?? plan.skuId ?? (plan.product && typeof plan.product === 'object' ? (plan.product.id ?? plan.product.productId ?? plan.product.itemId) : null);
  const name = turfRecordProductName(plan).toLowerCase();
  return S.inventory.find(i => productId && i.id === productId)
    || S.inventory.find(i => name && itemName(i).trim().toLowerCase() === name)
    || S.inventory.find(i => name && String(i.name || i.productName || '').trim().toLowerCase() === name)
    || null;
}
function turfPlanCategory(plan) {
  const product = turfProductForPlan(plan);
  const fromPlan = plan && (plan.category ?? plan.productCategory ?? plan.itemCategory ?? plan.materialCategory ?? plan.productType ?? plan.itemType ?? plan.fertilizerType ?? plan.product?.category ?? plan.type);
  // Trust a recognized product-master category over a generic/mismatched label saved on the log.
  const productLabel = turfCategoryLabel(product && product.category);
  if (product && productLabel !== 'Other') return productLabel;
  const planLabel = turfCategoryLabel(fromPlan);
  if (planLabel !== 'Other') return planLabel;
  const name = turfRecordProductName(plan);
  const nameLabel = turfCategoryLabel(name);
  return nameLabel !== 'Other' ? nameLabel : 'Other';
}
function turfCategoryClass(category) {
  const c = String(category || '').toLowerCase();
  if (c.includes('pesticide')) return 'pesticide';
  if (c.includes('enhancement') || c.includes('enhancer')) return 'enhancer';
  return 'fertilizer';
}
function turfProductUnit(product) { return String(product?.unit || product?.uom || product?.stockUnit || product?.unitOfMeasure || '').trim(); }


  return { getSunday, isTurfCategory, turfCategoryLabel, turfRecordDate, turfRecordProductName, turfRecordQuantity, turfRecordStatus, turfProductForPlan, turfPlanCategory, turfCategoryClass, turfProductUnit };
}
