/**
 * DARK-OPS standalone decision engine.
 * Deterministic, explainable inventory and operations analytics. All outputs carry
 * their input-data limitations; this module does not claim an ML model or invent prices.
 */
const n = v => Number.isFinite(Number(v)) ? Number(v) : 0;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mean = xs => xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : 0;
const sd = xs => xs.length > 1 ? Math.sqrt(xs.reduce((s,x)=>s+(x-mean(xs))**2,0)/(xs.length-1)) : 0;
const cv = xs => mean(xs) > 0 ? sd(xs)/mean(xs) : null;
const median = xs => { if (!xs.length) return 0; const a=[...xs].sort((x,y)=>x-y),m=Math.floor(a.length/2); return a.length%2?a[m]:(a[m-1]+a[m])/2; };
const dateOf = x => {
  const v=x?.date ?? x?.receiptDate ?? x?.issueDate ?? x?.createdAt ?? x?.timestamp ?? x?._d;
  if (typeof v === "string") return v.slice(0,10);
  if (v?.toDate) return v.toDate().toISOString().slice(0,10);
  if (v?.toMillis) return new Date(v.toMillis()).toISOString().slice(0,10);
  if (typeof v === "number") return new Date(v < 1e12 ? v*1000 : v).toISOString().slice(0,10);
  return "";
};
const monthOf = d => d ? d.slice(0,7) : "";
function regression(values) {
  if (values.length < 2) return { slope: 0, intercept: values[0] || 0, next: values[0] || 0, r2: 0 };
  const xs=values.map((_,i)=>i), mx=mean(xs), my=mean(values);
  const den=xs.reduce((s,x)=>s+(x-mx)**2,0) || 1;
  const slope=xs.reduce((s,x,i)=>s+(x-mx)*(values[i]-my),0)/den, intercept=my-slope*mx;
  const ssTot=values.reduce((s,y)=>s+(y-my)**2,0), ssRes=values.reduce((s,y,i)=>s+(y-(intercept+slope*i))**2,0);
  return { slope, intercept, next: Math.max(0,intercept+slope*values.length), r2: ssTot ? clamp(1-ssRes/ssTot,0,1) : 1 };
}
function robustAnomalies(movements, asOf) {
  const daily=new Map();
  movements.filter(m=>m.movementType==="ISSUE" && dateOf(m) && dateOf(m)<=asOf).forEach(m=>{
    const d=dateOf(m); daily.set(d,(daily.get(d)||0)+Math.abs(n(m.quantityDelta)));
  });
  const rows=[...daily.entries()].map(([date,quantity])=>({date,quantity})).sort((a,b)=>a.date.localeCompare(b.date));
  const baseline=rows.map(x=>x.quantity), med=median(baseline), mad=median(baseline.map(x=>Math.abs(x-med)));
  const anomalies=rows.filter(x=>rows.length>=7 && mad>0 && Math.abs(x.quantity-med)/(1.4826*mad)>=3.5)
    .map(x=>({...x,robustZ:+((x.quantity-med)/(1.4826*mad)).toFixed(2),type:"UNUSUAL_ISSUE_VOLUME"}));
  return { anomalies, daysObserved:rows.length, medianDailyIssue:med, method:"Median absolute deviation (MAD), robust z ≥ 3.5" };
}
export function analyzeInventory({
  items=[], movements=[], counts=[], fuel=[], shifts=[], machines=[], plans=[], maintenance=[], logs=[],
  asOf=new Date().toISOString().slice(0,10), leadDays=7, orderCost=250, annualHoldingRate=0.2, serviceZ=1.65
}={}) {
  const horizonStart=asOf.slice(0,7)+"-01";
  const recentStart=new Date(asOf+"T00:00:00"); recentStart.setDate(recentStart.getDate()-179);
  const recentDate=recentStart.toISOString().slice(0,10);
  const issueRows=movements.filter(m=>m.movementType==="ISSUE" && dateOf(m) && dateOf(m)<=asOf);
  const perItem=new Map();
  for (const m of issueRows) {
    const id=m.itemId||"";
    if(!perItem.has(id)) perItem.set(id,{daily:new Map(),monthly:new Map(),totalQty:0,totalValue:0});
    const r=perItem.get(id),d=dateOf(m),q=Math.abs(n(m.quantityDelta));
    if(d>=recentDate) r.daily.set(d,(r.daily.get(d)||0)+q);
    const mo=monthOf(d); if(mo)r.monthly.set(mo,(r.monthly.get(mo)||0)+q);
    r.totalQty+=q; r.totalValue+=q*Math.max(0,n(m.unitCost));
  }
  const rows=items.map(item=>{
    const hist=perItem.get(item.id)||{daily:new Map(),monthly:new Map(),totalQty:0,totalValue:0};
    const monthly=[];
    const dt=new Date(asOf+"T00:00:00");
    for(let i=5;i>=0;i--){const x=new Date(dt.getFullYear(),dt.getMonth()-i,1);const key=x.toISOString().slice(0,7);monthly.push(n(hist.monthly.get(key)));}
    const dailyValues=[]; for(let i=179;i>=0;i--){const x=new Date(asOf+"T00:00:00");x.setDate(x.getDate()-i);dailyValues.push(n(hist.daily.get(x.toISOString().slice(0,10))));}
    const qty=Math.max(0,n(item.stockQuantity)), cost=Math.max(0,n(item.unitCost)), value=qty*cost;
    const monthlyAvg=mean(monthly), monthlySd=sd(monthly), demandCv=cv(monthly);
    const trend=regression(monthly), forecast30=Math.max(0,trend.next/30*30*0.5+monthlyAvg/30*30*0.5);
    const dailyAvg=mean(dailyValues), dailySd=sd(dailyValues);
    const safety=serviceZ*dailySd*Math.sqrt(Math.max(1,n(leadDays)));
    const rop=dailyAvg*Math.max(1,n(leadDays))+safety;
    const annualDemand=hist.totalQty*2;
    const holdingCost=cost*Math.max(0.01,n(annualHoldingRate));
    const eoq=holdingCost>0?Math.sqrt((2*annualDemand*Math.max(0,n(orderCost)))/holdingCost):0;
    const cover=dailyAvg>0?qty/dailyAvg:null;
    const demandTrend=monthly.length>=3&&monthly[0]>0?(monthly[5]-monthly[0])/monthly[0]:null;
    const dataPoints=hist.totalQty>0?hist.monthly.size:0;
    const recommendedOrder=Math.max(0,Math.ceil(Math.max(rop,Math.min(eoq||rop,Math.max(0,forecast30*2)))-qty));
    return {id:item.id,name:item.partName||item.itemName||"Unnamed item",category:item.category||"Other",unit:item.unit||"Nos",
      qty,cost,value,unpriced:qty>0&&cost<=0,monthly,monthlyAvg,monthlySd,demandCv,trendR2:trend.r2,
      trend:demandTrend,forecast30,dailyAvg,safetyStock:safety,reorderPoint:rop,eoq,daysCover:cover,
      demandValue:hist.totalValue,issuedQty:hist.totalQty,dataPoints,recommendedOrder,
      low:qty<=Math.max(n(item.reorderLevel),rop), stockoutRisk:cover!==null&&cover<=Math.max(1,n(leadDays)),
      demandClass:dataPoints<3?"INSUFFICIENT":demandCv!==null&&demandCv<=0.5?"X":demandCv!==null&&demandCv<=1?"Y":"Z",
      sourceCoverage:hist.totalQty>0?"Recorded issue movements only":"No issue movement history"};
  });
  const abcSorted=[...rows].sort((a,b)=>b.demandValue-a.demandValue);
  const totalDemandValue=abcSorted.reduce((s,x)=>s+x.demandValue,0);let running=0;
  abcSorted.forEach(r=>{const before=running/Math.max(totalDemandValue,1);r.abc=totalDemandValue===0?"N/A":before<0.8?"A":before<0.95?"B":"C";running+=r.demandValue;});
  const countRows=counts.filter(c=>!c.voided).map(c=>({...c,varianceValue:n(c.varianceValue),varianceQuantity:n(c.varianceQuantity)}));
  const variances=countRows.filter(c=>Math.abs(c.varianceQuantity)>1e-6&&c.status!=="RESOLVED").sort((a,b)=>Math.abs(b.varianceValue)-Math.abs(a.varianceValue));
  const totalVarianceValue=variances.reduce((s,c)=>s+Math.abs(c.varianceValue),0);
  const fuelRecent=fuel.filter(f=>dateOf(f)>=recentDate&&dateOf(f)<=asOf);
  const hoursRecent=shifts.filter(s=>dateOf(s)>=recentDate&&dateOf(s)<=asOf);
  const machineEfficiency=machines.map(m=>{
    const fs=fuelRecent.filter(f=>[m.id,m.assetName,m.machineName].includes(f.machineId)||f.machineName===m.assetName);
    const hs=hoursRecent.filter(s=>[m.id,m.assetName,m.machineName].includes(s.machineId)||s.machineName===m.assetName);
    const litres=fs.reduce((s,f)=>s+Math.max(0,n(f.litres??f.quantity)),0);
    const hours=hs.reduce((s,h)=>s+Math.max(0,n(h.engineHoursLogged)),0);
    const cost=fs.reduce((s,f)=>s+Math.max(0,n(f.litres??f.quantity))*Math.max(0,n(f.ratePerLitre??f.fuelRate??f.unitPrice)),0);
    return {id:m.id,name:m.assetName||m.machineName||"Unnamed machine",litres,hours,lph:hours>0?litres/hours:null,costPerHour:hours>0?cost/hours:null};
  }).filter(m=>m.hours>0&&m.litres>0).sort((a,b)=>(b.lph||0)-(a.lph||0));
  const turfRecent=plans.filter(p=>{const d=dateOf(p),status=String(p.status??p.turfStatus??p.applicationStatus??"").toLowerCase();const issued=n(p.issuedQty??p.issuedQuantity??p.issueQty??p.issueQuantity??p.quantityIssued??p.qtyIssued??p.quantityOut??p.qtyOut);return d>=recentDate&&d<=asOf&&(status==="issued"||status==="applied"||issued>0);});
  const turfSpend=turfRecent.reduce((s,p)=>{const item=items.find(i=>i.id===p.productId)||items.find(i=>(i.partName||"").toLowerCase()===(p.productName||"").toLowerCase());const status=String(p.status??p.turfStatus??p.applicationStatus??"").toLowerCase();const qty=n(p.issuedQty??p.issuedQuantity??p.issueQty??p.issueQuantity??p.quantityIssued??p.qtyIssued??p.quantityOut??p.qtyOut??(status==="issued"||status==="applied"?(p.quantity??p.qty??p.targetQty):0));return s+Math.max(0,qty)*Math.max(0,n(item?.unitCost));},0);
  const openWork=logs.filter(l=>(l.repairStatus||"Pending")!=="Resolved");
  const dueMaintenance=machines.filter(m=>n(m.currentHours)-n(m.lastServiceHours)>=250);
  const anomaly=robustAnomalies(movements,asOf);
  const insights=[];
  if(variances.length)insights.push({severity:"high",title:variances.length+" physical count variance(s)",detail:"Absolute recorded variance exposure: "+totalVarianceValue.toFixed(2)+". Investigate before adjusting official stock.",action:"Review physical counts and movement history"});
  const stockouts=rows.filter(r=>r.stockoutRisk);
  if(stockouts.length)insights.push({severity:"high",title:stockouts.length+" item(s) at stockout risk",detail:stockouts.slice(0,4).map(r=>r.name+" ("+Math.floor(r.daysCover)+" days cover)").join("; "),action:"Review replenishment and supplier lead time"});
  const unpriced=rows.filter(r=>r.unpriced);
  if(unpriced.length)insights.push({severity:"medium",title:unpriced.length+" stocked item(s) have unknown cost",detail:"Inventory value and savings estimates are incomplete until unit costs are reconciled.",action:"Complete unit-cost master data"});
  const low=rows.filter(r=>r.low);
  if(low.length)insights.push({severity:"medium",title:low.length+" item(s) below calculated reorder point",detail:"Reorder point combines observed daily issues, lead time and safety stock.",action:"Review suggested order quantities"});
  if(anomaly.anomalies.length)insights.push({severity:"medium",title:anomaly.anomalies.length+" unusual issue-volume day(s)",detail:anomaly.anomalies.slice(0,3).map(a=>a.date+": "+a.quantity).join("; "),action:"Check issue slips, events and data-entry errors"});
  if(!issueRows.length)insights.push({severity:"medium",title:"Consumption history is not yet sufficient",detail:"ABC/XYZ, EOQ and reorder estimates use posted ISSUE movements. Legacy fuel/turf records are not automatically treated as inventory issues.",action:"Reconcile opening balances and migrate approved usage records"});
  if(openWork.length)insights.push({severity:"medium",title:openWork.length+" unresolved operational issue(s)",detail:"Open logs remain unresolved in the current operational register.",action:"Review incident ownership and downtime"});
  return {
    asOf, summary:{skuCount:rows.length,stockValue:rows.filter(r=>!r.unpriced).reduce((s,r)=>s+r.value,0),
      unpricedCount:unpriced.length,lowStockCount:low.length,stockoutRiskCount:stockouts.length,
      totalIssuedValue:totalDemandValue,physicalCountCount:countRows.length,varianceCount:variances.length,varianceExposure:totalVarianceValue,
      unresolvedIssues:openWork.length,turfSpend,maintenanceDue:dueMaintenance.length},
    items:rows.sort((a,b)=>b.demandValue-a.demandValue),counts:countRows,variances,insights,machineEfficiency,
    anomalies:anomaly.anomalies,anomalyMethod:anomaly.method,abcMethod:"Annualized recorded issue value; A ≤80%, B ≤95%, C remainder of cumulative value.",
    xyzMethod:"Six monthly issue quantities; X CV ≤0.5, Y ≤1.0, Z >1.0. Fewer than three active months are marked insufficient.",
    limitations:["Consumption models use posted stock ISSUE movements only; legacy fuel and turf records are not automatically deducted.","EOQ, safety stock and reorder recommendations are scenario estimates using configurable lead time, order cost, holding rate and service factor.","Fuel cost per hour is only comparable when source fuel rates are recorded; unknown rates are excluded from cost calculations.","Historical physical-count book balances are estimates if movements after the count date are incomplete."]
  };
}
