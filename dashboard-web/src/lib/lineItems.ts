/**
 * Pure-TypeScript mirror of the Apps Script `computeLineItemsCad_`
 * function in `Shopify.gs:654-685`. Used by `dashboard-web` tests to
 * exercise the proportional-split logic without standing up a V8
 * runtime for the .gs source.
 *
 * KEEP IN SYNC with Shopify.gs. The behavior contract:
 *   - `subtotal = Σ price × qty` over the UNFILTERED line items (includes
 *     custom / empty-productId items). This matters when an order mixes
 *     a real product with a custom item — the custom item still occupies
 *     a share of orderTotal, so excluding it from the denominator would
 *     over-credit the real product. (WR-01)
 *   - If `subtotal > 0`: each retained line item gets
 *     `(lineGross / subtotal) × orderTotal`.
 *   - If `subtotal === 0` (rare — free-gift / 100%-discount orders):
 *     spread `orderTotal` equally across ALL items (denominator =
 *     items.length, mirroring Shopify.gs:678). Items without productId
 *     are still skipped from the output, but they consume their share
 *     of the flat-spread denominator.
 *   - Items with empty `productId` are skipped (the writer skips
 *     custom / deleted-product items at line 672-673).
 *   - Results are rounded to 2 decimal places via `round2_` in the
 *     .gs writer. The pure helper here also rounds to 2 dp so the
 *     "Σ split ≈ orderTotal within 1 cent" contract holds.
 *
 * TODO (future phase): extract a shared revenue-allocation schema so
 * Shopify.gs and dashboard-web stop duplicating this logic. Tracked
 * in .planning/phases/05.2.1.1-algorithm-correctness-fixes-codex-via-gsd-cross-ai/05.2.1.1-REVIEW.md
 * WR-01 (the post-mortem that explicitly documented the
 * "KEEP IN SYNC" duplication risk, including the off-by-shape bug
 * fixed in that commit).
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

  // Mirror Shopify.gs:658 — subtotal includes ALL items, including
  // custom/empty-productId. This matters when an order mixes a real
  // product with a custom item: excluding custom items from the
  // denominator would silently over-credit the real product's share
  // of orderTotal vs the .gs writer's output. (WR-01)
  const subtotal = lineItems.reduce(
    (s, li) => s + (Number(li.price) || 0) * (Number(li.quantity) || 0),
    0,
  );

  const useFlatSpread = !(subtotal > 0);
  // Mirror Shopify.gs:678 — flat-spread denominator uses items.length
  // (the unfiltered count), not the filtered-valid count.
  const denom = lineItems.length;

  const out: LineItemSplit[] = [];
  for (const li of lineItems) {
    // Skip custom / deleted-product items — matches Shopify.gs:672-673.
    // The custom item still contributed to `subtotal` and `denom` above,
    // so its share of orderTotal stays out of the output array (consistent
    // with the .gs writer skipping it before push).
    if (!li.productId || li.productId.length === 0) continue;
    const qty = Number(li.quantity) || 0;
    const lineGross = (Number(li.price) || 0) * qty;
    const lineCad = useFlatSpread
      ? (denom > 0 ? orderTotal / denom : 0)
      : (lineGross / subtotal) * orderTotal;
    out.push({
      productId: li.productId,
      units: qty,
      revenueCad: round2(lineCad),
    });
  }
  return out;
}
