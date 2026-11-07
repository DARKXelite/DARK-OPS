export function createBreakfastModule(deps) {
  const {
    db, auth, RBAC, collection, doc, getDocs, writeBatch, runTransaction,
    query, where, orderBy, serverTimestamp, Timestamp, esc, today, addDays, toast
  } = deps;
  let bookings = [];
  let todayEntitlements = [];
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
  function shell() {
    const el = root();
    if (!el) return;
    const manager = canManage();
    el.innerHTML =
      '<div class="bf-page">' +
        '<header class="bf-header"><div><div class="bf-eyebrow">GUEST SERVICES · DIGITAL ENTITLEMENTS</div><h2>Breakfast Pass</h2><p>One reusable QR per guest · one redemption per eligible day.</p></div><div class="bf-header-mark"><span class="material-symbols-rounded">qr_code_2</span><span>7 AM – 10 AM</span></div></header>' +
        '<section class="bf-kpis" aria-label="Today breakfast summary">' +
          '<article class="bf-kpi"><span>EXPECTED TODAY</span><strong id="bfExpected">—</strong><small>Eligible guest passes</small></article>' +
          '<article class="bf-kpi"><span>REDEEMED</span><strong id="bfRedeemed">—</strong><small>Successfully scanned</small></article>' +
          '<article class="bf-kpi"><span>REMAINING</span><strong id="bfRemaining">—</strong><small>Not yet redeemed</small></article>' +
        '</section>' +
        '<div class="bf-workspace">' +
          (manager ? '<section class="bf-panel bf-booking-panel"><div class="bf-panel-head"><div><span class="bf-step">01 / RECEPTION</span><h3>Add guest booking</h3><p>Enter stay details to generate one reusable QR per guest.</p></div><span class="material-symbols-rounded">hotel</span></div>' +
            '<form id="bfBookingForm" class="bf-form" novalidate>' +
              '<label>Lead guest name<input id="bfGuestName" name="guestName" required maxlength="100" placeholder="Guest full name" autocomplete="name"></label>' +
              '<div class="bf-form-row"><label>Room number<input id="bfRoom" name="roomNumber" required maxlength="20" placeholder="e.g. 204"></label><label>Guest count<input id="bfGuestCount" name="guestCount" type="number" min="1" max="12" step="1" value="2" required inputmode="numeric"></label></div>' +
              '<label>Guest WhatsApp number <span class="bf-optional">optional</span><input id="bfPhone" name="guestPhone" type="tel" maxlength="18" placeholder="+91 98765 43210" autocomplete="tel"></label>' +
              '<div class="bf-form-row"><label>Check-in date<input id="bfCheckIn" name="checkInAt" type="datetime-local" required></label><label>Checkout date<input id="bfCheckOut" name="checkOutAt" type="datetime-local" required></label></div>' +
              '<div class="bf-date-preview" id="bfDatePreview">Enter stay date/time to preview breakfast eligibility.</div>' +
              '<button class="bf-primary" type="submit" id="bfCreateButton"><span class="material-symbols-rounded">confirmation_number</span>Generate breakfast passes</button>' +
              '<p class="bf-form-note">Checkout-day breakfast is included by default. Each guest receives one reusable QR for the entire stay.</p>' +
            '</form></section>' : '') +
          '<section class="bf-panel bf-scanner-panel"><div class="bf-panel-head"><div><span class="bf-step">02 / RESTAURANT</span><h3>Redeem breakfast</h3><p>Scan the same guest QR once per eligible date.</p></div><span class="material-symbols-rounded">qr_code_scanner</span></div>' +
            '<div class="bf-scanner-frame"><div id="breakfastQrReader" class="bf-reader"></div><div class="bf-scanner-placeholder" id="bfScannerPlaceholder"><span class="material-symbols-rounded">photo_camera</span><b>Camera scanner ready</b><small>Use the rear camera on a phone or tablet.</small></div></div>' +
            '<div class="bf-scan-actions"><button class="bf-primary" id="bfStartScanner" type="button" ' + (!canRedeem() ? 'disabled' : '') + '><span class="material-symbols-rounded">photo_camera</span>Start camera</button><button class="bf-secondary" id="bfStopScanner" type="button" disabled><span class="material-symbols-rounded">stop_circle</span>Stop</button></div>' +
            '<div class="bf-manual-scan"><label for="bfManualToken">Manual token entry</label><div><input id="bfManualToken" autocomplete="off" placeholder="Paste pass token"><button class="bf-secondary" id="bfRedeemManual" type="button" ' + (!canRedeem() ? 'disabled' : '') + '>Verify</button></div></div>' +
            '<div id="bfScanResult" class="bf-scan-result" aria-live="polite">' + (canRedeem() ? 'Ready to validate a breakfast pass.' : 'Your role does not have redemption access.') + '</div>' +
            '<p class="bf-form-note">One scan per guest per eligible date. Scanning after 10 AM is allowed until the end of that local date.</p>' +
          '</section>' +
        '</div>' +
        (manager ? '<section class="bf-panel bf-bookings-panel"><div class="bf-panel-head bf-bookings-head"><div><span class="bf-step">03 / RECEPTION RECORDS</span><h3>Guest bookings</h3><p>View stays and reopen their generated QR coupons.</p></div><button class="bf-secondary" id="bfRefresh" type="button"><span class="material-symbols-rounded">refresh</span>Refresh</button></div><div class="bf-date-filter"><label for="bfGuestDate">Breakfast date</label><input id="bfGuestDate" type="date" value="' + today() + '"><span id="bfGuestCountLabel"></span></div><div id="bfBookingsList" class="bf-bookings-list"><div class="bf-empty">Loading room guest list…</div></div></section>' : '') +
        '<section class="bf-panel bf-coupons-panel" id="bfCouponsPanel" hidden><div class="bf-panel-head bf-bookings-head"><div><span class="bf-step">GENERATED PASSES</span><h3 id="bfCouponsTitle">Guest coupons</h3><p>The same guest QR works on every eligible breakfast date.</p></div><button class="bf-secondary" id="bfCloseCoupons" type="button">Close</button></div><div id="bfCouponGrid" class="bf-coupon-grid"></div></section>' +
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
    target.innerHTML='<b>'+guests+' guest QR pass(es)</b><span>'+dates.length+' eligible breakfast date(s) × '+guests+' guest(s)</span><small>'+(dates.length?esc(dates[0])+' to '+esc(dates[dates.length-1]):'No 7–10 AM service window overlaps this stay')+'</small>';
  }
  async function loadData() {
    if (!canManage()) return;
    if (loading) return;
    loading = true;
    try {
      const results = await Promise.all([
        getDocs(query(collection(db, "breakfast_bookings"), orderBy("createdAt", "desc"))),
        getDocs(collection(db, "breakfast_entitlements"))
      ]);
      bookings = results[0].docs.map(s => ({ id: s.id, ...s.data() }));
      todayEntitlements = results[1].docs.map(s => ({ id: s.id, ...s.data() }));
      renderStats();
      renderBookings();
    } catch (error) {
      console.error("Breakfast data load failed", error);
      toast("Could not load breakfast records: " + (error.code || error.message), "err");
    } finally { loading = false; }
  }
  function renderStats() {
    const expected=todayEntitlements.filter(x=>x.status==="active"&&(x.breakfastDates||[]).includes(today())).length;
    const redeemed=todayEntitlements.filter(x=>x.status==="active"&&(x.breakfastDates||[]).includes(today())&&x.lastRedeemedDate===today()).length;
    const remaining=Math.max(0,expected-redeemed);
    const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = String(value); };
    set("bfExpected", expected);
    set("bfRedeemed", redeemed);
    set("bfRemaining", remaining);
  }
  function renderBookings() {
    const el=document.getElementById("bfBookingsList");if(!el)return;
    const date=document.getElementById("bfGuestDate")?.value||today(),used=new Set(todayEntitlements.filter(p=>p.lastRedeemedDate===date).map(p=>p.id)),rows=[];
    bookings.forEach(b=>{if(!(b.breakfastDates||[]).includes(date))return;for(let slot=1;slot<=Number(b.guestCount||0);slot++){const p=todayEntitlements.find(x=>x.bookingId===b.id&&Number(x.guestSlot)===slot);if(p)rows.push({b,p,slot,done:used.has(p.id)});}});
    const label=document.getElementById("bfGuestCountLabel");if(label)label.textContent=rows.length+" eligible guest(s)";
    if(!rows.length){el.innerHTML='<div class="bf-empty">No eligible room guests for '+esc(date)+'.</div>';return;}
    el.innerHTML=rows.map(({b,p,slot,done})=>'<article class="bf-booking-row"><div class="bf-booking-main"><b>Room '+esc(b.roomNumber)+' · '+esc(b.guestName)+'</b><span>Guest '+slot+' of '+Number(b.guestCount)+'</span><small>'+esc(b.checkInAt||b.checkIn)+' → '+esc(b.checkOutAt||b.checkOut)+'</small></div><span class="bf-booking-status">'+(done?'REDEEMED':'PENDING')+'</span><button class="bf-secondary" type="button" data-bf-act="view-one" data-id="'+esc(p.id)+'">View QR</button><button class="bf-secondary" type="button" data-bf-act="whatsapp-one" data-id="'+esc(p.id)+'">Send to WhatsApp</button></article>').join("");
  }
  async function renderCoupons(rows, title) {
    couponRows = rows;
    const panel = document.getElementById("bfCouponsPanel");
    const grid = document.getElementById("bfCouponGrid");
    if (!panel || !grid) return;
    document.getElementById("bfCouponsTitle").textContent = title || "Guest coupons";
    panel.hidden = false;
    grid.innerHTML = rows.map((c, i) =>
      '<article class="bf-coupon-card"><div class="bf-coupon-top"><b>Room ' + esc(c.roomNumber) + ' · Guest ' + esc(c.guestSlot) + '</b><span class="bf-coupon-status active">REUSABLE QR</span></div><div class="bf-qr-wrap"><div class="bf-qr-target" data-bf-qr="' + i + '"></div></div><strong>' + esc((c.breakfastDates || []).length) + ' eligible breakfast date(s)</strong><small>' + esc(c.guestName) + ' · ' + esc(c.bookingRef) + '</small><small>7:00–10:00 AM service window</small><button class="bf-secondary" type="button" data-bf-act="share-coupon" data-index="' + i + '"><span class="material-symbols-rounded">share</span>Share / download</button></article>'
    ).join("");
    rows.forEach((pass,i)=>{
      const target=grid.querySelector('[data-bf-qr="'+i+'"]');
      if(!target||typeof window.QRCode!=="function"){if(target)target.textContent="QR library unavailable. Reload while online.";return;}
      try{new window.QRCode(target,{text:pass.qrToken,width:220,height:220,colorDark:"#07100B",colorLight:"#FFFFFF",correctLevel:window.QRCode.CorrectLevel.M});}
      catch(error){console.error("QR render failed",error);target.textContent="QR could not be rendered.";}
    });
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
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
    if (guestPhone && !/^\+?[0-9\s()-]{8,18}$/.test(guestPhone)) { toast("Enter a valid WhatsApp number or leave it blank.", "err"); return; }
    const dates=breakfastDates(checkInAt,checkOutAt);
    if(!dates.length||dates.length>31){toast("No 7–10 AM breakfast window overlaps this stay, or stay exceeds 31 days.","err");return;}
    const button = document.getElementById("bfCreateButton");
    button.disabled = true;
    button.innerHTML = '<span class="material-symbols-rounded">hourglass_top</span>Generating passes…';
    try {
      const bookingRef = "CG-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
      const bookingDoc = doc(collection(db, "breakfast_bookings"));
      const batch = writeBatch(db);
      const passes = [];
      const nowUid = RBAC.session.uid;
      batch.set(bookingDoc, {
        bookingRef, guestName, roomNumber, guestPhone, guestCount, checkIn:checkInAt.slice(0,10), checkOut:checkOutAt.slice(0,10),
        checkInAt, checkOutAt, serviceWindowStart:"07:00", serviceWindowEnd:"10:00", breakfastDates:dates, couponCount:guestCount,
        status: "active", createdAt: serverTimestamp(), createdBy: nowUid
      });
      for(let guestSlot=1;guestSlot<=guestCount;guestSlot++){
        const token=randomToken(),tokenHash=await hashToken(token),entitlementRef=doc(db,"breakfast_entitlements",tokenHash);
        const pass={id:tokenHash,bookingId:bookingDoc.id,bookingRef,guestName,roomNumber,guestPhone,guestSlot,checkInAt,checkOutAt,breakfastDates:dates,serviceWindowStart:"07:00",serviceWindowEnd:"10:00",status:"active",qrToken:token,createdAt:serverTimestamp(),createdBy:nowUid};
        batch.set(entitlementRef,pass);passes.push(pass);
      }
      await batch.commit();
      toast("Breakfast passes generated · " + passes.length + " coupons");
      document.getElementById("bfBookingForm").reset();
      document.getElementById("bfGuestCount").value = "2";
      updateDatePreview();
      await loadData();
      await renderCoupons(passes, "New passes · " + bookingRef);
    } catch (error) {
      console.error("Breakfast booking creation failed", error);
      toast("Could not create breakfast passes: " + (error.code || error.message), "err");
    } finally {
      button.disabled = false;
      button.innerHTML = '<span class="material-symbols-rounded">confirmation_number</span>Generate breakfast passes';
    }
  }
  async function viewBookingCoupons(id) {
    if (!canManage()) return;
    try {
      const rows=todayEntitlements.filter(p=>p.bookingId===id).sort((a,b)=>a.guestSlot-b.guestSlot);
      if (!rows.length) { toast("No coupons found for this booking.", "err"); return; }
      await renderCoupons(rows, "Booking coupons · " + rows[0].bookingRef);
    } catch (error) {
      toast("Could not load coupons: " + (error.code || error.message), "err");
    }
  }
  async function shareCoupon(index) {
    const pass = couponRows[index];
    if (!pass) return;
    const box = document.querySelector('[data-bf-qr="' + index + '"]');
    const canvas = box?.querySelector("canvas");
    const image = box?.querySelector("img");
    const message = "Clover Greens breakfast pass for room " + pass.roomNumber + ", guest " + pass.guestSlot + ". Valid dates: " + (pass.breakfastDates || []).join(", ") + ". Breakfast window 7:00–10:00 AM. Same QR can be used once per eligible date.";
    try {
      if ((image?.src || canvas) && navigator.share && navigator.canShare) {
        const blob = image?.src ? await (await fetch(image.src)).blob() : await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
        const file = new File([blob], "breakfast-" + pass.validDate + "-guest-" + pass.guestSlot + ".png", { type: "image/png" });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ title: "Clover Greens Breakfast Pass", text: message, files: [file] });
          return;
        }
      }
    } catch (error) {
      if (error.name === "AbortError") return;
      console.warn("Native share unavailable", error);
    }
    if (image?.src || canvas) {
      const url = image?.src || canvas.toDataURL("image/png");
      const a = document.createElement("a"); a.href = url;
      a.download = "breakfast-room-" + pass.roomNumber + "-guest-" + pass.guestSlot + ".png"; a.click();
    }
    if (pass.guestPhone) {
      let phone = pass.guestPhone.replace(/\D/g, "");
      if (phone.length === 10) phone = "91" + phone;
      window.open("https://wa.me/" + phone + "?text=" + encodeURIComponent(message + " The QR image has been downloaded; attach it to this chat."), "_blank", "noopener");
    } else {
      toast("QR downloaded. Add the guest's WhatsApp number to send it directly.");
    }
  }
  async function shareCouponForPass(pass) {
    const phone=(pass.guestPhone||"").replace(/\D/g,""),normalized=phone.length===10?"91"+phone:phone;
    const msg="Clover Greens breakfast pass for Room "+pass.roomNumber+", Guest "+pass.guestSlot+". Valid dates: "+(pass.breakfastDates||[]).join(", ")+". Breakfast window 7:00–10:00 AM. Same QR can be used once per eligible date.";
    const box=document.querySelector('[data-bf-qr="0"]'),img=box?.querySelector("img"),canvas=box?.querySelector("canvas");
    try {
      const blob=img?.src?await (await fetch(img.src)).blob():canvas?await new Promise(resolve=>canvas.toBlob(resolve,"image/png")):null;
      if(blob&&navigator.share&&navigator.canShare){
        const file=new File([blob],"breakfast-room-"+pass.roomNumber+"-guest-"+pass.guestSlot+".png",{type:"image/png"});
        if(navigator.canShare({files:[file]})){await navigator.share({title:"Clover Greens Breakfast Pass",text:msg,files:[file]});return;}
      }
      if(blob){const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="breakfast-room-"+pass.roomNumber+"-guest-"+pass.guestSlot+".png";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
    } catch(e){if(e.name==="AbortError")return;console.warn("WhatsApp QR share failed",e);}
    if(normalized)window.open("https://wa.me/"+normalized+"?text="+encodeURIComponent(msg+" The QR image has been downloaded. Please attach it to this chat."),"_blank","noopener");
    else toast("QR downloaded. Add a WhatsApp number to open the guest chat.");
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
        if (prior.exists()) throw new Error("DUPLICATE|" + (prior.data().redeemedAt?.toDate ? prior.data().redeemedAt.toDate().toLocaleTimeString("en-IN") : "already used"));
        transaction.update(entitlementRef, { lastRedeemedDate: today(), lastRedeemedAt: serverTimestamp(), lastRedeemedBy: RBAC.session.uid });
        transaction.set(redemptionRef, {
          entitlementId: tokenHash, bookingId: data.bookingId, bookingRef: data.bookingRef,
          roomNumber: data.roomNumber, guestName: data.guestName, guestSlot: data.guestSlot,
          validDate: today(), serviceWindowStart: "07:00", serviceWindowEnd: "10:00",
          redeemedAt: serverTimestamp(), redeemedBy: RBAC.session.uid
        });
        return data;
      });
      lastResult = outcome;
      setResult("success", "BREAKFAST ACCEPTED", "Room " + outcome.roomNumber + " · " + outcome.guestName + " · Guest " + outcome.guestSlot + " · " + today() + " · Daily pass consumed.");
      const input = document.getElementById("bfManualToken");
      if (input) input.value = "";
      if (canManage()) await loadData();
    } catch (error) {
      console.error("Breakfast redemption failed", error);
      const message = error.message || "Could not validate this pass.";
      if (message.startsWith("DUPLICATE|")) setResult("duplicate", "ALREADY REDEEMED TODAY", "This guest's breakfast was already redeemed at " + message.split("|")[1] + ". The same QR can be used again on the next eligible date.");
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
      if (button.dataset.bfAct === "view-one" || button.dataset.bfAct === "whatsapp-one") { const p=todayEntitlements.find(x=>x.id===button.dataset.id); if(p){renderCoupons([p],"Room "+p.roomNumber+" · Guest "+p.guestSlot);if(button.dataset.bfAct==="whatsapp-one")shareCouponForPass(p);} }
      if (button.dataset.bfAct === "share-coupon") shareCoupon(Number(button.dataset.index));
    });
  }
  function render() {
    if (!root()) return;
    if (!root().dataset.initialized) {
      shell();
      root().dataset.initialized = "true";
    }
    if (canManage()) loadData();
    else {
      document.getElementById("bfExpected").textContent = "—";
      document.getElementById("bfRedeemed").textContent = "—";
      document.getElementById("bfRemaining").textContent = "—";
    }
  }
  function stop() { stopScanner(); }
  return { render, stop };
}
