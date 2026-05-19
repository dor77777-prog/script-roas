/**
 * Pure-TypeScript mirror of the Apps Script `computeLineItemsCad_`
 * function in `Shopify.gs:654-685`. Used by `dashboard-web` tests to
 * exercise the proportional-split logic without standing up a V8
 * runtime for the .gs source.
 *
 * KEEP IN SYNC with Shopify.gs. The behavior contract:
 *   - `subtotal = Σ price × qty` over line items.
 *   - If `subtotal > 0`: each line item gets `(lineGross / subtotal) × orderTotal`.
 *   - If `subtotal === 0` (rare — free-gift / 100%-discount orders):
 *     spread `orderTotal` equally across items (avoid divide-by-zero).
 *   - Items with empty `productId` are skipped (the writer skips
 *     custom / deleted-product items at line 672-673).
 *   - Results are rounded to 2 decimal places via `round2_` in the
 *     .gs writer. The pure helper here also rounds to 2 dp so the
 *     "Σ split ≈ orderTotal within 1 cent" contract holds.
 *
 * TODO (future phase): extract a shared revenue-allocation schema so
 * Shopify.gs and dashboard-web stop duplicating this logic. Tracked
 * in the SUMMARY's "Flagged for Follow-up" section.
 */

export type LineItemInput = {
  /** Shopify numeric product ID as string. Empty string skips this item. */
  productId: string;
  /** Per-unit price in CAD before discounts. */
  price: number;
  /** Quantity. */
  quantity: number;
};

export type LineItemSplit = {
  productId: string;
  units: number;
  revenueCad: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Pure-TS mirror of Shopify.gs `computeLineItemsCad_`. See module docstring.
 */
export function computeLineItemsCad(
  orderTotal: number,
  lineItems: LineItemInput[],
): LineItemSplit[] {
  if (!lineItems || lineItems.length === 0) return [];

  // Filter to items with a productId (matches the writer's behavior — items
  // without product_id can never match a campaign's mapped products anyway).
  const valid = lineItems.filter(li => li.productId && li.productId.length > 0);
  if (valid.length === 0) return [];

  const subtotal = valid.reduce(
    (s, li) => s + (Number(li.price) || 0) * (Number(li.quantity) || 0),
    0,
  );

  const useFlatSpread = !(subtotal > 0);

  return valid.map(li => {
    const qty = Number(li.quantity) || 0;
    const lineGross = (Number(li.price) || 0) * qty;
    const lineCad = useFlatSpread
      ? (valid.length > 0 ? orderTotal / valid.length : 0)
      : (lineGross / subtotal) * orderTotal;
    return {
      productId: li.productId,
      units: qty,
      revenueCad: round2(lineCad),
    };
  });
}
