/**
 * Search/navigation command palette. All record-derived values are escaped and actions
 * are encoded as data attributes; no record content is compiled as executable JavaScript.
 */
export function createCommandPaletteModule({ $, VIEWS, S, esc, switchView, F, renderFleet }) {
  let cmdOpen = false;
  function toggleCmdPal() {
    cmdOpen = !cmdOpen;
    $("#cmdPal").classList.toggle("open", cmdOpen);
    $("#cmdOverlay").classList.toggle("open", cmdOpen);
    if (cmdOpen) { $("#cmdInp").value = ""; $("#cmdInp").focus(); renderCmd(""); }
  }
  document.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault(); toggleCmdPal();
    }
    if (e.key === "Escape" && cmdOpen) { toggleCmdPal(); }
  });
  $("#cmdOverlay").addEventListener("mousedown", () => { if(cmdOpen) toggleCmdPal(); });
  document.addEventListener("input", e => { if (e.target.id === "cmdInp") renderCmd(e.target.value.toLowerCase()); });
  
  function renderCmd(q) {
    const res = [];
    Object.entries(VIEWS).forEach(([view, meta]) => {
      if (!q || String(meta[0] || "").toLowerCase().includes(q) || String(meta[3] || "").toLowerCase().includes(q)) {
        res.push({ type: "Module", name: meta[0], view, icon: meta[2] });
      }
    });
  
    if (q) {
      S.machines.forEach(machine => {
        const name = String(machine.assetName || "");
        const id = String(machine.id || "");
        const category = String(machine.category || "");
        if (name.toLowerCase().includes(q) || id.toLowerCase().includes(q) || category.toLowerCase().includes(q)) {
          res.push({ type: "Machine Asset", name: name || id, view: "fleet", machineId: id, icon: "precision_manufacturing" });
        }
      });
  
      S.users.forEach(user => {
        const name = String(user.fullName || user.mobileNumber || "");
        if (name.toLowerCase().includes(q) || String(user.mobileNumber || "").includes(q) || String(user.role || "").toLowerCase().includes(q)) {
          res.push({ type: "Workforce · " + String(user.role || "unassigned"), name, view: "registry", icon: "person" });
        }
      });
  
      S.inventory.forEach(item => {
        const name = String(item.partName || "");
        const category = String(item.category || "");
        if (name.toLowerCase().includes(q) || category.toLowerCase().includes(q)) {
          const cat = category.toLowerCase();
          const view = cat.includes("fertilizer") || cat.includes("pesticide") || cat.includes("enhancement") ? "turfcare" : "registry";
          res.push({ type: "Inventory · " + category, name, view, icon: "inventory_2" });
        }
      });
    }
  
    const buttons = res.slice(0, 10).map(result => {
      const machineAttr = result.machineId ? ` data-cmd-machine="${esc(result.machineId)}"` : "";
      return `<button type="button" data-cmd-view="${esc(result.view)}"${machineAttr}><span class="material-symbols-rounded">${esc(result.icon)}</span><div><b>${esc(result.name)}</b><span class="t">${esc(result.type)}</span></div></button>`;
    });
    const target = $("#cmdRes");
    if (target) target.innerHTML = buttons.join("") || "<div class=\"empty\" style=\"padding:40px 12px\">No results found</div>";
  }
  
  // Keep generated results data-only. Never put record names or IDs into executable inline JavaScript.
  $("#cmdRes").addEventListener("click", event => {
    const button = event.target.closest("button[data-cmd-view]");
    if (!button) return;
    const view = button.dataset.cmdView;
    if (!Object.prototype.hasOwnProperty.call(VIEWS, view)) return;
    switchView(view);
    const machineId = button.dataset.cmdMachine;
    if (machineId) {
      const machine = S.machines.find(item => String(item.id) === machineId);
      if (machine) {
        F.q = String(machine.assetName || "");
        const search = $("#fleetQ");
        if (search) search.value = F.q;
        renderFleet();
      }
    }
    toggleCmdPal();
  });

  return { toggleCmdPal, renderCmd, isOpen: () => cmdOpen };
}
