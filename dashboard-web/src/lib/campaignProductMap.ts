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
 * composite `${storeId}::${platform}::${campaignId}` so the same campaign ID
 * from different stores or ad platforms doesn't collide.
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

export function campaignKey(storeId: string, platform: string, campaignId: string): string {
  return `${storeId}::${platform}::${campaignId}`;
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

type CampaignKeyMigrationRow = {
  storeId: string;
  campaignId: string;
  platform: string;
};

/**
 * One-time localStorage migration from the legacy
 * `${storeId}::${campaignId}` key to `${storeId}::${platform}::${campaignId}`.
 * When a platform cannot be inferred from current campaign rows, the old key
 * is kept and a warning is logged so the mapping is not destroyed.
 */
export function migrateProductMapKeys(campaignsData?: { rows?: CampaignKeyMigrationRow[] } | null): ProductMap {
  const map = readProductMap();
  const rows = campaignsData?.rows ?? [];
  let changed = false;

  for (const oldKey of Object.keys(map)) {
    // WR-07: detect legacy 2-segment keys via explicit segment count,
    // not the `^[^:]+::[^:]+$` regex. The regex assumes neither storeId
    // nor campaignId contains a colon, which currently holds in production
    // (all storeIds alphanumeric; Meta/Google campaign IDs numeric) but
    // is defense-in-depth: if a campaignId ever picks up a colon (manual
    // sheet edit, future platform), the regex silently fails to migrate
    // and the legacy key stays orphaned. Explicit count is also easier
    // to grep when debugging.
    const parts = oldKey.split('::');
    if (parts.length !== 2) continue; // skip 3-segment (already migrated) and malformed
    const [storeId, campaignId] = parts;
    if (!storeId || !campaignId) continue; // skip empty segments (e.g. "foo::" or "::bar")
    const platforms = new Set(
      rows
        .filter(r => r.storeId === storeId && r.campaignId === campaignId)
        .map(r => r.platform)
        .filter(Boolean),
    );

    if (platforms.size !== 1) {
      console.warn(
        `Could not migrate product map key "${oldKey}" because campaign platform could not be determined.`,
      );
      continue;
    }

    const platform = Array.from(platforms)[0];
    const nextKey = campaignKey(storeId, platform, campaignId);
    const merged = Array.from(new Set([...(map[nextKey] ?? []), ...(map[oldKey] ?? [])]));
    map[nextKey] = merged;
    delete map[oldKey];
    changed = true;
  }

  if (changed) writeProductMap(map);
  return map;
}

/** Convenience: replace the product list for a single campaign. Empty
 *  array (or no products) removes the campaign's entry entirely so the
 *  storage stays clean. */
export function setMappedProducts(
  storeId: string,
  platform: string,
  campaignId: string,
  productIds: string[],
): ProductMap {
  const map = readProductMap();
  const k = campaignKey(storeId, platform, campaignId);
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
  platform: string,
  productId: string,
  map: ProductMap,
): string[] {
  const prefix = `${storeId}::${platform}::`;
  const out: string[] = [];
  for (const [k, productIds] of Object.entries(map)) {
    if (!k.startsWith(prefix)) continue;
    if (productIds.includes(productId)) out.push(k);
  }
  return out;
}

function campaignsForProductInStore(
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
  /** Each entry is one product's totals in the date range. Both revenue
   *  AND units are allocated using the same spend-proportional share, so
   *  the displayed numbers stay consistent (a campaign that gets 70% of
   *  the revenue also gets 70% of the units). */
  productRevenue: Array<{ productId: string; netRevenueCad: number; units: number }>;
  campaignSpend: Map<string, number>; // campaignKey → spend in range
}): Map<string, { revenue: number; units: number }> {
  const { storeId, map, productRevenue, campaignSpend } = args;
  const out = new Map<string, { revenue: number; units: number }>();

  for (const p of productRevenue) {
    if (!p.productId) continue;
    if (p.netRevenueCad <= 0 && p.units <= 0) continue;
    const mappedKeys = campaignsForProductInStore(storeId, p.productId, map);
    if (mappedKeys.length === 0) continue; // orphan — skip

    const spendsForProduct = mappedKeys.map(k => campaignSpend.get(k) ?? 0);
    const totalSpend = spendsForProduct.reduce((s, x) => s + x, 0);

    for (let i = 0; i < mappedKeys.length; i++) {
      const k = mappedKeys[i];
      const share =
        totalSpend > 0
          ? spendsForProduct[i] / totalSpend
          : 1 / mappedKeys.length;
      const cur = out.get(k) ?? { revenue: 0, units: 0 };
      cur.revenue += p.netRevenueCad * share;
      cur.units += p.units * share;
      out.set(k, cur);
    }
  }
  return out;
}
