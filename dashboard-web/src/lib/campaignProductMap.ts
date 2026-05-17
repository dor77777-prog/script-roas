/**
 * Campaign → product attribution mapping. Lets the user manually tag which
 * Shopify product(s) each ad campaign promotes, then we can reconcile what
 * Meta claims the campaign sold (`conversionValue`) against what Shopify
 * actually sold of those products in the same window.
 *
 * Many-to-many:
 *   - One product can be promoted by N campaigns (different angles / audiences)
 *   - One campaign can promote N products (a "best of" or bundle campaign)
 *
 * Storage shape: `{ [campaignKey]: productId[] }` where campaignKey is the
 * composite `${storeId}::${campaignId}` so the same product ID from
 * different stores doesn't collide.
 *
 * Cloud-synced via the existing pushCloudKey infrastructure (registered as
 * 'campaign-product-map' in STATE_KEYS). Partners on other devices see the
 * same mapping after the normal poll cycle.
 */

import { pushCloudKey } from './cloudSync';

const STORAGE_KEY = 'roas-dashboard:campaign-product-map' as const;

/** Map of campaignKey → productIds. Public type so callers can pass it
 *  around without re-reading localStorage. */
export type ProductMap = Record<string, string[]>;

export function campaignKey(storeId: string, campaignId: string): string {
  return `${storeId}::${campaignId}`;
}

export function readProductMap(): ProductMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    // Defensive: ensure every value is a string array.
    const clean: ProductMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (Array.isArray(v)) {
        clean[k] = v.filter(x => typeof x === 'string');
      }
    }
    return clean;
  } catch {
    return {};
  }
}

export function writeProductMap(map: ProductMap) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    window.dispatchEvent(new CustomEvent('roas-campaign-product-map-changed'));
    pushCloudKey(STORAGE_KEY, map);
  } catch {
    /* quota / private mode — local-only failure, ignore */
  }
}

/** Convenience: replace the product list for a single campaign. Empty
 *  array (or no products) removes the campaign's entry entirely so the
 *  storage stays clean. */
export function setMappedProducts(
  storeId: string,
  campaignId: string,
  productIds: string[],
): ProductMap {
  const map = readProductMap();
  const k = campaignKey(storeId, campaignId);
  const cleaned = Array.from(new Set(productIds.filter(Boolean)));
  if (cleaned.length === 0) {
    delete map[k];
  } else {
    map[k] = cleaned;
  }
  writeProductMap(map);
  return map;
}

/** Reverse lookup: for a given product, which campaigns map to it? Returns
 *  the campaignKeys, scoped to the same store (cross-store sharing isn't
 *  meaningful — each Shopify product lives in exactly one store). */
export function campaignsForProduct(
  storeId: string,
  productId: string,
  map: ProductMap,
): string[] {
  const prefix = `${storeId}::`;
  const out: string[] = [];
  for (const [k, productIds] of Object.entries(map)) {
    if (!k.startsWith(prefix)) continue;
    if (productIds.includes(productId)) out.push(k);
  }
  return out;
}

/**
 * Allocate each mapped product's actual Shopify revenue across the campaigns
 * that map to it, proportionally to each campaign's ad spend in the same
 * date range. Returns a map of `campaignKey → trueRevenueCad`.
 *
 * Allocation rule:
 *   For each product P with mapped campaigns [C1..Cn]:
 *     totalSpend = sum of C1..Cn spend in the range
 *     For each campaign Ci:
 *       trueRevenue[Ci] += P.netRevenue * (Ci.spend / totalSpend)
 *
 * Edge cases:
 *   - If a campaign has 0 spend AND it's the only one mapped → it gets
 *     100% of the product (no other valid attribution exists).
 *   - If multiple campaigns map to P but ALL have 0 spend → split equally.
 *   - A product with no mapped campaigns contributes 0 to the result
 *     (it's an "orphan" — surfaced separately in the UI).
 *
 * `productRevenue` is an iterable of `{ productId, netRevenueCad }` already
 * filtered to the same store + date range as `campaignSpend`. The caller
 * computes both from `/api/products` and the local CampaignRow set.
 */
export function allocateProductRevenue(args: {
  storeId: string;
  map: ProductMap;
  productRevenue: Array<{ productId: string; netRevenueCad: number }>;
  campaignSpend: Map<string, number>; // campaignKey → spend in range
}): Map<string, number> {
  const { storeId, map, productRevenue, campaignSpend } = args;
  const out = new Map<string, number>();

  for (const p of productRevenue) {
    if (!p.productId || p.netRevenueCad <= 0) continue;
    const mappedKeys = campaignsForProduct(storeId, p.productId, map);
    if (mappedKeys.length === 0) continue; // orphan — skip

    const spendsForProduct = mappedKeys.map(k => campaignSpend.get(k) ?? 0);
    const totalSpend = spendsForProduct.reduce((s, x) => s + x, 0);

    for (let i = 0; i < mappedKeys.length; i++) {
      const k = mappedKeys[i];
      const share =
        totalSpend > 0
          ? spendsForProduct[i] / totalSpend // proportional to spend
          : 1 / mappedKeys.length;            // equal split if all-zero spend
      const allocated = p.netRevenueCad * share;
      out.set(k, (out.get(k) ?? 0) + allocated);
    }
  }
  return out;
}
