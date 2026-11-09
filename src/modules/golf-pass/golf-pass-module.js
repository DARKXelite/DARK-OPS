export function createGolfPassModule({db,auth,RBAC,collection,doc,setDoc,onSnapshot,serverTimestamp,esc,today,toast,reissueGolfPassQr,printer}) {
  const root=()=>document.getElementById("golfPassRoot");
  const categories=["Member","Non-Member","Complimentary"];
  let tab="dashboard", rows=[], unsub=null, lastPass=null, qrCache=new Map(), ledgerView="table";
  let filters={search:"",from:"",to:"",category:"all",status:"all"};
  const canManage=()=>RBAC.can("golf.manage");
  const field=(label,id,type="text",extra="")=>'<label class="gp-field"><span>'+label+'</span><input id="'+id+'" type="'+type+'" '+extra+'></label>';
  const fmtDate=v=>String(v||"—");
  const dateRange=(p)=>{const d=p.playDate||"";return (!filters.from||d>=filters.from)&&(!filters.to||d<=filters.to);};
  const filtered=()=>rows.filter(p=>{
    const q=filters.search.toLowerCase();
    const hay=[p.passRef,p.golferName,p.phone,p.category,p.notes].join(" ").toLowerCase();
    return (!q||hay.includes(q))&&dateRange(p)&&(filters.category==="all"||p.category===filters.category)&&(filters.status==="all"||p.status===filters.status);
  }).sort((a,b)=>(b.playDate||"").localeCompare(a.playDate||"")||(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  function subscribe(){
    if(unsub||!canManage())return;
    unsub=onSnapshot(collection(db,"golf_passes"),snap=>{
      rows=snap.docs.map(d=>({id:d.id,...d.data()}));
      updateDashboard();
      if(tab==="ledger")renderLedger();
      if(tab==="dashboard")renderRecent();
    },err=>{const live=document.getElementById("gpLiveState");if(live)live.textContent="Live sync unavailable · "+err.message;});
  }
  function stop(){if(unsub){unsub();unsub=null;}}
  function render(){
    const el=root();if(!el)return;
    if(!canManage()){stop();el.innerHTML='<section class="gp-shell"><div class="gp-card"><h2>Golf Pass management</h2><p>Your account does not have manager access to the pass register.</p></div></section>';return;}
    subscribe();
    el.innerHTML='<section class="gp-shell"><header class="gp-header"><div><div class="gp-eyebrow">CLOVER GREENS · GUEST SERVICES</div><h2>Golf Pass Operations</h2><p>Pass issuance, live entry monitoring and historical reconciliation</p></div><div class="gp-header-actions"><span class="gp-live"><i></i><span id="gpLiveState">LIVE FIRESTORE SYNC</span></span><button class="gp-btn gp-primary" data-gp-action="new">＋ New pass</button></div></header><section id="gpDashboard"></section><nav class="gp-tabs"><button class="gp-tab '+(tab==="dashboard"?'active':'')+'" data-gp-tab="dashboard">Overview</button><button class="gp-tab '+(tab==="register"?'active':'')+'" data-gp-tab="register">Register pass</button><button class="gp-tab '+(tab==="ledger"?'active':'')+'" data-gp-tab="ledger">Pass ledger</button></nav><section id="gpPanel"></section></section>';
    updateDashboard();
    renderPanel();
  }
  function updateDashboard(){
    const host=document.getElementById("gpDashboard");if(!host)return;
    const date=today(),day=rows.filter(p=>p.playDate===date),checked=day.filter(p=>p.status==="checked_in").length,pending=day.filter(p=>p.status==="active").length;
    const categoriesHtml=categories.map(cat=>{
      const group=day.filter(p=>p.category===cat),used=group.filter(p=>p.status==="checked_in").length;
      return '<article class="gp-category"><div class="gp-category-top"><span>'+esc(cat)+'</span><b>'+group.length+'</b></div><div class="gp-meter"><i style="width:'+(group.length?Math.round(used/group.length*100):0)+'%"></i></div><div class="gp-category-meta"><span>'+used+' checked in</span><span>'+Math.max(0,group.length-used)+' pending</span></div></article>';
    }).join("");
    host.innerHTML='<div class="gp-kpis"><article class="gp-kpi"><span>Passes issued today</span><strong>'+day.length+'</strong><small>Play date '+esc(date)+'</small></article><article class="gp-kpi"><span>Checked in</span><strong class="gp-good">'+checked+'</strong><small>Confirmed field scans</small></article><article class="gp-kpi"><span>Awaiting entry</span><strong>'+pending+'</strong><small>Active passes for today</small></article><article class="gp-kpi"><span>All-time passes</span><strong>'+rows.length+'</strong><small>Complete register</small></article></div><section class="gp-card gp-category-wrap"><div class="gp-section-head"><div><h3>Today by member category</h3><p>Live counts update as field staff scan passes</p></div><span class="gp-live"><i></i>LIVE</span></div><div class="gp-categories">'+categoriesHtml+'</div></section>';
  }
  function renderPanel(){
    const panel=document.getElementById("gpPanel");if(!panel)return;
    if(tab==="dashboard")renderRecent();
    else if(tab==="register")panel.innerHTML=registerForm();
    else renderLedger();
  }
  function renderRecent(){
    const panel=document.getElementById("gpPanel");if(!panel)return;
    const recent=[...rows].sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0)).slice(0,8);
    panel.innerHTML='<section class="gp-card"><div class="gp-section-head"><div><h3>Recent pass activity</h3><p>Latest registrations and their current entry status</p></div><button class="gp-btn" data-gp-action="ledger">Open full ledger</button></div>'+activityTable(recent)+'</section>';
  }
  function registerForm(){return '<section class="gp-card"><div class="gp-section-head"><div><h3>Register a golfer</h3><p>Create a unique, single-entry pass with a secure QR token</p></div><span class="gp-tag">NEW ENTRY</span></div><form id="gpRegistration" class="gp-form">'+field("Golfer name","gpName","text",'required maxlength="100" autocomplete="name"')+field("Mobile / WhatsApp","gpPhone","tel",'required inputmode="tel" maxlength="16"')+'<label class="gp-field"><span>Member category</span><select id="gpCategory">'+categories.map(x=>'<option>'+x+'</option>').join("")+'</select></label>'+field("Play date","gpDate","date",'required value="'+today()+'"')+'<label class="gp-field gp-full"><span>Notes / reference (optional)</span><textarea id="gpNotes" rows="3" maxlength="500" placeholder="Booking reference, group details or operational notes"></textarea></label><div class="gp-full gp-form-actions"><button class="gp-btn gp-primary" type="submit">Create golf pass</button><span class="gp-muted">No payment is recorded in this module.</span></div></form><div id="gpCreated"></div></section>';}
  function randomToken(){const b=new Uint8Array(32);crypto.getRandomValues(b);return [...b].map(x=>x.toString(16).padStart(2,"0")).join("");}
  async function hash(s){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,"0")).join("");}
  async function create(e){
    e.preventDefault();if(!canManage())return;
    const name=document.getElementById("gpName").value.trim(),phone=document.getElementById("gpPhone").value.trim(),date=document.getElementById("gpDate").value,phoneDigits=phone.replace(/\D/g,"");
    if(!name||phoneDigits.length<10||phoneDigits.length>13||!/^\d{4}-\d{2}-\d{2}$/.test(date)){toast("Enter a golfer name, valid mobile number and play date.","err");return;}
    const token=randomToken(),tokenHash=await hash(token),passRef="GP-"+date.replaceAll("-","")+"-"+token.slice(0,6).toUpperCase();
    const payload={passRef,golferName:name,phone,category:document.getElementById("gpCategory").value,playDate:date,notes:document.getElementById("gpNotes").value.trim(),tokenHash,status:"active",createdAt:serverTimestamp(),createdBy:auth.currentUser.uid};
    await setDoc(doc(db,"golf_passes",tokenHash),payload);
    lastPass={...payload,id:tokenHash,qrToken:token};qrCache.set(passRef,token);showQr(lastPass);toast("Golf pass created.");
  }
  function qrNode(){return document.getElementById("gpQrCode");}
  function drawQr(token){const node=qrNode();if(!node)return;node.innerHTML="";if(window.QRCode)new QRCode(node,{text:token,width:220,height:220,colorDark:"#07100B",colorLight:"#FFFFFF",correctLevel:QRCode.CorrectLevel.M});}
  function showQr(p){
    const box=document.getElementById("gpCreated");if(!box)return;
    box.innerHTML='<div class="gp-qr-result"><div><span class="gp-tag">PASS CREATED</span><h4>'+esc(p.passRef)+'</h4><p>'+esc(p.golferName)+' · '+esc(p.category)+' · '+esc(p.playDate)+'</p></div><div id="gpQrCode" class="gp-qr-code"></div><div class="gp-actions"><button class="gp-btn" data-gp-action="download-created">Download QR</button><button class="gp-btn" data-gp-action="print-created">Print pass</button><button class="gp-btn" data-gp-action="whatsapp-created">Send WhatsApp</button></div><small>Private one-time QR. Reissuing it invalidates the previous QR.</small></div>';
    drawQr(p.qrToken);
  }
  function activityTable(list){return '<div class="gp-table-wrap"><table class="gp-table"><thead><tr><th>Pass reference</th><th>Golfer</th><th>Category</th><th>Play date</th><th>Entry status</th></tr></thead><tbody>'+(list.length?list.map(p=>'<tr><td><strong>'+esc(p.passRef)+'</strong></td><td>'+esc(p.golferName)+'</td><td>'+esc(p.category)+'</td><td>'+esc(p.playDate)+'</td><td>'+statusPill(p.status)+'</td></tr>').join(""):'<tr><td colspan="5" class="gp-empty">No pass records found.</td></tr>')+'</tbody></table></div>';}
  function statusPill(s){return '<span class="gp-status '+(s==="checked_in"?"checked":"pending")+'">'+(s==="checked_in"?"Checked in":s==="active"?"Awaiting entry":esc(s||"Unknown"))+'</span>';}
  function renderLedger(){
    const panel=document.getElementById("gpPanel");if(!panel)return;
    const list=filtered();
    panel.innerHTML='<section class="gp-card"><div class="gp-section-head"><div><h3>Pass ledger</h3><p>Search, filter, review and export current or historical entries</p></div><button class="gp-btn gp-primary" data-gp-action="export">↓ Download CSV</button></div><div class="gp-filters"><label class="gp-field gp-search"><span>Search records</span><input id="gpSearch" value="'+esc(filters.search)+'" placeholder="Pass ref, golfer, mobile or notes"></label><label class="gp-field"><span>From date</span><input id="gpFrom" type="date" value="'+esc(filters.from)+'"></label><label class="gp-field"><span>To date</span><input id="gpTo" type="date" value="'+esc(filters.to)+'"></label><label class="gp-field"><span>Category</span><select id="gpCategoryFilter">'+[['all','All categories'],...categories.map(x=>[x,x])].map(x=>'<option value="'+esc(x[0])+'" '+(filters.category===x[0]?'selected':'')+'>'+esc(x[1])+'</option>').join("")+'</select></label><label class="gp-field"><span>Status</span><select id="gpStatusFilter">'+[['all','All statuses'],['active','Awaiting entry'],['checked_in','Checked in']].map(x=>'<option value="'+x[0]+'" '+(filters.status===x[0]?'selected':'')+'>'+x[1]+'</option>').join("")+'</select></label><div class="gp-view-toggle"><button class="'+(ledgerView==="table"?"active":"")+'" data-gp-view="table">Table</button><button class="'+(ledgerView==="cards"?"active":"")+'" data-gp-view="cards">Cards</button></div></div><div class="gp-ledger-summary"><b>'+list.length+'</b> records shown <span>·</span> '+rows.length+' total records</div><div id="gpLedgerRows">'+(ledgerView==="table"?ledgerTable(list):ledgerCards(list))+'</div></section>';
  }
  function ledgerActions(p){return '<div class="gp-row-actions"><button class="gp-link" data-gp-action="view-qr" data-pass="'+esc(p.passRef)+'" '+(p.status!=="active"?'disabled':'')+'>View QR</button><button class="gp-link" data-gp-action="download-qr" data-pass="'+esc(p.passRef)+'" '+(p.status!=="active"?'disabled':'')+'>Download</button><button class="gp-link" data-gp-action="print" data-pass="'+esc(p.passRef)+'">Print</button><button class="gp-link" data-gp-action="whatsapp" data-pass="'+esc(p.passRef)+'">WhatsApp</button></div>';}
  function ledgerTable(list){return '<div class="gp-table-wrap"><table class="gp-table"><thead><tr><th>Pass</th><th>Golfer / Mobile</th><th>Category</th><th>Play date</th><th>Created</th><th>Status</th><th>Actions</th></tr></thead><tbody>'+(list.length?list.map(p=>'<tr><td><strong>'+esc(p.passRef)+'</strong></td><td>'+esc(p.golferName)+'<small>'+esc(p.phone)+'</small></td><td>'+esc(p.category)+'</td><td>'+esc(p.playDate)+'</td><td>'+esc(p.createdAt?.toDate?.().toLocaleString?.()||"—")+'</td><td>'+statusPill(p.status)+'</td><td>'+ledgerActions(p)+'</td></tr>').join(""):'<tr><td colspan="7" class="gp-empty">No records match these filters.</td></tr>')+'</tbody></table></div>';}
  function ledgerCards(list){return '<div class="gp-record-cards">'+(list.length?list.map(p=>'<article class="gp-record"><div class="gp-record-head"><b>'+esc(p.passRef)+'</b>'+statusPill(p.status)+'</div><h4>'+esc(p.golferName)+'</h4><p>'+esc(p.phone)+' · '+esc(p.category)+'</p><small>Play date: '+esc(p.playDate)+'</small>'+ledgerActions(p)+'</article>').join(""):'<div class="gp-empty">No records match these filters.</div>')+'</div>';}
  function csv(){
    const list=filtered(),cols=["passRef","golferName","phone","category","playDate","status","notes","createdBy","checkedInBy"];
    const quote=v=>'"'+String(v??"").replace(/"/g,'""')+'"';
    const lines=[cols.join(","),...list.map(p=>cols.map(k=>quote(p[k])).join(","))];
    const blob=new Blob(["\uFEFF"+lines.join("\r\n")],{type:"text/csv;charset=utf-8;"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="golf-pass-ledger-"+today()+".csv";a.click();URL.revokeObjectURL(url);
  }
  async function ensureQr(p){
    let token=qrCache.get(p.passRef);
    if(!token){
      if(p.status!=="active")throw new Error("This pass has already been checked in. Its one-time QR is no longer valid.");
      if(!reissueGolfPassQr)throw new Error("Secure QR reissue is unavailable.");
      let response;
      try {
        response=await reissueGolfPassQr({passRef:p.passRef});
      } catch(error) {
        const code=String(error?.code||"").replace(/^functions\//,"");
        const detail=error?.details?.message||error?.details;
        const message=error?.message&&error.message!=="internal"&&error.message!=="internal [0]"?error.message:
          code==="permission-denied"?"Your account is not authorized to reissue Golf Pass QR codes.":
          code==="unauthenticated"?"Your session has expired. Sign in again and retry.":
          code==="not-found"?"The Golf Pass QR service or pass record could not be found.":
          "The Golf Pass QR service failed. Refresh the page and retry.";
        throw new Error((detail&&typeof detail==="string"?detail:message)+(code?" ( "+code+" )":""));
      }
      token=response?.data?.qrToken;
      if(!token)throw new Error("The QR service responded without a token. Check that the latest Firebase function is deployed.");
      qrCache.set(p.passRef,token);
    }
    return token;
  }
  function imageData(token){
    if(!window.QRCode)throw new Error("QR generator is unavailable. Reload the page and retry.");
    const holder=document.createElement("div");
    holder.style.cssText="position:fixed;left:-10000px;top:0;background:#fff;padding:8px";
    document.body.appendChild(holder);
    try {
      new QRCode(holder,{text:token,width:260,height:260,colorDark:"#07100B",colorLight:"#FFFFFF",correctLevel:QRCode.CorrectLevel.M});
      const canvas=holder.querySelector("canvas"),img=holder.querySelector("img");
      const src=canvas?canvas.toDataURL("image/png"):img?.src;
      if(!src)throw new Error("QR image could not be generated. Reload the page and retry.");
      return src;
    } finally { holder.remove(); }
  }
  async function qrAction(p,mode){
    try{
      if(p.status!=="active"){if(mode==="print"){await printEntry(p,null);return;}throw new Error("This pass is already checked in. Its one-time QR has been consumed.");}
      const token=await ensureQr(p),src=imageData(token);
      if(mode==="view"){const panel=document.getElementById("gpPanel");let modal=document.getElementById("gpQrModal");if(!modal){modal=document.createElement("div");modal.id="gpQrModal";modal.className="gp-qr-modal";root().appendChild(modal);}modal.innerHTML='<div class="gp-qr-dialog"><button class="gp-modal-close" data-gp-action="close-qr">×</button><span class="gp-tag">ACTIVE ENTRY PASS</span><h3>'+esc(p.passRef)+'</h3><p>'+esc(p.golferName)+' · '+esc(p.playDate)+'</p><img src="'+src+'" alt="Golf pass QR"><div class="gp-actions"><button class="gp-btn" data-gp-action="download-qr" data-pass="'+esc(p.passRef)+'">Download PNG</button><button class="gp-btn gp-primary" data-gp-action="print" data-pass="'+esc(p.passRef)+'">Print pass</button></div><small>Reissuing invalidates the previously issued QR token.</small></div>';modal.hidden=false;}
      if(mode==="download"){const a=document.createElement("a");a.href=src;a.download=p.passRef+".png";a.click();}
      if(mode==="print")await printEntry(p,src);
      if(mode==="whatsapp") {
        const message="Hello "+p.golferName+",\n\nYour Clover Greens golf pass "+p.passRef+" is ready.\nCategory: "+p.category+"\nPlay date: "+p.playDate+"\n\nPlease present the attached QR at golf entry.";
        const result=await printer.shareQrOnWhatsApp(src,p.passRef+".png",p.phone,message);
        toast(result==="shared"?"QR image shared. Choose WhatsApp and send it.":"QR downloaded. Attach it in the WhatsApp chat that opened.","ok");
      }
    }catch(e){
      console.error("Golf Pass QR action failed", {mode,passRef:p?.passRef,code:e?.code,message:e?.message,details:e?.details});
      toast(e?.message||"Could not prepare Golf Pass QR. Refresh and retry.","err");
    }
  }
  async function printEntry(p,src){
    const qr=src?'<img class="qr" src="'+src+'">':'<div class="used">CHECKED IN · QR CONSUMED</div>';
    const body='<main><div class="brand">CLOVER GREENS</div><div class="sub">GOLF PASS · ENTRY TICKET</div><div class="ref">'+esc(p.passRef)+'</div>'+qr+'<h2>'+esc(p.golferName)+'</h2><p>'+esc(p.category)+' · '+esc(p.playDate)+'</p><p>'+esc(p.phone)+'</p><div class="foot">'+(src?"Present this QR at the golf entry":"Entry recorded. This is an audit copy, not a valid entry QR.")+'</div></main>';
    const html='<!doctype html><html><head><meta charset="utf-8"><title>'+esc(p.passRef)+'</title><style>@page{size:80mm auto;margin:3mm}*{box-sizing:border-box}html,body{width:74mm;margin:0;padding:0;font:10pt Arial;color:#111;text-align:center}.brand{font-weight:900;font-size:16pt}.sub{font-size:9pt;letter-spacing:1px;margin:2mm}.ref{font-weight:800;border-block:1px dashed #777;padding:3mm}.qr{display:block;width:43mm;height:43mm;object-fit:contain;margin:3mm auto}.used{padding:8mm;margin:5mm 0;background:#eee;font-weight:800}h2{font-size:13pt;margin:3mm 0 1mm}.foot{border-top:1px dashed #777;margin-top:4mm;padding-top:3mm;font-size:8pt}</style></head><body>'+body+'</body></html>';
    await printer.printHtml(html,"Golf pass "+p.passRef);
  }
  function passByRef(ref){return rows.find(p=>p.passRef===ref);}
  function click(e){
    const t=e.target.closest("[data-gp-tab],[data-gp-action],[data-gp-view]");if(!t)return;
    if(t.dataset.gpTab){tab=t.dataset.gpTab;render();return;}
    if(t.dataset.gpView){ledgerView=t.dataset.gpView;renderLedger();return;}
    const action=t.dataset.gpAction;
    if(action==="new"||action==="ledger"){tab=action==="new"?"register":"ledger";render();return;}
    if(action==="close-qr"){document.getElementById("gpQrModal")?.remove();return;}
    if(action==="export"){csv();return;}
    if(action==="download-created"&&lastPass){qrAction(lastPass,"download");return;}
    if(action==="print-created"&&lastPass){qrAction(lastPass,"print");return;}
    if(action==="whatsapp-created"&&lastPass){qrAction(lastPass,"whatsapp");return;}
    const p=passByRef(t.dataset.pass);if(!p)return;
    if(action==="view-qr")qrAction(p,"view");
    if(action==="download-qr")qrAction(p,"download");
    if(action==="print")qrAction(p,"print");
    if(action==="whatsapp")qrAction(p,"whatsapp");
  }
  function submit(e){if(e.target?.id==="gpRegistration")create(e).catch(err=>toast("Could not create pass: "+err.message,"err"));}
  function change(e){
    const id=e.target?.id;
    if(id==="gpSearch")filters.search=e.target.value;
    else if(id==="gpFrom")filters.from=e.target.value;
    else if(id==="gpTo")filters.to=e.target.value;
    else if(id==="gpCategoryFilter")filters.category=e.target.value;
    else if(id==="gpStatusFilter")filters.status=e.target.value;
    else return;
    const pos=id==="gpSearch"?e.target.selectionStart:null;renderLedger();if(id==="gpSearch"){const next=document.getElementById("gpSearch");next?.focus();if(pos!==null)next?.setSelectionRange(pos,pos);}
  }
  const el=root();el?.addEventListener("click",click);el?.addEventListener("submit",submit);el?.addEventListener("change",change);el?.addEventListener("input",e=>{if(e.target?.id==="gpSearch"){filters.search=e.target.value;const pos=e.target.selectionStart;renderLedger();const next=document.getElementById("gpSearch");next?.focus();next?.setSelectionRange(pos,pos);}});
  return {render,stop};
}
