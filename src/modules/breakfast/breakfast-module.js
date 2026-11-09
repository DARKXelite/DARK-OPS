export function createBreakfastModule(deps) {
  const {
    db, auth, RBAC, collection, doc, getDocs, writeBatch, runTransaction,
    query, where, orderBy, serverTimestamp, Timestamp, esc, today, addDays, toast, printer
  } = deps;
  let bookings = [];
  let todayEntitlements = [];
  let redemptionRows = [];
  let scanner = null;
  let scannerBusy = false;
  let couponRows = [];
  let lastResult = null;
  let loading = false;

  const root = () => document.getElementById("breakfastRoot");
  const canManage = () => RBAC.can("breakfast.manage");
  const canRedeem = () => RBAC.can("breakfast.redeem");
  const dateStart = date => Timestamp.fromDate(new Date(date + "T00:00:00+05:30"));
  const dateEnd = date => Timestamp.fromDate(new Date(addDays(date, 1) + "T00:00:00+05:30"));
  const randomToken = () => {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  };
  async function hashToken(token) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    return [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, "0")).join("");
  }
  function breakfastDates(checkInAt, checkOutAt) {
    const dates=[], first=checkInAt.slice(0,10), last=checkOutAt.slice(0,10);
    for(let date=first,n=0;date<=last&&n<32;date=addDays(date,1),n++) if(checkInAt<=date+"T10:00"&&checkOutAt>date+"T07:00") dates.push(date);
    return dates;
  }
  function shell(scannerOnly = false) {
    const el = root();
    if (!el) return;
    const manager = canManage() && !scannerOnly;
    el.innerHTML =
      '<div class="bf-page">' +
        '<header class="bf-header"><div><div class="bf-eyebrow">GUEST SERVICES · DIGITAL ENTITLEMENTS</div><h2>Breakfast Pass</h2><p>One QR per room booking · one redemption per guest per eligible day.</p></div><div class="bf-header-mark"><span class="material-symbols-rounded">qr_code_2</span><span>7 AM – 10 AM</span></div></header>' +
        '<section class="bf-kpis" aria-label="Today breakfast summary">' +
          '<article class="bf-kpi"><span>EXPECTED TODAY</span><strong id="bfExpected">—</strong><small>Eligible guests</small></article>' +
          '<article class="bf-kpi"><span>REDEEMED</span><strong id="bfRedeemed">—</strong><small>Guests checked in</small></article>' +
          '<article class="bf-kpi"><span>REMAINING</span><strong id="bfRemaining">—</strong><small>Guests remaining</small></article>' +
        '</section>' +
        '<div class="bf-workspace">' +
          (manager ? '<section class="bf-panel bf-booking-panel"><div class="bf-panel-head"><div><span class="bf-step">01 / RECEPTION</span><h3>Add guest booking</h3><p>Enter the room booking, guest count and one WhatsApp contact.</p></div><span class="material-symbols-rounded">hotel</span></div>' +
            '<form id="bfBookingForm" class="bf-form" novalidate>' +
              '<label>Lead guest name<input id="bfGuestName" name="guestName" required maxlength="100" placeholder="Guest full name" autocomplete="name"></label>' +
              '<div class="bf-form-row"><label>Room number<input id="bfRoom" name="roomNumber" required maxlength="20" placeholder="e.g. 204"></label><label>Guest count<input id="bfGuestCount" name="guestCount" type="number" min="1" max="12" step="1" value="2" required inputmode="numeric"></label></div>' +
              '<label>Booking WhatsApp number<input id="bfPhone" name="guestPhone" type="tel" maxlength="18" required placeholder="+91 98765 43210" autocomplete="tel"></label>' +
              '<div class="bf-form-row"><label>Check-in date<input id="bfCheckIn" name="checkInAt" type="datetime-local" required></label><label>Checkout date<input id="bfCheckOut" name="checkOutAt" type="datetime-local" required></label></div>' +
              '<div class="bf-date-preview" id="bfDatePreview">Enter stay date/time to preview breakfast eligibility.</div>' +
              '<button class="bf-primary" type="submit" id="bfCreateButton"><span class="material-symbols-rounded">confirmation_number</span>Generate room QR pass</button>' +
              '<p class="bf-form-note">One QR covers every guest in this room. Send the room QR image manually through WhatsApp.</p>' +
            '</form></section>' : '') +
          '<section class="bf-panel bf-scanner-panel"><div class="bf-panel-head"><div><span class="bf-step">02 / RESTAURANT</span><h3>Redeem breakfast</h3><p>Scan the same room QR once for each guest in the booking.</p></div><span class="material-symbols-rounded">qr_code_scanner</span></div>' +
            '<div class="bf-scanner-frame"><div id="breakfastQrReader" class="bf-reader"></div><div class="bf-scanner-placeholder" id="bfScannerPlaceholder"><span class="material-symbols-rounded">photo_camera</span><b>Camera scanner ready</b><small>Use the rear camera on a phone or tablet.</small></div></div>' +
            '<div class="bf-scan-actions"><button class="bf-primary" id="bfStartScanner" type="button" ' + (!canRedeem() ? 'disabled' : '') + '><span class="material-symbols-rounded">photo_camera</span>Start camera</button><button class="bf-secondary" id="bfStopScanner" type="button" disabled><span class="material-symbols-rounded">stop_circle</span>Stop</button></div>' +
            '<div class="bf-manual-scan"><label for="bfManualToken">Manual token entry</label><div><input id="bfManualToken" autocomplete="off" placeholder="Paste pass token"><button class="bf-secondary" id="bfRedeemManual" type="button" ' + (!canRedeem() ? 'disabled' : '') + '>Verify</button></div></div>' +
            '<div id="bfScanResult" class="bf-scan-result" aria-live="polite">' + (canRedeem() ? 'Ready to validate a breakfast pass.' : 'Your role does not have redemption access.') + '</div>' +
            '<p class="bf-form-note">Scan the room QR once for each guest. The same QR can be scanned up to the room guest count per eligible date, including after 10 AM.</p>' +
          '</section>' +
        '</div>' +
        (manager ? '<section class="bf-panel bf-bookings-panel"><div class="bf-panel-head bf-bookings-head"><div><span class="bf-step">03 / RECEPTION RECORDS</span><h3>Guest bookings</h3><p>One shared room QR, one booking WhatsApp number, and daily guest redemption counts.</p></div><button class="bf-secondary" id="bfRefresh" type="button"><span class="material-symbols-rounded">refresh</span>Refresh</button></div><div class="bf-date-filter"><label for="bfGuestDate">Breakfast date</label><input id="bfGuestDate" type="date" value="' + today() + '"><span id="bfGuestCountLabel"></span></div><div id="bfBookingsList" class="bf-bookings-list"><div class="bf-empty">Loading room guest list…</div></div></section>' : '') +
        '<section class="bf-panel bf-coupons-panel" id="bfCouponsPanel" hidden><div class="bf-panel-head bf-bookings-head"><div><span class="bf-step">GENERATED PASSES</span><h3 id="bfCouponsTitle">Room QR pass</h3><p>The same room QR works for every guest on every eligible breakfast date.</p></div><button class="bf-secondary" id="bfCloseCoupons" type="button">Close</button></div><div id="bfCouponGrid" class="bf-coupon-grid"></div></section>' +
        '<div class="bf-footer-note"><span class="material-symbols-rounded">verified_user</span> Secure single-use passes · Staff access controlled · Redemption history retained</div>' +
      '</div>';
    bind();
    updateDatePreview();
  }
  function setResult(type, title, detail) {
    const el = document.getElementById("bfScanResult");
    if (!el) return;
    el.className = "bf-scan-result " + type;
    el.innerHTML = '<strong>' + esc(title) + '</strong><span>' + esc(detail || "") + '</span>';
  }
  function updateDatePreview() {
    const checkIn = document.getElementById("bfCheckIn")?.value;
    const checkOut = document.getElementById("bfCheckOut")?.value;
    const guests = Math.max(1, Math.min(12, Number(document.getElementById("bfGuestCount")?.value || 1)));
    
    const target = document.getElementById("bfDatePreview");
    if (!target) return;
    if (!checkIn || !checkOut || checkOut <= checkIn) { target.textContent="Choose valid check-in and checkout date/times."; return; }
    const dates=breakfastDates(checkIn,checkOut);
    target.innerHTML='<b>One room QR for '+guests+' guest(s)</b><span>'+dates.length+' eligible breakfast date(s)</span><small>'+(dates.length?esc(dates[0])+' to '+esc(dates[dates.length-1]):'No 7–10 AM service window overlaps this stay')+'</small>';
  }
  async function loadData() {
    if (!canManage()) return;
    if (loading) return;
    loading = true;
    try {
      const results = await Promise.all([
        getDocs(query(collection(db, "breakfast_bookings"), orderBy("createdAt", "desc"))),
        getDocs(collection(db, "breakfast_entitlements")),
        getDocs(collection(db, "breakfast_redemptions"))
      ]);
      bookings = results[0].docs.map(s => ({ id: s.id, ...s.data() }));
      redemptionRows=results[2].docs.map(s=>({id:s.id,...s.data()}));
      const todayRows=redemptionRows.filter(x=>x.validDate===today());
      todayEntitlements = results[1].docs.map(s => ({ id: s.id, ...s.data(), todayRedeemedCount:Number(todayRows.find(r=>r.passId===s.id)?.redeemedCount||0) }));
      renderStats();
      renderBookings();
    } catch (error) {
      console.error("Breakfast data load failed", error);
      toast("Could not load breakfast records: " + (error.code || error.message), "err");
    } finally { loading = false; }
  }
  function renderStats() {
    const eligible=todayEntitlements.filter(x=>x.status==="active"&&(x.breakfastDates||[]).includes(today()));
    const expected=eligible.reduce((n,x)=>n+Number(x.guestCount||1),0);
    const redeemed=eligible.reduce((n,x)=>n+Number(x.todayRedeemedCount||0),0);
    const remaining=Math.max(0,expected-redeemed);
    const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = String(value); };
    set("bfExpected", expected);
    set("bfRedeemed", redeemed);
    set("bfRemaining", remaining);
  }
  function renderBookings() {
    const el=document.getElementById("bfBookingsList");if(!el)return;
    const date=document.getElementById("bfGuestDate")?.value||today();
    const rows=bookings.filter(b=>(b.breakfastDates||[]).includes(date)).map(b=>{
      const p=todayEntitlements.find(x=>x.bookingId===b.id);
      const r=p?redemptionRows.find(x=>x.passId===p.id&&x.validDate===date):null;
      return p?{b,p,done:Number(r?.redeemedCount||0),total:Number(b.guestCount||p.guestCount||1)}:null;
    }).filter(Boolean);
    const label=document.getElementById("bfGuestCountLabel");if(label)label.textContent=rows.reduce((n,x)=>n+x.total,0)+" eligible guest(s) · "+rows.length+" room(s)";
    if(!rows.length){el.innerHTML='<div class="bf-empty">No eligible room guests for '+esc(date)+'.</div>';return;}
    el.innerHTML=rows.map(({b,p,done,total})=>'<article class="bf-booking-row bf-room-guest"><div class="bf-booking-main"><b>Room '+esc(b.roomNumber)+' · '+esc(b.guestName)+'</b><span>'+total+' guest(s) · '+done+'/'+total+' redeemed</span><small>'+esc(b.checkInAt||b.checkIn)+' → '+esc(b.checkOutAt||b.checkOut)+' · '+esc(b.guestPhone||"No WhatsApp number")+'</small></div><span class="bf-booking-status">'+(done>=total?'COMPLETE':done?'PARTIAL':'PENDING')+'</span><button class="bf-secondary" type="button" data-bf-act="view-room" data-id="'+esc(p.id)+'">View room QR</button><button class="bf-primary" type="button" data-bf-act="whatsapp-room" data-id="'+esc(p.id)+'">Send WhatsApp</button></article>').join("");
  }
  async function renderCoupons(rows, title) {
    couponRows = rows;
    const panel = document.getElementById("bfCouponsPanel");
    const grid = document.getElementById("bfCouponGrid");
    if (!panel || !grid) return;
    document.getElementById("bfCouponsTitle").textContent = title || "Guest coupons";
    panel.hidden = false;
    grid.innerHTML = rows.map((c, i) =>
      '<article class="bf-coupon-card"><div class="bf-coupon-top"><b>Room ' + esc(c.roomNumber) + ' · ' + esc(c.guestCount) + ' guests</b><span class="bf-coupon-status active">ROOM QR</span></div><div class="bf-qr-wrap"><div class="bf-qr-target" data-bf-qr="' + i + '"></div></div><strong>' + esc((c.breakfastDates || []).length) + ' eligible breakfast date(s)</strong><small>' + esc(c.guestName) + ' · ' + esc(c.bookingRef) + '</small><small>7:00–10:00 AM · one scan per guest</small><button class="bf-primary" type="button" data-bf-act="print-coupon" data-index="' + i + '"><span class="material-symbols-rounded">print</span>Print pass</button><button class="bf-secondary" type="button" data-bf-act="whatsapp-coupon" data-index="' + i + '"><span class="material-symbols-rounded">chat</span>Send WhatsApp</button><button class="bf-secondary" type="button" data-bf-act="share-coupon" data-index="' + i + '"><span class="material-symbols-rounded">download</span>Download QR</button></article>'
    ).join("");
    rows.forEach((pass,i)=>{
      const target=grid.querySelector('[data-bf-qr="'+i+'"]');
      if(!target||typeof window.QRCode!=="function"){if(target)target.textContent="QR library unavailable. Reload while online.";return;}
      try{new window.QRCode(target,{text:pass.qrToken,width:220,height:220,colorDark:"#07100B",colorLight:"#FFFFFF",correctLevel:window.QRCode.CorrectLevel.M});}
      catch(error){console.error("QR render failed",error);target.textContent="QR could not be rendered.";}
    });
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function receiptEscape(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  }
  async function printBreakfastPass(pass) {
    if (!pass?.qrToken) throw new Error("The saved pass QR token is unavailable.");
    if (typeof window.QRCode !== "function") throw new Error("QR generator is unavailable. Reload DARK OPS and use Reprint.");
    const qrHost = document.createElement("div");
    new window.QRCode(qrHost, { text: pass.qrToken, width: 420, height: 420, colorDark: "#000000", colorLight: "#FFFFFF", correctLevel: window.QRCode.CorrectLevel.H });
    const qrCanvas = qrHost.querySelector("canvas");
    const qrImage = qrHost.querySelector("img");
    const qrData = qrCanvas?.toDataURL("image/png") || qrImage?.src;
    if (!qrData) throw new Error("Could not render the pass QR code.");
    const dates = (pass.breakfastDates || []).join(", ");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Breakfast Pass ${receiptEscape(pass.roomNumber)}</title>
      <style>
        @page { size: 80mm auto; margin: 3mm; }
        * { box-sizing: border-box; }
        html, body { width: 74mm; margin: 0; padding: 0; color: #000; background: #fff; font-family: Arial, sans-serif; }
        body { font-size: 10pt; line-height: 1.3; }
        .receipt { width: 74mm; padding: 0; text-align: center; }
        .brand { font-size: 16pt; font-weight: 900; letter-spacing: .5px; }
        .subtitle { margin-top: 1mm; font-size: 10pt; font-weight: 800; letter-spacing: 1px; }
        .rule { border-top: 1px dashed #000; margin: 3mm 0; }
        .qr { display: block; width: 43mm; height: 43mm; margin: 2mm auto; image-rendering: pixelated; }
        .room { font-size: 19pt; font-weight: 900; margin: 1mm 0; }
        .details { text-align: left; font-size: 10pt; }
        .details div { margin: 1.2mm 0; overflow-wrap: anywhere; }
        .instruction { font-size: 8pt; font-weight: 800; margin-top: 2mm; }
        .foot { font-size: 7.5pt; margin-top: 2mm; }
      </style></head><body><main class="receipt">
        <div class="brand">CLOVER GREENS</div><div class="subtitle">BREAKFAST PASS</div><div class="rule"></div>
        <img class="qr" src="${qrData}" alt="Breakfast entitlement QR">
        <div class="room">ROOM ${receiptEscape(pass.roomNumber)}</div>
        <div class="details">
          <div><b>Lead guest:</b> ${receiptEscape(pass.guestName)}</div>
          <div><b>Guests:</b> ${receiptEscape(pass.guestCount)}</div>
          <div><b>Booking:</b> ${receiptEscape(pass.bookingRef)}</div>
          <div><b>Valid dates:</b> ${receiptEscape(dates)}</div>
          <div><b>Breakfast:</b> 7:00 AM – 10:00 AM</div>
        </div><div class="rule"></div>
        <div class="instruction">SCAN ONCE PER GUEST PER ELIGIBLE DAY</div>
        <div class="foot">Present this same pass at breakfast reception.</div>
      </main></body></html>`;
    await printer.printHtml(html, "Breakfast pass " + pass.roomNumber);
    toast("Breakfast pass sent to the browser printer.", "ok");
  }
  async function createBooking(event) {
    event.preventDefault();
    if (!canManage()) { toast("Booking creation is restricted to managers.", "err"); return; }
    const guestName = document.getElementById("bfGuestName").value.trim();
    const roomNumber = document.getElementById("bfRoom").value.trim();
    const guestPhone = document.getElementById("bfPhone").value.trim();
    const guestCount = Number(document.getElementById("bfGuestCount").value);
    const checkInAt=document.getElementById("bfCheckIn").value;
    const checkOutAt=document.getElementById("bfCheckOut").value;
    if(!guestName||!roomNumber||!checkInAt||!checkOutAt||!Number.isInteger(guestCount)||guestCount<1||guestCount>12||checkOutAt<=checkInAt){toast("Check guest name, room, guest count and date/time values.","err");return;}
    if (!guestPhone || !/^\+?[0-9\s()-]{8,18}$/.test(guestPhone)) { toast("Enter the booking WhatsApp number.", "err"); return; }
    const dates=breakfastDates(checkInAt,checkOutAt);
    if(!dates.length||dates.length>31){toast("No 7–10 AM breakfast window overlaps this stay, or stay exceeds 31 days.","err");return;}
    const button = document.getElementById("bfCreateButton");
    button.disabled = true;
    button.innerHTML = '<span class="material-symbols-rounded">hourglass_top</span>Generating room QR…';
    try {
      const bookingRef = "CG-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
      const bookingDoc = doc(collection(db, "breakfast_bookings"));
      const batch = writeBatch(db);
      let pass = null;
      const nowUid = RBAC.session.uid;
      batch.set(bookingDoc, {
        bookingRef, guestName, roomNumber, guestPhone, guestCount, checkIn:checkInAt.slice(0,10), checkOut:checkOutAt.slice(0,10),
        checkInAt, checkOutAt, serviceWindowStart:"07:00", serviceWindowEnd:"10:00", breakfastDates:dates, couponCount:1,
        status: "active", createdAt: serverTimestamp(), createdBy: nowUid
      });
      const token=randomToken(),tokenHash=await hashToken(token),entitlementRef=doc(db,"breakfast_entitlements",tokenHash);
      pass={id:tokenHash,bookingId:bookingDoc.id,bookingRef,guestName,roomNumber,guestPhone,guestCount,checkInAt,checkOutAt,breakfastDates:dates,serviceWindowStart:"07:00",serviceWindowEnd:"10:00",status:"active",qrToken:token,createdAt:serverTimestamp(),createdBy:nowUid};
      batch.set(entitlementRef,pass);
      await batch.commit();
      toast("Room breakfast QR generated · " + guestCount + " guest entitlements");
      document.getElementById("bfBookingForm").reset();
      document.getElementById("bfGuestCount").value = "2";
      updateDatePreview();
      await loadData();
      await renderCoupons([pass], "Room QR · " + bookingRef);
      try { await printBreakfastPass(pass); }
      catch (printError) { console.error("Breakfast pass print failed", printError); toast("Pass saved, but printing failed: " + (printError.message || "Check printer and use Reprint."), "err"); }
    } catch (error) {
      console.error("Breakfast booking creation failed", error);
      toast("Could not create breakfast passes: " + (error.code || error.message), "err");
    } finally {
      button.disabled = false;
      button.innerHTML = '<span class="material-symbols-rounded">confirmation_number</span>Generate room QR pass';
    }
  }
  async function viewBookingCoupons(id) {
    if (!canManage()) return;
    try {
      const rows=todayEntitlements.filter(p=>p.bookingId===id);
      if (!rows.length) { toast("No room QR found for this booking.", "err"); return; }
      await renderCoupons(rows, "Room QR · " + rows[0].bookingRef);
    } catch (error) {
      toast("Could not load coupons: " + (error.code || error.message), "err");
    }
  }
  function shareCoupon(index) {
    const pass=couponRows[index];
    if(!pass)return;
    const box=document.querySelector('[data-bf-qr="' + index + '"]');
    const canvas=box?.querySelector("canvas");
    const image=box?.querySelector("img");
    const url=canvas?canvas.toDataURL("image/png"):image?.src;
    if(!url){toast("QR image is not ready yet. Try again.","err");return;}
    const a=document.createElement("a");
    a.href=url;
    a.download="breakfast-room-"+pass.roomNumber+".png";
    a.click();
  }
  async function sendRoomWhatsApp(pass) {
    try {
      if(!pass?.qrToken) throw new Error("The saved room QR token is unavailable.");
      const host=document.createElement("div");
      new window.QRCode(host,{text:pass.qrToken,width:420,height:420,colorDark:"#000000",colorLight:"#FFFFFF",correctLevel:window.QRCode.CorrectLevel.H});
      const src=host.querySelector("canvas")?.toDataURL("image/png")||host.querySelector("img")?.src;
      const valid=(pass.breakfastDates||[]).join(", ");
      const message="Hello "+pass.guestName+",\\n\\nYour Clover Greens breakfast pass for Room "+pass.roomNumber+" is ready.\\nGuests: "+pass.guestCount+"\\nValid breakfast dates: "+valid+"\\nBreakfast service: 7:00 AM–10:00 AM.\\n\\nPlease show the attached QR once for each guest. Each guest can redeem once per eligible date.";
      const result=await printer.shareQrOnWhatsApp(src,"breakfast-room-"+pass.roomNumber+".png",pass.guestPhone,message);
      toast(result==="shared"?"QR image shared. Choose WhatsApp and send it.":"QR downloaded. Attach it in the WhatsApp chat that opened.","ok");
    } catch(error) { toast(error.message||"Could not share breakfast QR.","err"); }
  }
  async function startScanner() {
    if (!canRedeem() || scannerBusy) return;
    const placeholder = document.getElementById("bfScannerPlaceholder");
    const start = document.getElementById("bfStartScanner");
    const stop = document.getElementById("bfStopScanner");
    if (!window.Html5Qrcode) {
      setResult("error", "Scanner library unavailable", "Use manual token entry or reload the app when online.");
      return;
    }
    try {
      scannerBusy = true;
      start.disabled = true;
      scanner = new window.Html5Qrcode("breakfastQrReader", { verbose: false });
      await scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 240, height: 240 }, aspectRatio: 1 }, async decoded => {
        if (!scannerBusy) return;
        scannerBusy = false;
        await stopScanner();
        await redeemToken(decoded);
      }, () => {});
      if (placeholder) placeholder.hidden = true;
      stop.disabled = false;
      setResult("ready", "Camera active", "Point the camera at one breakfast QR code.");
    } catch (error) {
      scannerBusy = false;
      start.disabled = false;
      setResult("error", "Camera could not start", error.message || "Check browser camera permission and HTTPS access.");
    }
  }
  async function stopScanner() {
    scannerBusy = false;
    try {
      if (scanner) {
        if (scanner.isScanning) await scanner.stop();
        await scanner.clear();
      }
    } catch (error) { console.warn("Scanner stop issue", error); }
    scanner = null;
    const start = document.getElementById("bfStartScanner");
    const stop = document.getElementById("bfStopScanner");
    const placeholder = document.getElementById("bfScannerPlaceholder");
    if (start) start.disabled = !canRedeem();
    if (stop) stop.disabled = true;
    if (placeholder) placeholder.hidden = false;
  }
  async function redeemToken(rawToken) {
    if (!canRedeem()) { setResult("error", "Access denied", "Your role cannot redeem breakfast passes."); return; }
    const token = String(rawToken || "").trim().replace(/^DARKOPS-BREAKFAST:/i, "");
    if (!token || token.length < 30) { setResult("error", "Invalid QR", "The scanned value is not a DARKOPS breakfast pass."); return; }
    setResult("working", "Checking pass…", "Validating date and redemption status.");
    try {
      const tokenHash = await hashToken(token);
      const entitlementRef = doc(db, "breakfast_entitlements", tokenHash);
      const outcome = await runTransaction(db, async transaction => {
        const snap = await transaction.get(entitlementRef);
        if (!snap.exists()) throw new Error("This pass does not exist or the QR is invalid.");
        const data = snap.data();
        if (data.status !== "active") throw new Error("This guest pass is inactive.");
        if (!(data.breakfastDates || []).includes(today())) throw new Error("This guest is not eligible today. Eligible dates: " + (data.breakfastDates || []).join(", "));
        const redemptionId = tokenHash + "_" + today();
        const redemptionRef = doc(db, "breakfast_redemptions", redemptionId);
        const prior = await transaction.get(redemptionRef);
        const alreadyRedeemed=prior.exists()?Number(prior.data().redeemedCount||0):0;
        const guestLimit=Number(data.guestCount||1);
        if(alreadyRedeemed>=guestLimit) throw new Error("ROOM_FULL|" + alreadyRedeemed + "|" + guestLimit);
        const nextCount=alreadyRedeemed+1;
        const redemptionData={
          passId:tokenHash, bookingId:data.bookingId, bookingRef:data.bookingRef,
          roomNumber:data.roomNumber, guestName:data.guestName, guestCount:guestLimit,
          redeemedCount:nextCount, validDate:today(), serviceWindowStart:"07:00", serviceWindowEnd:"10:00",
          redeemedAt:prior.exists()?prior.data().redeemedAt:serverTimestamp(),
          redeemedBy:prior.exists()?prior.data().redeemedBy:RBAC.session.uid,
          lastRedeemedAt:serverTimestamp(), lastRedeemedBy:RBAC.session.uid
        };
        if(prior.exists()) transaction.update(redemptionRef,redemptionData);
        else transaction.set(redemptionRef,redemptionData);
        return {...data,todayRedeemedCount:nextCount};
      });
      lastResult = outcome;
      setResult("success", "BREAKFAST ACCEPTED", "Room " + outcome.roomNumber + " · " + outcome.todayRedeemedCount + "/" + outcome.guestCount + " guests redeemed today · " + today() + ". Scan again for the next guest.");
      const input = document.getElementById("bfManualToken");
      if (input) input.value = "";
      if (canManage()) await loadData();
    } catch (error) {
      console.error("Breakfast redemption failed", error);
      const message = error.message || "Could not validate this pass.";
      if (message.startsWith("ROOM_FULL|")) setResult("duplicate", "ROOM GUEST LIMIT REACHED", "All " + message.split("|")[2] + " guests in this room have already redeemed breakfast today. This same QR works again on the next eligible date.");
      else setResult("error", "REDEMPTION REJECTED", message);
    }
  }
  function bind() {
    const form = document.getElementById("bfBookingForm");
    form?.addEventListener("submit", createBooking);
    ["bfCheckIn", "bfCheckOut", "bfGuestCount"].forEach(id => document.getElementById(id)?.addEventListener("change", updateDatePreview));
    document.getElementById("bfStartScanner")?.addEventListener("click", startScanner);
    document.getElementById("bfStopScanner")?.addEventListener("click", stopScanner);
    document.getElementById("bfRedeemManual")?.addEventListener("click", () => redeemToken(document.getElementById("bfManualToken")?.value));
    document.getElementById("bfManualToken")?.addEventListener("keydown", e => { if (e.key === "Enter") redeemToken(e.currentTarget.value); });
    document.getElementById("bfRefresh")?.addEventListener("click", loadData);
    document.getElementById("bfGuestDate")?.addEventListener("change", renderBookings);
    document.getElementById("bfCloseCoupons")?.addEventListener("click", () => { const panel = document.getElementById("bfCouponsPanel"); if (panel) panel.hidden = true; });
    root()?.addEventListener("click", event => {
      const button = event.target.closest("[data-bf-act]");
      if (!button) return;
      if (button.dataset.bfAct === "view-coupons") viewBookingCoupons(button.dataset.id);
      if (button.dataset.bfAct === "view-room" || button.dataset.bfAct === "whatsapp-room") { const p=todayEntitlements.find(x=>x.id===button.dataset.id); if(p){renderCoupons([p],"Room "+p.roomNumber+" · "+p.guestCount+" guests");if(button.dataset.bfAct==="whatsapp-room")sendRoomWhatsApp(p);} }
      if (button.dataset.bfAct === "share-coupon") shareCoupon(Number(button.dataset.index));
      if (button.dataset.bfAct === "print-coupon") { const pass=couponRows[Number(button.dataset.index)]; if(pass) printBreakfastPass(pass).catch(error=>toast("Print failed: "+(error.message||"Check printer."),"err")); }
      if (button.dataset.bfAct === "whatsapp-coupon") sendRoomWhatsApp(couponRows[Number(button.dataset.index)]);
    });
  }
  function mountLayout(scannerOnly) {
    const oldRoot = root();
    if (!oldRoot) return;
    const freshRoot = oldRoot.cloneNode(false);
    oldRoot.replaceWith(freshRoot);
    shell(scannerOnly);
    freshRoot.dataset.initialized = "true";
    freshRoot.dataset.layout = scannerOnly ? "scanner" : "full";
  }
  function render() {
    if (!root()) return;
    if (!root().dataset.initialized || root().dataset.layout !== "full") mountLayout(false);
    if (canManage()) loadData();
    else {
      document.getElementById("bfExpected").textContent = "—";
      document.getElementById("bfRedeemed").textContent = "—";
      document.getElementById("bfRemaining").textContent = "—";
    }
  }
  function renderScanner() {
    if (!root()) return;
    if (!root().dataset.initialized || root().dataset.layout !== "scanner") mountLayout(true);
  }
  function stop() { stopScanner(); }
  return { render, renderScanner, stop };
}
