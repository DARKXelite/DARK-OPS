const SETUP_KEY = "clover.reception.print.setup.dismissed.v1";
const SCRIPT_URL = "/setup-reception-print.ps1";
export function createReceptionPrinter() {
  function printHtml(html, title = "Clover Greens pass") {
    return new Promise((resolve, reject) => {
      const frame = document.createElement("iframe");
      frame.setAttribute("aria-hidden", "true"); frame.title = title;
      frame.style.cssText = "position:fixed;width:0;height:0;border:0;right:0;bottom:0;";
      document.body.appendChild(frame);
      const cleanup = () => window.setTimeout(() => frame.remove(), 1200);
      try {
        const doc = frame.contentWindow.document;
        doc.open(); doc.write(html); doc.close();
        Promise.all([...doc.images].map(img => img.complete ? Promise.resolve() : new Promise((res, rej) => {
          img.onload = res; img.onerror = () => rej(new Error("A pass image could not be loaded for printing."));
        }))).then(() => {
          frame.contentWindow.focus(); frame.contentWindow.print(); resolve(); cleanup();
        }).catch(error => { cleanup(); reject(error); });
      } catch (error) { cleanup(); reject(error); }
    });
  }
  async function shareQrOnWhatsApp(dataUrl, filename, phone, message) {
    if (!dataUrl || !dataUrl.startsWith("data:image/")) throw new Error("QR image is not ready.");
    const digits = String(phone || "").replace(/\D/g, "");
    const normalized = digits.length === 10 ? "91" + digits : digits;
    if (normalized.length < 10 || normalized.length > 13) throw new Error("Enter a valid WhatsApp mobile number.");
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], filename, { type: "image/png" });
    if (navigator.canShare?.({ files: [file] }) && navigator.share) {
      await navigator.share({ files: [file], title: "Clover Greens pass", text: message });
      return "shared";
    }
    const a = document.createElement("a");
    a.href = dataUrl; a.download = filename; a.click();
    window.open("https://wa.me/" + normalized + "?text=" + encodeURIComponent(message + "\n\nAttach the downloaded QR image before sending."), "_blank", "noopener");
    return "downloaded";
  }
  function showSetupPrompt() {
    if (localStorage.getItem(SETUP_KEY) === "1" || document.getElementById("receptionPrintSetup")) return;
    const overlay = document.createElement("div");
    overlay.id = "receptionPrintSetup";
    overlay.style.cssText = "position:fixed;inset:0;z-index:99999;background:rgba(4,10,7,.78);display:grid;place-items:center;padding:18px;";
    overlay.innerHTML = '<section style="width:min(540px,100%);background:#111b15;color:#f4f6f2;border:1px solid #526b55;border-radius:16px;padding:24px;font:14px/1.5 Arial,sans-serif">' +
      '<div style="color:#b5c58a;font-size:11px;font-weight:800;letter-spacing:1.6px">DARK OPS · RECEPTION</div><h2 style="margin:8px 0;font-size:22px">Reception printing setup</h2>' +
      '<p style="color:#d1d9d0">Breakfast Pass and Golf Pass share this printer workflow. Run the Windows setup script once. It creates one-time Setup shortcuts and silent Reception shortcuts for Chrome and Edge, each with its own isolated profile. Normal browser profiles and the Windows default printer are not changed.</p>' +
      '<a href="' + SCRIPT_URL + '" download="DARK-OPS-Reception-Setup.ps1" style="display:block;text-align:center;background:#b5c58a;color:#10170f;text-decoration:none;font-weight:800;padding:12px;border-radius:9px;margin:18px 0">Download Windows setup script</a>' +
      '<div style="background:#202b23;border-radius:10px;padding:12px;color:#e0e8dc;font-size:12px"><b>Printer note:</b> First open the matching Reception Setup shortcut, print a pass and select the reception printer in the print dialog. Close that browser. Then use the matching DARK OPS Reception shortcut for kiosk printing. This saves the printer choice in the dedicated profile without changing the Windows default. Test before live use; if the browser does not retain the destination, use the normal print dialog.</div>' +
      '<div style="display:flex;justify-content:flex-end;gap:10px;margin-top:18px"><button type="button" data-setup-later>Not now</button><button type="button" data-setup-done>I’ve run setup</button></div></section>';
    overlay.addEventListener("click", event => {
      if (event.target === overlay || event.target.closest("[data-setup-later]")) overlay.remove();
      if (event.target.closest("[data-setup-done]")) { localStorage.setItem(SETUP_KEY, "1"); overlay.remove(); }
    });
    document.body.appendChild(overlay);
  }
  return { printHtml, shareQrOnWhatsApp, showSetupPrompt };
}
