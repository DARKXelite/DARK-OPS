export function normalizeStockUnit(value) {
  const unit = String(value || "Nos").trim().toLowerCase().replace(/\./g, "");
  if (/^(kg|kgs|kilogram|kilograms)$/.test(unit)) return "kg";
  if (/^(g|gm|gms|gram|grams)$/.test(unit)) return "g";
  if (/^(l|ltr|litre|litres|liter|liters)$/.test(unit)) return "l";
  if (/^(ml|millilitre|millilitres|milliliter|milliliters)$/.test(unit)) return "ml";
  if (/^(no|nos|pc|pcs|piece|pieces)$/.test(unit)) return "nos";
  if (/^(pack|packs|pkt|packet|packets)$/.test(unit)) return "pack";
  if (/^(box|boxes)$/.test(unit)) return "box";
  if (/^(bottle|bottles)$/.test(unit)) return "bottle";
  if (/^(tray|trays)$/.test(unit)) return "tray";
  if (/^(dozen|dz)$/.test(unit)) return "dozen";
  return unit;
}
export function normalizeInventoryName(value) {
  return String(value || "").trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
export function findFnbInventoryMatch(inventory, itemName, category) {
  const name = normalizeInventoryName(itemName);
  if (!name) return null;
  return (inventory || []).find(item =>
    normalizeInventoryName(item.partName || item.itemName) === name &&
    ["F&B", "Other", category || "Other"].includes(item.category || "Other")
  ) || null;
}
export function canReceiveIntoInventory(existingItem, orderUnit) {
  return !existingItem || normalizeStockUnit(existingItem.unit || "Nos") === normalizeStockUnit(orderUnit || "Nos");
}
