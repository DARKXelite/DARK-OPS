/** Function-based ReorderIntelligence module. Dependencies are injected from the application context. */
export function createReorderIntelligenceModule(deps) {
  const { , addDays, daysBetween, fuelRecordDate, fuelTypeFromRecord, isTurfCategory, itemName, mName, normDate, num, today, turfCategoryLabel, turfProductForPlan, turfRecordDate, turfRecordProductName, turfRecordQuantity, turfRecordStatus } = deps;
const AUTO_REORDER_POLICY = {
  Fuel: { leadDays: 3, floor: 10 },
  Fertilizers: { leadDays: 7, floor: 1 },
  Pesticides: { leadDays: 7, floor: 1 },
  'Turf Enhancements': { leadDays: 7, floor: 1 },
  'Spare Parts': { leadDays: 14, floor: 1 },
  Tools: { leadDays: 7, floor: 1 },
  Other: { leadDays: 7, floor: 1 }
};
let _reorderIndexVersion = -1, _reorderUsageIndex = new Map(), _reorderDetailCache = new Map();
const normItemName = value => String(value || '').trim().toLowerCase().replace(/\s+/g,' ');
function resolveInventoryItem(id, name, preferredCategory='') {
  if (id) { const byId=S.inventory.find(i=>i.id===String(id)); if(byId) return byId; }
  const n=normItemName(name); if(!n) return null;
  const candidates=S.inventory.filter(i=>normItemName(itemName(i))===n);
  if(preferredCategory){ const preferred=candidates.find(i=>String(i.category||'').toLowerCase()===preferredCategory.toLowerCase()); if(preferred) return preferred; }
  return candidates.length===1 ? candidates[0] : null;
}
function buildReorderUsageIndex() {
  if (_reorderIndexVersion === S._v) return;
  _reorderIndexVersion = S._v; _reorderUsageIndex = new Map(); _reorderDetailCache = new Map();
  const push=(item,date,qty,meta={})=>{ if(!item || !date || !(qty>0)) return; const arr=_reorderUsageIndex.get(item.id)||[]; arr.push({date,qty,...meta}); _reorderUsageIndex.set(item.id,arr); };
  // Fuel history is machine-aware and tied to exact Diesel/Petrol inventory masters.
  (S.fuel||[]).forEach(f=>{
    const date=fuelRecordDate(f), type=fuelTypeFromRecord(f), name=type==='Unspecified'?'':type;
    const item=resolveInventoryItem(null,name,'Fuel');
    const qty=Math.max(0,num(f.litres ?? f.quantity ?? f.qty ?? f.fuelLitres ?? f.fuelQuantity));
    if(item) push(item,date,qty,{machine:f.machineName||mName(f.machineId)||'Unknown machine',source:'fuel'});
  });
  // Turf usage counts issued/applied entries, never still-planned work.
  (S.plans||[]).forEach(p=>{
    const status=turfRecordStatus(p); if(!['Issued','Applied'].includes(status)) return;
    const date=turfRecordDate(p), item=turfProductForPlan(p) || resolveInventoryItem(p.productId ?? p.itemId ?? p.inventoryId,turfRecordProductName(p));
    if(!item || !isTurfCategory(item.category)) return;
    const qty=Math.max(0,turfRecordQuantity(p));
    if(qty>0) push(item,date,qty,{source:'turf'});
  });
  // Parts consumption in maintenance/general logs, when these fields exist in the current schema.
  [...(S.logs||[]),...(S.maintenance||[])].forEach(log=>{
    const date=normDate(log.date ?? log.logDate ?? log.maintenanceDate ?? log.reportedDate,log.timestamp ?? log.createdAt ?? log.createdOn ?? log.updatedAt ?? log.completedAt);
    const nested=log.partsConsumed ?? log.itemsConsumed ?? log.consumedItems ?? log.partsUsed ?? log.inventoryItems ?? [];
    if(Array.isArray(nested)) nested.forEach(part=>{
      const item=resolveInventoryItem(part.partId ?? part.itemId ?? part.productId ?? part.inventoryId ?? part.stockItemId, part.partName ?? part.itemName ?? part.productName ?? part.name);
      const qty=Math.max(0,num(part.qty ?? part.quantity ?? part.usedQty ?? part.consumedQty ?? part.quantityUsed));
      if(item && !isTurfCategory(item.category) && String(item.category||'').toLowerCase()!=='fuel') push(item,date,qty,{source:'parts'});
    });
    const directId=log.itemId ?? log.partId ?? log.productId ?? log.inventoryId;
    if(directId){
      const item=resolveInventoryItem(directId,log.itemName ?? log.partName ?? log.productName);
      const qty=Math.max(0,num(log.quantityOut ?? log.issuedQty ?? log.qtyIssued ?? log.quantityUsed ?? log.qty ?? log.quantity));
      if(item && !isTurfCategory(item.category) && String(item.category||'').toLowerCase()!=='fuel') push(item,date,qty,{source:'parts'});
    }
  });
}
function autoReorderDetails(item) {
  buildReorderUsageIndex();
  if(_reorderDetailCache.has(item.id)) return _reorderDetailCache.get(item.id);
  const category=turfCategoryLabel(item.category)!=='Other'?turfCategoryLabel(item.category):String(item.category||'Other').trim();
  const key=AUTO_REORDER_POLICY[category]?category:'Other', policy=AUTO_REORDER_POLICY[key];
  const end=today(), start=addDays(end,-89), events=(_reorderUsageIndex.get(item.id)||[]).filter(e=>e.date>=start && e.date<=end);
  const earliest=events.length?events.map(e=>e.date).sort()[0]:start;
  const observedStart=earliest>start?earliest:start, observedDates=daysBetween(observedStart,end);
  const daily=new Map(observedDates.map(d=>[d,0]));
  events.forEach(e=>daily.set(e.date,(daily.get(e.date)||0)+e.qty));
  const values=[...daily.values()], total=values.reduce((a,b)=>a+b,0), mean=total/Math.max(1,values.length);
  const variance=values.reduce((a,v)=>a+Math.pow(v-mean,2),0)/Math.max(1,values.length), sd=Math.sqrt(variance);
  const activeDays=new Set(events.map(e=>e.date)).size;
  const reliable=events.length>=3 && activeDays>=3 && observedDates.length>=14;
  const legacy=Math.max(0,num(item.reorderLevel));
  const raw=reliable ? mean*policy.leadDays + 1.28*sd*Math.sqrt(policy.leadDays) : Math.max(legacy,policy.floor);
  const unit=String(item.unit||item.uom||item.stockUnit||'').toLowerCase();
  const integerUnit=/^(nos?|pieces?|pcs?|packs?|bags?|sets?|units?)$/.test(unit);
  const level=reliable ? (integerUnit?Math.ceil(raw):Math.ceil(raw*10)/10) : Math.max(legacy,policy.floor);
  const details={level,leadDays:policy.leadDays,meanDaily:mean,totalUsage:total,windowDays:observedDates.length,transactions:events.length,activeDays,reliable,method:reliable?`${observedDates.length}-day demand + safety buffer`:'Provisional floor',daysCover:mean>0?Math.max(0,num(item.stockQuantity))/mean:null,events};
  _reorderDetailCache.set(item.id,details); return details;
}
function effectiveReorderLevel(item) { return autoReorderDetails(item).level; }

  return { normItemName, resolveInventoryItem, buildReorderUsageIndex, autoReorderDetails, effectiveReorderLevel };
}
