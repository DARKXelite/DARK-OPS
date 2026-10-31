/**
 * Returns the live inventory balance written by stock transactions.
 * Fuel logs are an audit/analytics ledger, not a second deduction source.
 */
export function inventoryOnHand(item) {
  const value = Number(item?.stockQuantity);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
