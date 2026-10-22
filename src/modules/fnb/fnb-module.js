import { parseOrderRows, parseTextOrders } from "./fnb-import.js";
import { findFnbInventoryMatch, canReceiveIntoInventory } from "./inventory-link.js";

export function pendingDays(order, today) {
  const start = new Date(String(order.orderDate || today) + "T00:00:00");
  const end = new Date(String(today) + "T00:00:00");
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return 0;
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86400000));
}
export function orderBalance(order) {
  return Math.max(0, Number(order.orderedQty || 0) - Number(order.receivedQty || 0));
}

export function createFnbModule({
  db, CONFIG, collection, addDoc, doc, updateDoc, runTransaction, serverTimestamp,
  num, esc, money, today, S, $, setHTML, toast
}) {
  let activeTab = "order";
  let importPreview = null;
  let importBusy = false;
  const dateToday = () => today();

  function sortedPending() {
    return (S.fnbOrders || [])
      .map(order => ({ ...order, balance: orderBalance(order), pendingDays: pendingDays(order, dateToday()) }))
      .filter(order => order.balance > 0)
      .sort((a, b) => String(a.orderDate || "").localeCompare(String(b.orderDate || "")) || b.pendingDays - a.pendingDays);
  }

  function renderImport() {
    const preview = importPreview;
    return '<section class="card fnb-panel fnb-import-panel">' +
      '<div class="fnb-panel-head"><div><h3>Smart order import</h3><div class="fnb-note">Import Excel (.xlsx/.xls), CSV or plain text (.txt). The parser detects common column names and item/quantity patterns, then lets you review before saving.</div></div></div>' +
      '<div class="fnb-import-controls"><label class="field"><span class="f">Excel, CSV or TXT file</span><input id="fnbImportFile" type="file" accept=".xlsx,.xls,.csv,.txt,text/plain,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"></label>' +
      '<label class="field"><span class="f">Default supplier (used when file has none)</span><input id="fnbImportSupplier" maxlength="120" placeholder="Supplier name"></label>' +
      '<label class="field"><span class="f">Default order date</span><input id="fnbImportDate" type="date" value="' + dateToday() + '"></label></div>' +
      '<div class="fnb-note">TXT examples accepted: <code>Tomatoes - 5 kg</code>, <code>5 kg Tomatoes</code>, <code>Onions x 10</code>, or tab-separated <code>Item&nbsp;&nbsp;Qty&nbsp;&nbsp;Unit</code>. Ambiguous lines are listed as skipped instead of silently inventing an order.</div>' +
      (preview ? renderImportPreview(preview) : '<div class="fnb-import-empty">Choose a file to inspect the detected orders. Nothing is saved until you confirm import.</div>') +
      '</section>';
  }
  function renderImportPreview(preview) {
    const rows = preview.rows || [];
    return '<div class="fnb-import-summary"><span class="fnb-status received">' + rows.length + ' detected</span><span class="fnb-status pending">' + (preview.skipped || []).length + ' skipped / needs review</span><span class="fnb-note">' + (preview.headerDetected ? 'Column headers detected' : 'Pattern-based detection') + '</span></div>' +
      '<div class="table-wrap fnb-import-table-wrap"><table class="fnb-table"><thead><tr><th>Source row</th><th>Item</th><th>Quantity</th><th>Unit</th><th>Expected rate</th><th>Supplier from file</th><th>Date from file</th></tr></thead><tbody>' +
      (rows.length ? rows.map(row => '<tr><td>' + row.sourceRow + '</td><td><b>' + esc(row.itemName) + '</b></td><td>' + row.orderedQty + '</td><td>' + esc(row.unit) + '</td><td>' + (row.expectedRate ? money(row.expectedRate) : '—') + '</td><td>' + esc(row.supplier || 'Use default') + '</td><td>' + esc(row.orderDate || 'Use default') + '</td></tr>').join('') : '<tr><td colspan="7" class="fnb-empty">No confident item/quantity pairs found. Check the file format.</td></tr>') +
      '</tbody></table></div>' +
      ((preview.skipped || []).length ? '<details class="fnb-import-skipped"><summary>Skipped lines (' + preview.skipped.length + ')</summary><ul>' + preview.skipped.slice(0, 30).map(row => '<li><b>Row ' + row.sourceRow + ':</b> ' + esc(row.text) + '</li>').join('') + (preview.skipped.length > 30 ? '<li>…and ' + (preview.skipped.length - 30) + ' more</li>' : '') + '</ul></details>' : '') +
      '<div class="fnb-import-actions"><button class="btn" data-act="fnb-clear-import" ' + (importBusy ? 'disabled' : '') + '>Clear preview</button><button class="btn btn-primary" data-act="fnb-import-orders" ' + (!rows.length || importBusy ? 'disabled' : '') + '>' + (importBusy ? 'Importing…' : 'Import ' + rows.length + ' orders') + '</button></div>';
  }

  async function handleImportFile(file) {
    if (!file) return;
    importPreview = null;
    render();
    try {
      let result;
      if (/\.txt$/i.test(file.name) || file.type === "text/plain") {
        result = parseTextOrders(await file.text());
      } else {
        if (!window.XLSX) throw new Error("Excel parser did not load. Refresh the page and retry.");
        const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) throw new Error("The workbook has no worksheets.");
        const rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "", raw: false });
        result = parseOrderRows(rows);
      }
      importPreview = { ...result, fileName: file.name };
      if (!result.rows.length) toast("No clear item/quantity rows detected. Check skipped lines and try another layout.", "err");
    } catch (error) {
      console.error("F&B import parse failed", error);
      toast(error.message || "Could not read that file.", "err");
    }
    render();
  }

  function renderOrderForm() {
    return '<section class="card fnb-panel">' +
      '<div class="fnb-panel-head"><div><h3>Order items</h3><div class="fnb-note">Create one line per item. Orders immediately enter the pending list.</div></div></div>' +
      '<div class="fnb-form-grid">' +
      '<div class="field"><label class="f" for="fnbItem">Item name *</label><input id="fnbItem" maxlength="120" placeholder="e.g. Tomatoes" required></div>' +
      '<div class="field"><label class="f" for="fnbCategory">Category</label><select id="fnbCategory"><option>Vegetables</option><option>Fruits</option><option>Dairy</option><option>Meat & Seafood</option><option>Dry Store</option><option>Beverages</option><option>Bakery</option><option>Other</option></select></div>' +
      '<div class="field"><label class="f" for="fnbSupplier">Supplier *</label><input id="fnbSupplier" maxlength="120" placeholder="Supplier name" required></div>' +
      '<div class="field"><label class="f" for="fnbOrderDate">Ordered date *</label><input id="fnbOrderDate" type="date" value="' + dateToday() + '" required></div>' +
      '<div class="field"><label class="f" for="fnbQty">Quantity *</label><input id="fnbQty" type="number" min="0.001" step="any" placeholder="0" required></div>' +
      '<div class="field"><label class="f" for="fnbUnit">Unit</label><select id="fnbUnit"><option>Kg</option><option>Gram</option><option>Litre</option><option>Pack</option><option>Nos</option><option>Box</option><option>Bottle</option><option>Tray</option></select></div>' +
      '<div class="field"><label class="f" for="fnbRate">Expected rate (₹ / unit)</label><input id="fnbRate" type="number" min="0" step="0.01" placeholder="Optional"></div>' +
      '<div class="field"><label class="f" for="fnbNotes">Notes</label><input id="fnbNotes" maxlength="240" placeholder="Optional order reference"></div></div>' +
      '<div style="display:flex;justify-content:flex-end;margin-top:14px"><button class="btn btn-primary" data-act="fnb-save-order"><span class="material-symbols-rounded">add_shopping_cart</span> Save order</button></div></section>';
  }

  function renderPending() {
    const rows = sortedPending();
    return '<section class="card fnb-panel"><div class="fnb-panel-head"><div><h3>Pending orders</h3><div class="fnb-note">Oldest outstanding orders appear first. Pending days are calculated from the ordered date.</div></div><span class="fnb-status pending">' + rows.length + ' outstanding lines</span></div>' +
      '<div class="table-wrap"><table class="fnb-table"><thead><tr><th>Pending days</th><th>Order date</th><th>Item / supplier</th><th>Ordered</th><th>Received</th><th>Balance</th><th>Expected rate</th><th>Status</th></tr></thead><tbody>' +
      (rows.length ? rows.map(o => '<tr><td><div class="fnb-days ' + (o.pendingDays >= 7 ? 'critical' : '') + '"><strong>' + o.pendingDays + '</strong><span>days pending</span></div></td><td>' + esc(o.orderDate || '—') + '</td><td><b>' + esc(o.itemName) + '</b><div class="fnb-note">' + esc(o.supplier) + '</div></td><td>' + num(o.orderedQty) + ' ' + esc(o.unit) + '</td><td>' + num(o.receivedQty) + ' ' + esc(o.unit) + '</td><td><b>' + o.balance + ' ' + esc(o.unit) + '</b></td><td>' + (num(o.expectedRate) ? money(num(o.expectedRate)) : '—') + '</td><td><span class="fnb-status ' + (num(o.receivedQty) ? 'partial' : 'pending') + '">' + (num(o.receivedQty) ? 'Partial' : 'Pending') + '</span></td></tr>').join('') : '<tr><td colspan="8" class="fnb-empty">No pending orders.</td></tr>') +
      '</tbody></table></div></section>';
  }
  function renderReceivables() {
    const rows = sortedPending();
    return '<section class="card fnb-panel"><div class="fnb-panel-head"><div><h3>Receivables</h3><div class="fnb-note">Record only quantities physically received. Partial receipts remain outstanding until the balance reaches zero.</div></div><span class="fnb-status pending">' + rows.length + ' to receive</span></div>' +
      '<div class="table-wrap"><table class="fnb-table"><thead><tr><th>Ordered date</th><th>Item / supplier</th><th>Balance</th><th>Received now</th><th>Actual rate (₹ / unit)</th><th>Action</th></tr></thead><tbody>' +
      (rows.length ? rows.map(o => '<tr><td>' + esc(o.orderDate || '—') + '</td><td><b>' + esc(o.itemName) + '</b><div class="fnb-note">' + esc(o.supplier) + '</div></td><td><b>' + o.balance + ' ' + esc(o.unit) + '</b></td><td><input class="fnb-inline-input" id="fnbReceiveQty-' + esc(o.id) + '" type="number" min="0.001" max="' + o.balance + '" step="any" placeholder="Qty" aria-label="Received quantity for ' + esc(o.itemName) + '"></td><td><input class="fnb-inline-input" id="fnbReceiveRate-' + esc(o.id) + '" type="number" min="0" step="0.01" value="' + (num(o.expectedRate) || '') + '" placeholder="Rate" aria-label="Actual unit rate for ' + esc(o.itemName) + '"></td><td><button class="btn btn-sm btn-primary" data-act="fnb-receive" data-id="' + esc(o.id) + '">Save receipt</button></td></tr>').join('') : '<tr><td colspan="6" class="fnb-empty">Nothing outstanding to receive.</td></tr>') +
      '</tbody></table></div></section>';
  }
  function renderConsumption() {
    const totals = new Map();
    (S.fnbReceipts || []).forEach(r => {
      const key = String(r.itemName || "Unspecified");
      const row = totals.get(key) || { itemName: key, quantity: 0, spend: 0, unit: r.unit || "" };
      row.quantity += num(r.quantity); row.spend += num(r.quantity) * num(r.rate); totals.set(key, row);
    });
    const rows = [...totals.values()].sort((a,b) => b.spend - a.spend);
    return '<section class="card fnb-panel"><div class="fnb-panel-head"><div><h3>Consumption analysis</h3><div class="fnb-note">This reports received quantities and recorded purchase spend, not actual kitchen consumption.</div></div></div>' +
      '<div class="table-wrap"><table class="fnb-table"><thead><tr><th>Item</th><th>Total received</th><th>Recorded purchase spend</th></tr></thead><tbody>' +
      (rows.length ? rows.map(r => '<tr><td><b>' + esc(r.itemName) + '</b></td><td>' + r.quantity + ' ' + esc(r.unit) + '</td><td>' + money(r.spend) + '</td></tr>').join('') : '<tr><td colspan="3" class="fnb-empty">No receipt data yet.</td></tr>') +
      '</tbody></table></div></section>';
  }

  function render() {
    const root = $("#fnbRoot");
    if (!root) return;
    const pendingCount = sortedPending().length;
    setHTML(root, '<div class="fnb-shell"><div class="fnb-tabs" role="tablist" aria-label="F&B sections">' +
      '<button class="btn fnb-tab ' + (activeTab === "order" ? "active" : "") + '" role="tab" aria-selected="' + (activeTab === "order") + '" data-act="fnb-tab" data-tab="order">Order</button>' +
      '<button class="btn fnb-tab ' + (activeTab === "receivables" ? "active" : "") + '" role="tab" aria-selected="' + (activeTab === "receivables") + '" data-act="fnb-tab" data-tab="receivables">Receivables <span class="fnb-status pending">' + pendingCount + '</span></button></div>' +
      (activeTab === "order" ? renderImport() + renderOrderForm() + renderPending() : renderReceivables()) + renderConsumption() + '</div>');
    const fileInput = $("#fnbImportFile");
    if (fileInput) fileInput.addEventListener("change", event => handleImportFile(event.target.files?.[0]));
  }

  function setTab(tab) { activeTab = tab === "receivables" ? "receivables" : "order"; }
  function clearImport() { importPreview = null; render(); }
  async function importOrders() {
    const rows = importPreview?.rows || [];
    if (!rows.length || importBusy) return;
    const defaultSupplier = $("#fnbImportSupplier")?.value.trim() || "";
    const defaultDate = $("#fnbImportDate")?.value || dateToday();
    const missingSupplier = rows.filter(row => !(row.supplier || defaultSupplier));
    if (missingSupplier.length) {
      toast("Enter a default supplier or make sure every imported row has a supplier column.", "err");
      return;
    }
    importBusy = true; render();
    let imported = 0;
    try {
      for (const row of rows) {
        await addDoc(collection(db, CONFIG.COL.fnbOrders), {
          itemName: row.itemName, category: row.category || "Other",
          supplier: row.supplier || defaultSupplier, orderDate: row.orderDate || defaultDate,
          orderedQty: row.orderedQty, receivedQty: 0, unit: row.unit || "Nos",
          expectedRate: Math.max(0, num(row.expectedRate)), notes: row.notes || ("Imported from " + importPreview.fileName + " · row " + row.sourceRow),
          status: "Pending", importSource: "file", sourceFile: importPreview.fileName,
          sourceRow: row.sourceRow, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
        });
        imported++;
      }
      toast("Imported " + imported + " F&B orders");
      importPreview = null;
    } catch (error) {
      console.error("F&B order import failed", error);
      if (imported > 0 && importPreview) importPreview = { ...importPreview, rows: rows.slice(imported) };
      toast("Imported " + imported + " of " + rows.length + ". Only the remaining rows stay in the preview, so retrying will not duplicate the successful prefix.", "err");
    } finally { importBusy = false; render(); }
  }
  async function saveOrder() {
    const itemName = $("#fnbItem")?.value.trim();
    const supplier = $("#fnbSupplier")?.value.trim();
    const orderedQty = num($("#fnbQty")?.value);
    const orderDate = $("#fnbOrderDate")?.value || dateToday();
    if (!itemName || !supplier || orderedQty <= 0) { toast("Enter an item, supplier and a quantity greater than zero.", "err"); return; }
    const expectedRate = Math.max(0, num($("#fnbRate")?.value));
    try {
      await addDoc(collection(db, CONFIG.COL.fnbOrders), {
        itemName, category: $("#fnbCategory")?.value || "Other", supplier,
        orderDate, orderedQty, receivedQty: 0, unit: $("#fnbUnit")?.value || "Nos",
        expectedRate, notes: $("#fnbNotes")?.value.trim() || "",
        status: "Pending", createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
      toast("F&B order saved"); render();
    } catch (error) {
      console.error("F&B order save failed", error);
      toast("Could not save F&B order. Check connection and access rules.", "err");
    }
  }
  async function receive(orderId) {
    const order = (S.fnbOrders || []).find(row => row.id === orderId);
    if (!order) { toast("Order not found. Refresh and retry.", "err"); return; }
    const quantity = num($("#fnbReceiveQty-" + orderId)?.value);
    const rateValue = $("#fnbReceiveRate-" + orderId)?.value;
    const rate = rateValue === "" ? Math.max(0, num(order.expectedRate)) : Math.max(0, num(rateValue));
    const balance = orderBalance(order);
    if (quantity <= 0 || quantity > balance) { toast("Enter a received quantity above zero and no greater than the outstanding balance.", "err"); return; }
    const orderRef = doc(db, CONFIG.COL.fnbOrders, orderId);
    const receiptRef = doc(collection(db, CONFIG.COL.fnbReceipts));
    const inwardRef = doc(collection(db, CONFIG.COL.inwards));
    const currentItem = findFnbInventoryMatch(S.inventory, order.itemName, order.category);
    const inventoryRef = currentItem
      ? doc(db, CONFIG.COL.inventory, currentItem.id)
      : doc(collection(db, CONFIG.COL.inventory));
    try {
      await runTransaction(db, async tx => {
        const snapshot = await tx.get(orderRef);
        if (!snapshot.exists()) throw new Error("Order no longer exists");
        const current = snapshot.data();
        const currentBalance = orderBalance(current);
        if (quantity > currentBalance) throw new Error("Receipt exceeds the remaining balance");
        const existingInventorySnap = currentItem ? await tx.get(inventoryRef) : null;
        const existingInventory = existingInventorySnap?.exists() ? existingInventorySnap.data() : null;
        if (existingInventory && !canReceiveIntoInventory(existingInventory, current.unit)) {
          throw new Error("Inventory unit mismatch for " + current.itemName + ": master uses " + (existingInventory.unit || "Nos") + " but this order uses " + (current.unit || "Nos") + ". Correct the inventory unit before receiving.");
        }
        const receivedQty = num(current.receivedQty) + quantity;
        const inventoryQty = Math.max(0, num(existingInventory?.stockQuantity)) + quantity;
        if (existingInventory) {
          const stockUpdate = { stockQuantity: +inventoryQty.toFixed(4), updatedAt: serverTimestamp() };
          if (rate > 0) stockUpdate.unitCost = rate;
          tx.update(inventoryRef, stockUpdate);
        } else {
          tx.set(inventoryRef, {
            partName: current.itemName, category: "F&B", domain: "F&B",
            stockQuantity: +inventoryQty.toFixed(4), unit: current.unit || "Nos",
            unitCost: rate, reorderLevel: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
          });
        }
        const taxableAmount = +(quantity * rate).toFixed(2);
        tx.set(receiptRef, {
          orderId, itemId: inventoryRef.id, itemName: current.itemName,
          category: current.category || "Other", supplier: current.supplier || "",
          unit: current.unit || "Nos", quantity, rate, receiptDate: dateToday(),
          createdAt: serverTimestamp(), transactionType: "FNB_RECEIPT", inwardId: inwardRef.id
        });
        tx.set(inwardRef, {
          itemId: inventoryRef.id, itemName: current.itemName, category: "F&B",
          fnbCategory: current.category || "Other", unit: current.unit || "Nos",
          quantity, rate, gstPercent: 0, taxableAmount, gstAmount: 0, total: taxableAmount,
          supplier: current.supplier || "", invoiceNumber: "FNB-" + receiptRef.id,
          receiptDate: dateToday(), notes: "F&B order " + orderId,
          transactionType: "FNB_RECEIPT", fnbOrderId: orderId, fnbReceiptId: receiptRef.id,
          createdAt: serverTimestamp()
        });
        tx.update(orderRef, { receivedQty, status: receivedQty >= num(current.orderedQty) ? "Received" : "Partial", updatedAt: serverTimestamp() });
      });
      toast("Receipt saved · F&B inventory stock updated");
    } catch (error) {
      console.error("F&B receipt failed", error);
      toast(error.message === "Receipt exceeds the remaining balance" ? error.message : "Could not save receipt. Check connection and access rules.", "err");
    }
  }
  return { render, setTab, saveOrder, receive, importOrders, clearImport };
}
