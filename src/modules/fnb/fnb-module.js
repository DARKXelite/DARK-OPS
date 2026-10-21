const moneySafe = value => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });

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
  const dateToday = () => today();

  function sortedPending() {
    return (S.fnbOrders || [])
      .map(order => ({ ...order, balance: orderBalance(order), pendingDays: pendingDays(order, dateToday()) }))
      .filter(order => order.balance > 0)
      .sort((a, b) => String(a.orderDate || "").localeCompare(String(b.orderDate || "")) || b.pendingDays - a.pendingDays);
  }

  function renderOrderForm() {
    return `
      <section class="card fnb-panel">
        <div class="fnb-panel-head"><div><h3>Order items</h3><div class="fnb-note">Create one line per item. Orders immediately enter the pending list.</div></div></div>
        <div class="fnb-form-grid">
          <div class="field"><label class="f" for="fnbItem">Item name *</label><input id="fnbItem" maxlength="120" placeholder="e.g. Tomatoes" required></div>
          <div class="field"><label class="f" for="fnbCategory">Category</label><select id="fnbCategory"><option>Vegetables</option><option>Fruits</option><option>Dairy</option><option>Meat & Seafood</option><option>Dry Store</option><option>Beverages</option><option>Bakery</option><option>Other</option></select></div>
          <div class="field"><label class="f" for="fnbSupplier">Supplier *</label><input id="fnbSupplier" maxlength="120" placeholder="Supplier name" required></div>
          <div class="field"><label class="f" for="fnbOrderDate">Ordered date *</label><input id="fnbOrderDate" type="date" value="${dateToday()}" required></div>
          <div class="field"><label class="f" for="fnbQty">Quantity *</label><input id="fnbQty" type="number" min="0.001" step="any" placeholder="0" required></div>
          <div class="field"><label class="f" for="fnbUnit">Unit</label><select id="fnbUnit"><option>Kg</option><option>Gram</option><option>Litre</option><option>Pack</option><option>Nos</option><option>Box</option><option>Bottle</option><option>Tray</option></select></div>
          <div class="field"><label class="f" for="fnbRate">Expected rate (₹ / unit)</label><input id="fnbRate" type="number" min="0" step="0.01" placeholder="Optional"></div>
          <div class="field"><label class="f" for="fnbNotes">Notes</label><input id="fnbNotes" maxlength="240" placeholder="Optional order reference"></div>
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:14px"><button class="btn btn-primary" data-act="fnb-save-order"><span class="material-symbols-rounded">add_shopping_cart</span> Save order</button></div>
      </section>`;
  }

  function renderPending() {
    const rows = sortedPending();
    return `
      <section class="card fnb-panel">
        <div class="fnb-panel-head"><div><h3>Pending orders</h3><div class="fnb-note">Oldest outstanding orders appear first. Pending days are calculated from the ordered date.</div></div><span class="fnb-status pending">${rows.length} outstanding lines</span></div>
        <div class="table-wrap"><table class="fnb-table"><thead><tr><th>Pending days</th><th>Order date</th><th>Item / supplier</th><th>Ordered</th><th>Received</th><th>Balance</th><th>Expected rate</th><th>Status</th></tr></thead><tbody>
          ${rows.length ? rows.map(o => `<tr><td><div class="fnb-days ${o.pendingDays >= 7 ? "critical" : ""}"><strong>${o.pendingDays}</strong><span>days pending</span></div></td><td>${esc(o.orderDate || "—")}</td><td><b>${esc(o.itemName)}</b><div class="fnb-note">${esc(o.supplier)}</div></td><td>${num(o.orderedQty)} ${esc(o.unit)}</td><td>${num(o.receivedQty)} ${esc(o.unit)}</td><td><b>${o.balance} ${esc(o.unit)}</b></td><td>${num(o.expectedRate) ? money(num(o.expectedRate)) : "—"}</td><td><span class="fnb-status ${num(o.receivedQty) ? "partial" : "pending"}">${num(o.receivedQty) ? "Partial" : "Pending"}</span></td></tr>`).join("") : '<tr><td colspan="8" class="fnb-empty">No pending orders. A rare operational miracle.</td></tr>'}
        </tbody></table></div>
      </section>`;
  }

  function renderReceivables() {
    const rows = sortedPending();
    return `
      <section class="card fnb-panel">
        <div class="fnb-panel-head"><div><h3>Receivables</h3><div class="fnb-note">Record only quantities physically received. Partial receipts remain outstanding until the balance reaches zero.</div></div><span class="fnb-status pending">${rows.length} to receive</span></div>
        <div class="table-wrap"><table class="fnb-table"><thead><tr><th>Ordered date</th><th>Item / supplier</th><th>Balance</th><th>Received now</th><th>Actual rate (₹ / unit)</th><th>Action</th></tr></thead><tbody>
        ${rows.length ? rows.map(o => `<tr><td>${esc(o.orderDate || "—")}</td><td><b>${esc(o.itemName)}</b><div class="fnb-note">${esc(o.supplier)}</div></td><td><b>${o.balance} ${esc(o.unit)}</b></td><td><input class="fnb-inline-input" id="fnbReceiveQty-${esc(o.id)}" type="number" min="0.001" max="${o.balance}" step="any" placeholder="Qty" aria-label="Received quantity for ${esc(o.itemName)}"></td><td><input class="fnb-inline-input" id="fnbReceiveRate-${esc(o.id)}" type="number" min="0" step="0.01" value="${num(o.expectedRate) || ""}" placeholder="Rate" aria-label="Actual unit rate for ${esc(o.itemName)}"></td><td><button class="btn btn-sm btn-primary" data-act="fnb-receive" data-id="${esc(o.id)}">Save receipt</button></td></tr>`).join("") : '<tr><td colspan="6" class="fnb-empty">Nothing outstanding to receive.</td></tr>'}
        </tbody></table></div>
      </section>`;
  }

  function renderConsumption() {
    const totals = new Map();
    (S.fnbReceipts || []).forEach(r => {
      const key = String(r.itemName || "Unspecified");
      const row = totals.get(key) || { itemName: key, quantity: 0, spend: 0, unit: r.unit || "" };
      row.quantity += num(r.quantity);
      row.spend += num(r.quantity) * num(r.rate);
      totals.set(key, row);
    });
    const rows = [...totals.values()].sort((a,b) => b.spend - a.spend);
    return `
      <section class="card fnb-panel">
        <div class="fnb-panel-head"><div><h3>Consumption analysis</h3><div class="fnb-note">IDS indent import is planned. Until it is connected, this section reports received quantities and recorded purchase spend, not actual kitchen consumption.</div></div></div>
        <div class="table-wrap"><table class="fnb-table"><thead><tr><th>Item</th><th>Total received</th><th>Recorded purchase spend</th></tr></thead><tbody>
          ${rows.length ? rows.map(r => `<tr><td><b>${esc(r.itemName)}</b></td><td>${r.quantity} ${esc(r.unit)}</td><td>${money(r.spend)}</td></tr>`).join("") : '<tr><td colspan="3" class="fnb-empty">No receipt data yet. IDS indent import can be connected in a later step.</td></tr>'}
        </tbody></table></div>
      </section>`;
  }

  function render() {
    const root = $("#fnbRoot");
    if (!root) return;
    const pendingCount = sortedPending().length;
    setHTML(root, `
      <div class="fnb-shell">
        <div class="fnb-tabs" role="tablist" aria-label="F&B sections">
          <button class="btn fnb-tab ${activeTab === "order" ? "active" : ""}" role="tab" aria-selected="${activeTab === "order"}" data-act="fnb-tab" data-tab="order">Order</button>
          <button class="btn fnb-tab ${activeTab === "receivables" ? "active" : ""}" role="tab" aria-selected="${activeTab === "receivables"}" data-act="fnb-tab" data-tab="receivables">Receivables <span class="fnb-status pending">${pendingCount}</span></button>
        </div>
        ${activeTab === "order" ? renderOrderForm() + renderPending() : renderReceivables()}
        ${renderConsumption()}
      </div>`);
  }

  function setTab(tab) {
    activeTab = tab === "receivables" ? "receivables" : "order";
  }

  async function saveOrder() {
    const itemName = $("#fnbItem")?.value.trim();
    const supplier = $("#fnbSupplier")?.value.trim();
    const orderedQty = num($("#fnbQty")?.value);
    const orderDate = $("#fnbOrderDate")?.value || dateToday();
    if (!itemName || !supplier || orderedQty <= 0) {
      toast("Enter an item, supplier and a quantity greater than zero.", "err");
      return;
    }
    const expectedRate = Math.max(0, num($("#fnbRate")?.value));
    try {
      await addDoc(collection(db, CONFIG.COL.fnbOrders), {
        itemName, category: $("#fnbCategory")?.value || "Other", supplier,
        orderDate, orderedQty, receivedQty: 0, unit: $("#fnbUnit")?.value || "Nos",
        expectedRate, notes: $("#fnbNotes")?.value.trim() || "",
        status: "Pending", createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
      toast("F&B order saved");
      render();
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
    const rate = rateValue === "" ? 0 : Math.max(0, num(rateValue));
    const balance = orderBalance(order);
    if (quantity <= 0 || quantity > balance) {
      toast("Enter a received quantity above zero and no greater than the outstanding balance.", "err");
      return;
    }
    const orderRef = doc(db, CONFIG.COL.fnbOrders, orderId);
    const receiptRef = doc(collection(db, CONFIG.COL.fnbReceipts));
    try {
      await runTransaction(db, async tx => {
        const snapshot = await tx.get(orderRef);
        if (!snapshot.exists()) throw new Error("Order no longer exists");
        const current = snapshot.data();
        const currentBalance = orderBalance(current);
        if (quantity > currentBalance) throw new Error("Receipt exceeds the remaining balance");
        const receivedQty = num(current.receivedQty) + quantity;
        tx.set(receiptRef, {
          orderId, itemName: current.itemName, category: current.category || "Other",
          supplier: current.supplier || "", unit: current.unit || "Nos",
          quantity, rate, receiptDate: dateToday(), createdAt: serverTimestamp()
        });
        tx.update(orderRef, {
          receivedQty, status: receivedQty >= num(current.orderedQty) ? "Received" : "Partial",
          updatedAt: serverTimestamp()
        });
      });
      toast("Receipt saved");
    } catch (error) {
      console.error("F&B receipt failed", error);
      toast(error.message === "Receipt exceeds the remaining balance" ? error.message : "Could not save receipt. Check connection and access rules.", "err");
    }
  }

  return { render, setTab, saveOrder, receive };
}
