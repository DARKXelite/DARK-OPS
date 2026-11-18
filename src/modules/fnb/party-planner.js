const MASS = Object.freeze({ kg: 1, g: 0.001 });
const VOLUME = Object.freeze({ l: 1, ml: 0.001 });
const UNIT_ALIASES = Object.freeze({
  kgs: "kg", kilogram: "kg", kilograms: "kg",
  gm: "g", gms: "g", gram: "g", grams: "g",
  ltr: "l", litre: "l", litres: "l", liter: "l", liters: "l",
  millilitre: "ml", millilitres: "ml", milliliter: "ml", milliliters: "ml",
  pc: "nos", pcs: "nos", no: "nos", piece: "nos", pieces: "nos",
  packs: "pack", boxes: "box", bottles: "bottle", trays: "tray", dz: "dozen"
});

export function unitKey(value) {
  const unit = String(value || "").trim().toLowerCase().replaceAll(".", "");
  return UNIT_ALIASES[unit] || unit;
}

export function convertPortionToPurchaseUnit(quantity, fromUnit, purchaseUnit) {
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty < 0) return null;
  const from = unitKey(fromUnit), to = unitKey(purchaseUnit);
  if (MASS[from] && MASS[to]) return qty * MASS[from] / MASS[to];
  if (VOLUME[from] && VOLUME[to]) return qty * VOLUME[from] / VOLUME[to];
  if (from === to) return qty;
  return null;
}

export function calculateRecipeCost(recipe, pax, inventory = []) {
  const guests = Math.max(0, Number(pax) || 0);
  const lines = (recipe?.ingredients || []).map(line => {
    const item = inventory.find(row => row.id === line.itemId);
    const purchaseUnit = line.purchaseUnit || item?.unit || "";
    const rate = Number(line.purchaseRate ?? item?.unitCost ?? 0);
    const portionQty = Number(line.portionQty || 0);
    const portionUnit = line.portionUnit || purchaseUnit;
    const requiredPerGuest = convertPortionToPurchaseUnit(portionQty, portionUnit, purchaseUnit);
    const requiredQty = requiredPerGuest === null ? null : requiredPerGuest * guests;
    const cost = requiredQty === null || !Number.isFinite(rate) ? null : requiredQty * Math.max(0, rate);
    const stock = Number(item?.stockQuantity || 0);
    return {
      ...line, itemName: line.itemName || item?.partName || "Unlinked ingredient",
      purchaseUnit, purchaseRate: Number.isFinite(rate) ? Math.max(0, rate) : 0,
      portionQty, portionUnit, requiredQty, lineCost: cost,
      stockQty: stock, shortage: requiredQty === null ? null : Math.max(0, requiredQty - stock),
      unitError: requiredQty === null
    };
  });
  const priced = lines.every(line => line.lineCost !== null);
  const totalCost = lines.reduce((sum, line) => sum + (line.lineCost || 0), 0);
  return { lines, totalCost, costPerPax: guests > 0 ? totalCost / guests : 0, priced };
}

const escHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[char]));

export function createPartyPlannerModule({
  db, CONFIG, collection, addDoc, doc, updateDoc, serverTimestamp,
  num, money, today, S, $, canWriteInventory, toast
}) {
  let section = "plan";
  let selectedPlanId = "";
  let draft = emptyPlan();
  let quickAddDish = -1;

  function emptyPlan() {
    return { eventName: "", eventDate: today(), pax: 1, eventType: "Party", notes: "", menuItems: [] };
  }

  const inventoryItems = () => (S.inventory || []).filter(item => ["F&B", "Other"].includes(String(item.category || "Other"))).slice().sort((a, b) =>
    String(a.partName || "").localeCompare(String(b.partName || ""))
  );
  const recipes = () => (S.savedRecipes || []).slice().sort((a, b) =>
    String(a.name || "").localeCompare(String(b.name || ""))
  );
  const plans = () => (S.partyPlans || []).slice().sort((a, b) =>
    String(b.eventDate || "").localeCompare(String(a.eventDate || ""))
  );
  const findItem = id => inventoryItems().find(item => item.id === id);
  const recipeCost = dish => calculateRecipeCost(dish, Number(draft.pax) || 0, inventoryItems());
  const planCost = () => {
    const dishes = (draft.menuItems || []).map(dish => ({ dish, ...recipeCost(dish) }));
    return {
      dishes,
      totalCost: dishes.reduce((sum, row) => sum + row.totalCost, 0),
      priced: dishes.every(row => row.priced),
      costPerPax: Number(draft.pax) > 0 ? dishes.reduce((sum, row) => sum + row.totalCost, 0) / Number(draft.pax) : 0,
      shortages: dishes.flatMap(row => row.lines.filter(line => line.shortage > 0).map(line => ({ ...line, dishName: row.dish.name })))
    };
  };

  function readDraftFromDOM() {
    const root = $("#fnbRoot");
    if (!root) return;
    const val = selector => root.querySelector(selector)?.value ?? "";
    draft.eventName = val("[data-plan-field='eventName']");
    draft.eventDate = val("[data-plan-field='eventDate']") || today();
    draft.pax = Math.max(1, Number(val("[data-plan-field='pax']")) || 1);
    draft.eventType = val("[data-plan-field='eventType']") || "Party";
    draft.notes = val("[data-plan-field='notes']");
    root.querySelectorAll("[data-dish-index]").forEach(card => {
      const index = Number(card.dataset.dishIndex);
      const dish = draft.menuItems[index];
      if (!dish) return;
      dish.name = card.querySelector("[data-dish-field='name']")?.value.trim() || "";
      dish.category = card.querySelector("[data-dish-field='category']")?.value || "Main Course";
      card.querySelectorAll("[data-line-index]").forEach(lineEl => {
        const lineIndex = Number(lineEl.dataset.lineIndex);
        const line = dish.ingredients[lineIndex];
        if (!line) return;
        line.itemId = lineEl.querySelector("[data-line-field='itemId']")?.value || "";
        const item = findItem(line.itemId);
        line.itemName = item?.partName || lineEl.querySelector("[data-line-field='itemName']")?.value || line.itemName || "";
        line.purchaseUnit = item?.unit || line.purchaseUnit || "";
        line.purchaseRate = item ? Number(item.unitCost || 0) : Number(line.purchaseRate || 0);
        line.portionQty = Math.max(0, Number(lineEl.querySelector("[data-line-field='portionQty']")?.value) || 0);
        line.portionUnit = lineEl.querySelector("[data-line-field='portionUnit']")?.value || line.purchaseUnit;
      });
    });
  }

  function addDish() {
    readDraftFromDOM();
    draft.menuItems.push({ name: "", category: "Main Course", recipeId: "", ingredients: [] });
    quickAddDish = -1;
  }

  function addIngredient(index) {
    readDraftFromDOM();
    const dish = draft.menuItems[index];
    if (dish) dish.ingredients.push({ itemId: "", itemName: "", purchaseUnit: "", purchaseRate: 0, portionQty: 0, portionUnit: "g" });
  }

  function removeDish(index) {
    readDraftFromDOM();
    draft.menuItems.splice(index, 1);
  }

  function removeIngredient(dishIndex, lineIndex) {
    readDraftFromDOM();
    draft.menuItems[dishIndex]?.ingredients.splice(lineIndex, 1);
  }

  function beginNew() {
    selectedPlanId = "";
    draft = emptyPlan();
    section = "plan";
    quickAddDish = -1;
  }

  function editPlan(id) {
    const plan = plans().find(row => row.id === id);
    if (!plan) return;
    selectedPlanId = id;
    draft = {
      eventName: plan.eventName || "", eventDate: plan.eventDate || today(),
      pax: Math.max(1, Number(plan.pax) || 1), eventType: plan.eventType || "Party",
      notes: plan.notes || "",
      menuItems: (plan.menuItems || []).map(dish => ({
        ...dish, ingredients: (dish.ingredients || []).map(line => ({ ...line }))
      }))
    };
    section = "plan";
    quickAddDish = -1;
  }

  function loadRecipe(id) {
    if (section === "plan") readDraftFromDOM();
    const recipe = recipes().find(row => row.id === id);
    if (!recipe) return;
    draft.menuItems.push({
      name: recipe.name, category: recipe.category || "Main Course",
      recipeId: recipe.id, recipeVersion: recipe.version || 1,
      ingredients: (recipe.ingredients || []).map(line => ({ ...line }))
    });
    section = "plan";
    toast("Recipe added to this party. Changes here will not alter the saved recipe.");
  }

  async function quickCreateIngredient(index) {
    readDraftFromDOM();
    if (!canWriteInventory()) {
      toast("Your role cannot create inventory items. Ask an inventory manager.", "err");
      return;
    }
    const root = $("#fnbRoot");
    const card = root?.querySelector("[data-quick-add='" + index + "']");
    const name = card?.querySelector("[data-quick-name]")?.value.trim() || "";
    const unit = card?.querySelector("[data-quick-unit]")?.value || "Kg";
    const rate = Number(card?.querySelector("[data-quick-rate]")?.value);
    if (!name || !Number.isFinite(rate) || rate < 0) {
      toast("Enter an ingredient name and a valid purchase rate.", "err");
      return;
    }
    const duplicate = inventoryItems().find(item => String(item.partName || "").trim().toLowerCase() === name.toLowerCase());
    if (duplicate) {
      toast("That ingredient already exists in Inventory. Select the existing item.", "err");
      return;
    }
    try {
      const ref = await addDoc(collection(db, CONFIG.COL.inventory), {
        partName: name, category: "F&B", domain: "F&B", stockQuantity: 0,
        unit, unitCost: rate, reorderLevel: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
      S.inventory = [...(S.inventory || []).filter(item => item.id !== ref.id), { id: ref.id, partName: name, category: "F&B", domain: "F&B", stockQuantity: 0, unit, unitCost: rate, reorderLevel: 0 }];
      draft.menuItems[index].ingredients.push({
        itemId: ref.id, itemName: name, purchaseUnit: unit, purchaseRate: rate,
        portionQty: 0, portionUnit: unit
      });
      quickAddDish = -1;
      toast("Ingredient added to Clover Inventory and linked to this recipe.");
    } catch (error) {
      console.error("F&B ingredient creation failed", error);
      toast("Could not create the inventory item. Check inventory access and Firestore rules.", "err");
    }
  }

  async function saveParty() {
    readDraftFromDOM();
    if (!draft.eventName.trim()) { toast("Enter an event name.", "err"); return; }
    if (!Number.isInteger(Number(draft.pax)) || Number(draft.pax) < 1) { toast("PAX must be at least 1.", "err"); return; }
    if (!draft.menuItems.length) { toast("Add at least one menu item.", "err"); return; }
    if (draft.menuItems.some(dish => !dish.name.trim())) { toast("Every menu item needs a name.", "err"); return; }
    if (draft.menuItems.some(dish => !dish.ingredients.length)) { toast("Add ingredients to every menu item before saving.", "err"); return; }
    const summary = planCost();
    const menuItems = summary.dishes.map(({ dish, lines, totalCost, costPerPax, priced }) => ({
      ...dish,
      ingredients: lines.map(line => ({
        itemId: line.itemId || "", itemName: line.itemName, purchaseUnit: line.purchaseUnit,
        purchaseRateSnapshot: line.purchaseRate, portionQty: line.portionQty,
        portionUnit: line.portionUnit, requiredQtySnapshot: line.requiredQty,
        lineCostSnapshot: line.lineCost
      })),
      dishCostSnapshot: totalCost, costPerPaxSnapshot: costPerPax, pricedSnapshot: priced
    }));
    const payload = {
      eventName: draft.eventName.trim(), eventDate: draft.eventDate, pax: Number(draft.pax),
      eventType: draft.eventType, notes: draft.notes,
      menuItems, totalFoodCostSnapshot: summary.totalCost,
      foodCostPerPaxSnapshot: summary.costPerPax, pricedSnapshot: summary.priced,
      shortageSnapshot: summary.shortages.map(line => ({ itemId: line.itemId, itemName: line.itemName, dishName: line.dishName, shortage: line.shortage, unit: line.purchaseUnit })),
      status: "Draft", updatedAt: serverTimestamp()
    };
    try {
      if (selectedPlanId) {
        await updateDoc(doc(db, CONFIG.COL.partyPlans, selectedPlanId), payload);
        toast("Party plan updated. Historical rate and quantity snapshots refreshed for this saved version.");
      } else {
        payload.createdAt = serverTimestamp();
        const ref = await addDoc(collection(db, CONFIG.COL.partyPlans), payload);
        selectedPlanId = ref.id;
        toast("Party plan saved.");
      }
      section = "analysis";
    } catch (error) {
      console.error("Party plan save failed", error);
      toast("Could not save the party plan. Check F&B access and Firestore rules.", "err");
    }
  }


  async function saveRecipe(index, updateOriginal = false) {
    readDraftFromDOM();
    const dish = draft.menuItems[index];
    if (!dish || !dish.name.trim() || !dish.ingredients.length) {
      toast("Add a dish name and at least one ingredient.", "err");
      return;
    }
    const ingredients = dish.ingredients.map(line => ({
      itemId: line.itemId || "", itemName: line.itemName || "",
      purchaseUnit: line.purchaseUnit || "", purchaseRate: Number(line.purchaseRate || 0),
      portionQty: Number(line.portionQty || 0), portionUnit: line.portionUnit || line.purchaseUnit || ""
    }));
    const payload = {
      name: dish.name.trim(), category: dish.category || "Main Course", ingredients,
      version: updateOriginal ? Number(dish.recipeVersion || 1) + 1 : 1,
      updatedAt: serverTimestamp()
    };
    try {
      if (updateOriginal && dish.recipeId) {
        await updateDoc(doc(db, CONFIG.COL.savedRecipes, dish.recipeId), payload);
        dish.recipeVersion = payload.version;
        toast("Original saved recipe updated. The party copy remains independent.");
      } else {
        payload.createdAt = serverTimestamp();
        const ref = await addDoc(collection(db, CONFIG.COL.savedRecipes), payload);
        dish.recipeId = ref.id;
        dish.recipeVersion = 1;
        toast("Dish saved to Recipe Library.");
      }
    } catch (error) {
      console.error("Recipe save failed", error);
      toast("Could not save recipe. Check F&B access and Firestore rules.", "err");
    }
  }

  function renderIngredientLine(line, dishIndex, lineIndex) {
    const selected = line.itemId || "";
    const options = inventoryItems().map(item =>
      '<option value="' + escHtml(item.id) + '"' + (item.id === selected ? " selected" : "") + '>' +
      escHtml(item.partName || item.itemName) + " · " + escHtml(item.unit || "UOP") +
      " · " + money(Number(item.unitCost || 0)) + '</option>'
    ).join("");
    const item = findItem(selected);
    const unit = line.purchaseUnit || item?.unit || "Kg";
    const portionUnit = line.portionUnit || unit;
    return '<div class="fnb-recipe-line" data-line-index="' + lineIndex + '">' +
      '<label class="field"><span class="f">Inventory ingredient</span><select data-line-field="itemId"><option value="">Select inventory item</option>' + options + '</select></label>' +
      '<label class="field"><span class="f">Portion qty / PAX</span><input data-line-field="portionQty" type="number" min="0" step="any" value="' + escHtml(line.portionQty ?? 0) + '"></label>' +
      '<label class="field"><span class="f">Portion unit</span><select data-line-field="portionUnit">' +
      ["g","kg","ml","l","nos","pack","box","bottle","tray"].map(value => '<option value="' + value + '"' + (unitKey(portionUnit) === value ? " selected" : "") + '>' + value + '</option>').join("") +
      '</select></label>' +
      '<div class="fnb-line-meta">' + (item ? 'UOP ' + escHtml(item.unit || "—") + ' · Rate ' + money(Number(item.unitCost || 0)) + ' / ' + escHtml(item.unit || "") : "Select an inventory item") + '</div>' +
      '<button type="button" class="btn btn-sm" data-act="fnb-party-remove-line" data-dish="' + dishIndex + '" data-line="' + lineIndex + '">Remove</button></div>';
  }

  function renderDish(dish, index) {
    const cost = recipeCost(dish);
    const quickForm = quickAddDish === index
      ? '<div class="fnb-quick-add" data-quick-add="' + index + '"><h4>Quick add to Inventory</h4>' +
        '<label class="field"><span class="f">Ingredient name</span><input data-quick-name maxlength="120" placeholder="e.g. Mozzarella"></label>' +
        '<label class="field"><span class="f">Unit of purchase (UOP)</span><select data-quick-unit><option>Kg</option><option>Gram</option><option>Litre</option><option>ML</option><option>Nos</option><option>Pack</option><option>Box</option><option>Bottle</option><option>Tray</option></select></label>' +
        '<label class="field"><span class="f">Purchase rate (₹ / UOP)</span><input data-quick-rate type="number" min="0" step="0.01" placeholder="0.00"></label>' +
        '<button type="button" class="btn btn-primary btn-sm" data-act="fnb-party-add-inventory" data-dish="' + index + '">Create inventory item</button>' +
        '<button type="button" class="btn btn-sm" data-act="fnb-party-cancel-quick">Cancel</button></div>' : "";
    return '<article class="card fnb-dish-card" data-dish-index="' + index + '">' +
      '<div class="fnb-dish-head"><div><label class="field"><span class="f">Menu item / dish</span><input data-dish-field="name" maxlength="120" value="' + escHtml(dish.name) + '" placeholder="e.g. Chicken Biryani"></label></div>' +
      '<label class="field"><span class="f">Category</span><select data-dish-field="category">' +
      ["Starter","Soup","Salad","Main Course","Bread","Rice","Dessert","Beverage","Other"].map(value => '<option' + (dish.category === value ? " selected" : "") + '>' + value + '</option>').join("") +
      '</select></label><button type="button" class="btn btn-sm" data-act="fnb-party-remove-dish" data-index="' + index + '">Remove dish</button></div>' +
      '<div class="fnb-recipe-lines">' + (dish.ingredients || []).map((line, lineIndex) => renderIngredientLine(line, index, lineIndex)).join("") + '</div>' +
      '<div class="fnb-dish-actions"><button type="button" class="btn btn-sm" data-act="fnb-party-add-line" data-index="' + index + '">+ Add ingredient</button>' +
      '<button type="button" class="btn btn-sm" data-act="fnb-party-quick" data-index="' + index + '">+ New inventory ingredient</button>' +
      '<button type="button" class="btn btn-sm" data-act="fnb-party-save-recipe" data-index="' + index + '">Save as recipe</button>' +
      (dish.recipeId ? '<button type="button" class="btn btn-sm" data-act="fnb-party-update-recipe" data-index="' + index + '">Update original recipe v' + escHtml(dish.recipeVersion || 1) + '</button>' : '') +
      '<span class="fnb-cost-inline" data-dish-cost="' + index + '">Dish cost: ' + money(cost.totalCost) + ' · ' + (cost.priced ? money(cost.costPerPax) + ' / PAX' : "Check unit compatibility") + '</span></div>' +
      quickForm + '</article>';
  }

  function ensureLiveBinding() {
    const root = $("#fnbRoot");
    if (!root || root.dataset.partyPlannerBound) return;
    const refresh = event => {
      if (!event.target.matches("[data-plan-field], [data-dish-field], [data-line-field]")) return;
      readDraftFromDOM();
      const summary = planCost();
      const pax = root.querySelector("[data-kpi=pax]");
      const total = root.querySelector("[data-kpi=total]");
      const perPax = root.querySelector("[data-kpi=per-pax]");
      if (pax) pax.textContent = fmt(draft.pax, 0);
      if (total) total.textContent = money(summary.totalCost);
      if (perPax) perPax.textContent = money(summary.costPerPax);
      summary.dishes.forEach((row, index) => {
        const cost = root.querySelector('[data-dish-cost="' + index + '"]');
        if (cost) cost.textContent = "Dish cost: " + money(row.totalCost) + " · " + (row.priced ? money(row.costPerPax) + " / PAX" : "Check unit compatibility");
      });
    };
    root.addEventListener("input", refresh);
    root.addEventListener("change", refresh);
    root.dataset.partyPlannerBound = "true";
  }

  function renderPlan() {
    const summary = planCost();
    const stockRows = summary.shortages.map(line => '<tr><td>' + escHtml(line.dishName) + '</td><td>' + escHtml(line.itemName) + '</td><td>' + num(line.requiredQty).toFixed(2) + ' ' + escHtml(line.purchaseUnit) + '</td><td>' + num(line.stockQty).toFixed(2) + ' ' + escHtml(line.purchaseUnit) + '</td><td><b>' + num(line.shortage).toFixed(2) + ' ' + escHtml(line.purchaseUnit) + '</b></td></tr>').join("");
    return '<section class="card fnb-panel"><div class="fnb-panel-head"><div><h3>' + (selectedPlanId ? "Edit party plan" : "New party plan") + '</h3><div class="fnb-note">Menu ingredients are costed against the existing Clover Inventory Master. No stock is deducted while planning.</div></div>' +
      '<button type="button" class="btn" data-act="fnb-party-new">New plan</button></div>' +
      '<div class="fnb-form-grid"><label class="field"><span class="f">Event name *</span><input data-plan-field="eventName" maxlength="120" value="' + escHtml(draft.eventName) + '" placeholder="Wedding reception"></label>' +
      '<label class="field"><span class="f">Event date</span><input data-plan-field="eventDate" type="date" value="' + escHtml(draft.eventDate) + '"></label>' +
      '<label class="field"><span class="f">Number of PAX *</span><input data-plan-field="pax" type="number" min="1" step="1" value="' + escHtml(draft.pax) + '"></label>' +
      '<label class="field"><span class="f">Event type</span><select data-plan-field="eventType">' + ["Party","Wedding","Corporate","Buffet","Conference","Other"].map(v => '<option' + (draft.eventType === v ? " selected" : "") + '>' + v + '</option>').join("") + '</select></label></div>' +
      '<label class="field"><span class="f">Notes</span><input data-plan-field="notes" maxlength="500" value="' + escHtml(draft.notes) + '" placeholder="Optional notes"></label></section>' +
      '<div class="fnb-party-kpis"><div class="stat"><div class="k">Guests</div><div class="v" data-kpi="pax">' + fmt(draft.pax, 0) + '</div></div><div class="stat"><div class="k">Menu dishes</div><div class="v">' + summary.dishes.length + '</div></div><div class="stat"><div class="k">Estimated food cost</div><div class="v" data-kpi="total">' + money(summary.totalCost) + '</div></div><div class="stat"><div class="k">Cost / PAX</div><div class="v" data-kpi="per-pax">' + money(summary.costPerPax) + '</div></div></div>' +
      '<section class="fnb-menu-stack">' + (draft.menuItems.length ? draft.menuItems.map(renderDish).join("") : '<div class="card fnb-empty-state">Start by adding a dish, or load one from the Recipe Library.</div>') + '</section>' +
      '<div class="fnb-party-toolbar"><button type="button" class="btn" data-act="fnb-party-add-dish">+ Add menu item</button><button type="button" class="btn btn-primary" data-act="fnb-party-save">Save party plan</button><button type="button" class="btn" data-act="fnb-party-show-library">Recipe Library</button></div>' +
      '<section class="card fnb-panel"><div class="fnb-panel-head"><div><h3>Ingredient availability</h3><div class="fnb-note">Required quantity is calculated from PAX × portion size and compared with current inventory.</div></div></div>' +
      (stockRows ? '<div class="table-wrap"><table class="fnb-table"><thead><tr><th>Dish</th><th>Ingredient</th><th>Required</th><th>Available</th><th>Shortage</th></tr></thead><tbody>' + stockRows + '</tbody></table></div>' : '<div class="fnb-note">No shortages detected in linked ingredients, or add ingredients to calculate requirements.</div>') +
      '</section>';
  }

  function renderLibrary() {
    const cards = recipes().map(recipe => {
      const cost = calculateRecipeCost(recipe, 1, inventoryItems());
      return '<article class="card fnb-recipe-card"><div><h3>' + escHtml(recipe.name) + '</h3><span class="fnb-status">' + escHtml(recipe.category || "Main Course") + '</span><p class="fnb-note">' + (recipe.ingredients || []).length + ' ingredients · Version ' + escHtml(recipe.version || 1) + '</p></div>' +
        '<div class="fnb-recipe-card-actions"><button type="button" class="btn btn-primary btn-sm" data-act="fnb-party-load" data-id="' + escHtml(recipe.id) + '">Load into party</button><span class="fnb-note">' + (cost.priced ? money(cost.totalCost) + ' / PAX at current rates' : "Review units and rates") + '</span></div></article>';
    }).join("");
    return '<section class="card fnb-panel"><div class="fnb-panel-head"><div><h3>Recipe Library</h3><div class="fnb-note">Saved dishes can be reused. Loading a recipe creates an independent party copy.</div></div><button class="btn" data-act="fnb-party-new">New party</button></div>' +
      (cards || '<div class="fnb-empty-state">No saved recipes yet. Create a dish in Party Planner and choose “Save as recipe”.</div>') + '</section>';
  }

  function renderAnalysis() {
    const rows = plans().map(plan => '<tr><td><b>' + escHtml(plan.eventName) + '</b><div class="fnb-note">' + escHtml(plan.eventDate || "") + '</div></td><td>' + fmt(plan.pax, 0) + '</td><td>' + (plan.menuItems || []).length + '</td><td>' + money(plan.totalFoodCostSnapshot || 0) + '</td><td>' + money(plan.foodCostPerPaxSnapshot || 0) + '</td><td><button class="btn btn-sm" data-act="fnb-party-edit" data-id="' + escHtml(plan.id) + '">Open / edit</button></td></tr>').join("");
    return '<section class="card fnb-panel"><div class="fnb-panel-head"><div><h3>Party cost analysis</h3><div class="fnb-note">Saved estimates retain rate and quantity snapshots. Updating a party plan creates a new saved estimate.</div></div><button class="btn btn-primary" data-act="fnb-party-new">New party plan</button></div>' +
      '<div class="table-wrap"><table class="fnb-table"><thead><tr><th>Event</th><th>PAX</th><th>Dishes</th><th>Total food cost</th><th>Cost / PAX</th><th></th></tr></thead><tbody>' + (rows || '<tr><td colspan="6" class="fnb-empty">No party plans saved yet.</td></tr>') + '</tbody></table></div></section>';
  }

  function renderHtml() {
    ensureLiveBinding();
    return '<div class="fnb-party-shell"><div class="fnb-tabs">' +
      '<button class="btn fnb-tab ' + (section === "plan" ? "active" : "") + '" data-act="fnb-party-section" data-section="plan">Party Planner</button>' +
      '<button class="btn fnb-tab ' + (section === "library" ? "active" : "") + '" data-act="fnb-party-section" data-section="library">Recipe Library <span class="fnb-status">' + recipes().length + '</span></button>' +
      '<button class="btn fnb-tab ' + (section === "analysis" ? "active" : "") + '" data-act="fnb-party-section" data-section="analysis">Cost Analysis <span class="fnb-status">' + plans().length + '</span></button></div>' +
      (section === "library" ? renderLibrary() : section === "analysis" ? renderAnalysis() : renderPlan()) + '</div>';
  }

  function setSection(value) {
    if (section === "plan") readDraftFromDOM();
    section = ["plan", "library", "analysis"].includes(value) ? value : "plan";
  }

  function openQuickAdd(index) { readDraftFromDOM(); quickAddDish = Number(index); }
  function cancelQuickAdd() { readDraftFromDOM(); quickAddDish = -1; }

  return {
    renderHtml, setSection, beginNew, editPlan, addDish, addIngredient, removeDish,
    removeIngredient, loadRecipe, quickCreateIngredient, saveParty, saveRecipe,
    cancelQuickAdd, openQuickAdd, readDraftFromDOM
  };
}
