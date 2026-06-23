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

/**
 * Ad-set-level key — a 4-segment composite
 * `${storeId}::${platform}::${campaignId}::${adSetId}`.
 *
 * Coexists in the SAME ProductMap as the 3-segment campaign keys: an ad-set
 * with its own mapping overrides the campaign mapping for that ad-set
 * (resolved by `readProductsForAdSet`); ad-sets without an entry fall back to
 * the campaign mapping. The 3-segment campaign key is exactly the prefix of
 * the 4-segment ad-set key (`${campaignKey(...)}::${adSetId}`), so the two
 * granularities never collide.
 *
 * NOTE: the migration helper (`migrateProductMapKeys`) keys legacy detection
 * off segment count (length === 2). 4-segment ad-set keys are therefore left
 * untouched (skipped alongside 3-segment already-migrated keys).
 */
export function adSetKey(
  storeId: string,
  platform: string,
  campaignId: string,
  adSetId: string,
): string {
  return `${storeId}::${platform}::${campaignId}::${adSetId}`;
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
    // Phase 05.7.x (2026-05-23) — `immediate: true` skips the 400ms
    // debounce. Product mapping is an explicit "Save" action: the
    // operator clicks Save in ProductPickerModal and often refreshes
    // / closes the tab immediately after. With the debounce, the
    // POST never fires before reload → on reload, hydrateFromCloud
    // pulls the STALE cloud value and overwrites the just-saved
    // mapping → operator's new mapping silently disappears. The
    // immediate flag fires the POST synchronously so the cloud has
    // the new value before any refresh can race it.
    pushCloudKey(STORAGE_KEY, map, { immediate: true });
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

/** Convenience: replace the product list for a single AD-SET. Mirrors
 *  `setMappedProducts` exactly (dedupe + drop-empties + immediate cloud push)
 *  but writes the 4-segment ad-set key. An empty array removes the ad-set's
 *  entry so storage stays clean — and removing the ad-set entry naturally
 *  re-exposes the campaign-level mapping (see `readProductsForAdSet`).
 *  The campaign-level entry for the same campaign is never touched. */
export function setMappedProductsForAdSet(
  storeId: string,
  platform: string,
  campaignId: string,
  adSetId: string,
  productIds: string[],
): ProductMap {
  const map = readProductMap();
  const k = adSetKey(storeId, platform, campaignId, adSetId);
  const cleaned = Array.from(new Set(productIds.filter(Boolean)));
  if (cleaned.length === 0) {
    delete map[k];
  } else {
    map[k] = cleaned;
  }
  writeProductMap(map);
  return map;
}

/** Resolve the effective product list for an ad-set, applying precedence:
 *  1. the ad-set's OWN mapping if present (overrides the campaign);
 *  2. else the campaign-level mapping (the unchanged legacy behaviour);
 *  3. else [] (unmapped).
 *
 *  This is the single source of truth for ad-set → product resolution.
 *  Returns a copy so callers can't mutate the stored arrays. */
export function readProductsForAdSet(
  storeId: string,
  platform: string,
  campaignId: string,
  adSetId: string,
  map: ProductMap,
): string[] {
  const asKey = adSetKey(storeId, platform, campaignId, adSetId);
  if (Array.isArray(map[asKey])) return [...map[asKey]];
  const cKey = campaignKey(storeId, platform, campaignId);
  if (Array.isArray(map[cKey])) return [...map[cKey]];
  return [];
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
 * Minimal order shape the allocator needs. Subset of OrderAttributionRow —
 * we don't import the full type to keep this module dependency-light.
 * Only the four signal fields used to classify an order to a platform.
 */
type AllocatorOrder = {
  storeId: string;
  source: string;
  fbclidPresent: boolean;
  gclidPresent: boolean;
  lineItems: Array<{ productId: string; units: number; revenueCad: number }>;
};

/**
 * Classify an order to the ad platform that *deterministically* drove it.
 * Returns null when the order has no platform signal (direct, organic
 * referrer, lost UTM, etc.) — those fall through to the spend-proportional
 * fallback in the allocator.
 *
 * Mirrors shopify.ts:classifyOrderAttribution's priority chain, narrowed
 * to the paid-platform buckets (organic Meta/Google/TikTok are NOT counted
 * as "platform-driven" here because the user wouldn't expect their paid
 * ad campaign to be credited for an organic visit).
 */
function classifyOrderToPlatform(
  o: AllocatorOrder,
): 'Meta' | 'Google' | 'TikTok' | null {
  if (o.source === 'tiktok-paid') return 'TikTok';
  if (o.source === 'meta-paid') return 'Meta';
  if (o.source === 'google-paid') return 'Google';
  if (o.fbclidPresent) return 'Meta';
  if (o.gclidPresent) return 'Google';
  // ttclid is folded into source='tiktok-paid' by the classifier already,
  // so no separate ttclid check is needed here.
  return null;
}

/**
 * Allocate each mapped product's actual Shopify revenue + units across the
 * campaigns that map to it. Returns a map of `campaignKey → {revenue, units}`.
 *
 * # Algorithm — deterministic-first, spend-proportional fallback (Phase 05.7.9)
 *
 * For each product P:
 *   1. **Deterministic per-platform attribution.** For each order containing P
 *      with a platform signal (source='X-paid' OR fbclid/gclid), credit the
 *      order's line-items for P directly to that platform's bucket. Then,
 *      within a platform, split the platform's deterministic total among the
 *      campaigns of that platform mapped to P, proportionally to intra-
 *      platform spend.
 *   2. **Fallback for unsignaled orders.** The remainder of P's Shopify total
 *      (orders without click-id / source-name, e.g., direct + organic) is
 *      split proportionally to spend across ALL campaigns mapped to P. This
 *      is the original (pre-05.7.9) algorithm, now applied ONLY to the
 *      unattributed slice.
 *
 * # Why this matters
 *
 * Pre-05.7.9 the entire product total was split by spend share — so when a
 * product was mapped to BOTH a Meta and a TikTok campaign, the TikTok cell
 * would show e.g. "1.7 units" for a product with 2 Shopify sales even when
 * BOTH sales had `ttclid` in landing_site (both deterministically TikTok).
 * The new algo correctly credits TikTok with 2 units in that case.
 *
 * # Edge cases
 *
 *   - **No orders data passed** (`orders === undefined`): falls back to the
 *     pre-05.7.9 pure spend-proportional behaviour for backwards compat.
 *     Tests + tools that don't have orders in scope still work unchanged.
 *   - **Single campaign mapped**: deterministic step is unnecessary — that
 *     campaign gets 100% of the product (revenue + units), same as before.
 *   - **Multiple campaigns OF THE SAME PLATFORM mapped to P**: the
 *     deterministic count for that platform is split among those campaigns
 *     by intra-platform spend share (we know the platform but not which
 *     specific campaign within the platform).
 *   - **Deterministic > total**: capped at total. Defensive — shouldn't
 *     happen in practice but guards against attribution double-counts.
 *   - **All campaigns have 0 spend**: deterministic step still runs, then
 *     the remainder splits equally (same as before).
 *   - **Product with no mapped campaigns**: orphan, skipped entirely.
 *
 * `productRevenue` is an iterable of `{ productId, netRevenueCad, units }`
 * already filtered to the store + date range. `orders` is the (optional)
 * order list for the same window, used for the deterministic step.
 */
/** Phase 05.7.9b — allocator output per campaign.
 *
 * `revenue`/`units` are the FULL allocation (deterministic + spend-
 * proportional fallback). Used for ROAS Shopify column + sort.
 *
 * `deterministicRevenue`/`deterministicUnits` are ONLY the deterministic
 * share for this campaign — orders with an explicit platform signal
 * (source='X-paid' OR fbclid/gclid) split among the campaigns of that
 * platform by intra-platform spend. NO fallback included. Used for
 * the "ערך/יח' Shopify · פלטפורמה" columns added per operator request:
 * shows what we can PROVE came from this platform without heuristics.
 */
export type CampaignAllocation = {
  revenue: number;
  units: number;
  deterministicRevenue: number;
  deterministicUnits: number;
};

// Helper: initialize a campaign/ad-set allocation accumulator. Used at every
// out.get() site to keep the deterministic vs full breakdown consistent.
function emptyAlloc(): CampaignAllocation {
  return { revenue: 0, units: 0, deterministicRevenue: 0, deterministicUnits: 0 };
}

/**
 * Core per-product allocation (Steps 1-3) over an arbitrary set of
 * "allocation units". A unit is identified by a key whose 2nd `::`-segment
 * is the platform — TRUE for both 3-segment campaign keys
 * (`store::platform::campaign`) AND 4-segment ad-set keys
 * (`store::platform::campaign::adset`). The algorithm is byte-identical
 * regardless of unit granularity: deterministic per-platform attribution,
 * intra-platform spend-share split, then spend-proportional remainder.
 *
 * Extracted so the legacy campaign-level path and the new ad-set-level path
 * share ONE implementation — guaranteeing the campaign path is unchanged.
 *
 * Mutates `out` in place (keyed by unit key).
 */
function allocateProductToUnits(args: {
  product: { productId: string; netRevenueCad: number; units: number };
  unitKeys: string[];
  unitSpend: Map<string, number>;
  storeOrders: AllocatorOrder[] | null;
  out: Map<string, CampaignAllocation>;
}): void {
  const { product: p, unitKeys: mappedKeys, unitSpend: campaignSpend, storeOrders, out } = args;
  {
    // ── Step 1: deterministic per-platform attribution ──────────────────
    // Walk orders containing this product; for each order with a platform
    // signal, sum the product's lineItems units + revenueCad into the
    // platform's bucket. Caps at total to defend against attribution
    // double-counts (shouldn't happen but safer than allocating > 100%).
    const detByPlatform: Record<
      'Meta' | 'Google' | 'TikTok',
      { revenue: number; units: number }
    > = {
      Meta: { revenue: 0, units: 0 },
      Google: { revenue: 0, units: 0 },
      TikTok: { revenue: 0, units: 0 },
    };
    if (storeOrders) {
      for (const o of storeOrders) {
        const platform = classifyOrderToPlatform(o);
        if (!platform) continue;
        for (const li of o.lineItems) {
          if (li.productId !== p.productId) continue;
          detByPlatform[platform].revenue += li.revenueCad;
          detByPlatform[platform].units += li.units;
        }
      }
      // Cap each platform at the product's Shopify totals — guards against
      // attribution double-counting (e.g., a single order tagged twice).
      //
      // Audit fix 2026-05-23 (HI-03/CR-01 revenue): only apply the revenue
      // cap when `p.netRevenueCad >= 0`. When net is negative (refund-heavy
      // product), the original cap converted a positive deterministic
      // value into a negative one ($100 capped at $-500 → -$500) AND broke
      // the units/revenue symmetry (cap of revenue was directional, cap
      // of units was magnitude). For negative-net rows the deterministic
      // contribution stands; the negative remainder distribution below
      // pulls all mapped campaigns down proportionally.
      for (const k of ['Meta', 'Google', 'TikTok'] as const) {
        if (p.netRevenueCad >= 0 && detByPlatform[k].revenue > p.netRevenueCad) {
          detByPlatform[k].revenue = p.netRevenueCad;
        }
        // Units always non-negative — cap unconditionally.
        if (detByPlatform[k].units > p.units) {
          detByPlatform[k].units = p.units;
        }
      }
      // Also cap the SUM across platforms at the product's totals (rare
      // edge case — an order classified to multiple platforms shouldn't
      // happen given the priority chain, but defend in depth).
      const sumDetRev =
        detByPlatform.Meta.revenue +
        detByPlatform.Google.revenue +
        detByPlatform.TikTok.revenue;
      const sumDetUnits =
        detByPlatform.Meta.units +
        detByPlatform.Google.units +
        detByPlatform.TikTok.units;
      // Same `p.netRevenueCad >= 0` gate as the per-platform cap above.
      if (p.netRevenueCad >= 0 && sumDetRev > p.netRevenueCad && sumDetRev > 0) {
        const ratio = p.netRevenueCad / sumDetRev;
        detByPlatform.Meta.revenue *= ratio;
        detByPlatform.Google.revenue *= ratio;
        detByPlatform.TikTok.revenue *= ratio;
      }
      if (sumDetUnits > p.units && sumDetUnits > 0) {
        const ratio = p.units / sumDetUnits;
        detByPlatform.Meta.units *= ratio;
        detByPlatform.Google.units *= ratio;
        detByPlatform.TikTok.units *= ratio;
      }
    }

    // ── Step 2: split each platform's deterministic total among that
    //           platform's mapped campaigns (intra-platform spend share) ──
    const keysByPlatform: Record<'Meta' | 'Google' | 'TikTok', string[]> = {
      Meta: [],
      Google: [],
      TikTok: [],
    };
    for (const k of mappedKeys) {
      // campaignKey format: storeId::platform::campaignId
      const parts = k.split('::');
      const platform = parts[1] as 'Meta' | 'Google' | 'TikTok' | undefined;
      if (platform && platform in keysByPlatform) {
        keysByPlatform[platform].push(k);
      }
    }
    for (const platform of ['Meta', 'Google', 'TikTok'] as const) {
      const platformKeys = keysByPlatform[platform];
      const det = detByPlatform[platform];
      if (platformKeys.length === 0) {
        // No campaign of this platform is mapped — the deterministic count
        // for this platform has no campaign to credit. It still came out
        // of total, so we leave it as a residual that the fallback step
        // (Step 3) will redistribute. Concretely we zero it here so it
        // joins the unattributed pool.
        detByPlatform[platform] = { revenue: 0, units: 0 };
        continue;
      }
      if (det.revenue === 0 && det.units === 0) continue;
      const intraSpends = platformKeys.map(k => campaignSpend.get(k) ?? 0);
      const intraTotal = intraSpends.reduce((s, x) => s + x, 0);
      for (let i = 0; i < platformKeys.length; i++) {
        const share =
          intraTotal > 0
            ? intraSpends[i] / intraTotal
            : 1 / platformKeys.length;
        const cur = out.get(platformKeys[i]) ?? emptyAlloc();
        // Deterministic contribution goes into BOTH the full allocation
        // (used for ROAS Shopify + sort) AND the deterministic-only bucket
        // (used for the new per-platform Shopify columns).
        const detRevShare = det.revenue * share;
        const detUnitsShare = det.units * share;
        cur.revenue += detRevShare;
        cur.units += detUnitsShare;
        cur.deterministicRevenue += detRevShare;
        cur.deterministicUnits += detUnitsShare;
        out.set(platformKeys[i], cur);
      }
    }

    // ── Step 3: split the unattributed remainder by spend share across
    //           ALL mapped campaigns (the original algorithm, now scoped
    //           to the "unsignaled" pool) ──
    const totalDetRev =
      detByPlatform.Meta.revenue +
      detByPlatform.Google.revenue +
      detByPlatform.TikTok.revenue;
    const totalDetUnits =
      detByPlatform.Meta.units +
      detByPlatform.Google.units +
      detByPlatform.TikTok.units;
    // Audit fix 2026-05-23 (CR-01 revenue): drop the `Math.max(0, ...)`
    // clamp on remainder revenue. The clamp silently absorbed negative
    // remainder — when deterministic attribution exceeded the product's
    // net (refund-heavy product), the negative correction never got
    // distributed and ROAS Shopify silently over-reported. Now the
    // negative remainder pulls all mapped campaigns down proportionally,
    // which is mass-conserving + the operator-correct semantic.
    //
    // Units stays `Math.max(0, ...)` because products_daily.units is
    // always non-negative (refund algorithm deducts only revenue, never
    // units — gap-closure-08 invariant).
    const remRev = p.netRevenueCad - totalDetRev;
    const remUnits = Math.max(0, p.units - totalDetUnits);
    if (remRev !== 0 || remUnits > 0) {
      const spendsForProduct = mappedKeys.map(k => campaignSpend.get(k) ?? 0);
      const totalSpend = spendsForProduct.reduce((s, x) => s + x, 0);
      for (let i = 0; i < mappedKeys.length; i++) {
        const k = mappedKeys[i];
        const share =
          totalSpend > 0
            ? spendsForProduct[i] / totalSpend
            : 1 / mappedKeys.length;
        const cur = out.get(k) ?? emptyAlloc();
        // Fallback contribution: NOT deterministic, so it only updates
        // the full revenue/units fields, NOT the deterministic-only ones.
        // Negative remRev correctly subtracts from cur.revenue.
        cur.revenue += remRev * share;
        cur.units += remUnits * share;
        out.set(k, cur);
      }
    }
  }
}

/** Drop the ad-set segment of a 4-segment key to recover the 3-segment
 *  campaign key. Returns the key unchanged when it is not 4-segment. */
function campaignKeyFromAdSetKey(adSetKeyStr: string): string {
  const parts = adSetKeyStr.split('::');
  if (parts.length !== 4) return adSetKeyStr;
  return parts.slice(0, 3).join('::');
}

export function allocateProductRevenue(args: {
  storeId: string;
  map: ProductMap;
  productRevenue: Array<{ productId: string; netRevenueCad: number; units: number }>;
  campaignSpend: Map<string, number>; // campaignKey → spend in range
  /** Phase 05.7.9 — orders for the same (storeId, date range). When
   *  provided, the allocator uses deterministic per-platform attribution
   *  before falling back to spend-proportional split. Optional for
   *  backwards compat with tests + callers that don't have orders. */
  orders?: AllocatorOrder[];
  /**
   * Ad-set-level allocation (data layer 2026-06-23). Per-ad-set spend keyed
   * by `adSetKey(store, platform, campaign, adSet)`. When provided AND the
   * map contains at least one 4-segment ad-set entry for this store, the
   * allocation UNIT becomes the ad-set instead of the campaign:
   *   - each ad-set resolves its products via `readProductsForAdSet`
   *     (ad-set own mapping OVERRIDES the campaign mapping; unmapped ad-sets
   *     inherit the campaign mapping);
   *   - the deterministic-first + spend-proportional algorithm runs at
   *     ad-set granularity;
   *   - results are then rolled UP to campaign keys so the returned contract
   *     (`Map<campaignKey, CampaignAllocation>`) is unchanged for callers.
   *
   * CRITICAL no-regression guarantee: when NO 4-segment ad-set entry exists
   * for the store (the current production world), this param is IGNORED and
   * the legacy campaign-level path runs unchanged — output is byte-identical.
   */
  adSetSpend?: Map<string, number>;
  /** When true (and the ad-set path is active), the returned map ALSO carries
   *  the per-ad-set allocations under their 4-segment keys, in addition to the
   *  rolled-up campaign keys. Default false — only the rolled-up campaign keys
   *  are emitted, preserving the legacy contract. */
  emitAdSetKeys?: boolean;
}): Map<string, CampaignAllocation> {
  const { storeId, map, productRevenue, campaignSpend, orders, adSetSpend, emitAdSetKeys } = args;
  const out = new Map<string, CampaignAllocation>();

  // Pre-filter orders to the store once. Cheap O(N) — used per product.
  const storeOrders = orders
    ? orders.filter(o => o.storeId === storeId)
    : null;

  const storePrefix = `${storeId}::`;
  // Detect whether ANY 4-segment ad-set entry exists for this store. Only
  // then do we engage the ad-set path — otherwise the legacy campaign path
  // is byte-identical.
  const hasAdSetMappings =
    !!adSetSpend &&
    Object.keys(map).some(
      k => k.startsWith(storePrefix) && k.split('::').length === 4,
    );

  if (!hasAdSetMappings) {
    // ── Legacy campaign-level path (UNCHANGED) ──────────────────────────
    for (const p of productRevenue) {
      if (!p.productId) continue;
      // Audit fix 2026-05-23 (CR-03 revenue): only skip genuinely empty rows.
      if (p.netRevenueCad === 0 && p.units === 0) continue;
      const mappedKeys = campaignsForProductInStore(storeId, p.productId, map);
      if (mappedKeys.length === 0) continue; // orphan — skip
      allocateProductToUnits({
        product: p,
        unitKeys: mappedKeys,
        unitSpend: campaignSpend,
        storeOrders,
        out,
      });
    }
    return out;
  }

  // ── Ad-set-level path ─────────────────────────────────────────────────
  // Build the universe of ad-set keys for this store from BOTH the spend map
  // (every ad-set that spent in range) AND the map's 4-segment entries (an
  // ad-set may be remapped even with zero spend). This mirrors the legacy
  // path's reliance on the map for membership.
  const adSetUniverse = new Set<string>();
  for (const k of adSetSpend!.keys()) {
    if (k.startsWith(storePrefix) && k.split('::').length === 4) adSetUniverse.add(k);
  }
  for (const k of Object.keys(map)) {
    if (k.startsWith(storePrefix) && k.split('::').length === 4) adSetUniverse.add(k);
  }

  // Resolve, once, each ad-set's effective product list (own mapping →
  // overrides; else campaign mapping; else []). Index ad-sets by productId so
  // the per-product loop can pick the units in O(1).
  const adSetsByProduct = new Map<string, string[]>();
  for (const asKey of adSetUniverse) {
    const parts = asKey.split('::'); // store, platform, campaign, adSet
    const products = readProductsForAdSet(parts[0], parts[1], parts[2], parts[3], map);
    for (const pid of products) {
      if (!adSetsByProduct.has(pid)) adSetsByProduct.set(pid, []);
      adSetsByProduct.get(pid)!.push(asKey);
    }
  }

  // Allocate per product at AD-SET granularity into a private map, then roll
  // up to campaign keys for the returned contract.
  const adSetOut = new Map<string, CampaignAllocation>();
  for (const p of productRevenue) {
    if (!p.productId) continue;
    if (p.netRevenueCad === 0 && p.units === 0) continue;
    const unitKeys = adSetsByProduct.get(p.productId) ?? [];
    if (unitKeys.length === 0) continue; // orphan — no ad-set promotes it
    allocateProductToUnits({
      product: p,
      unitKeys,
      unitSpend: adSetSpend!,
      storeOrders,
      out: adSetOut,
    });
  }

  // Roll up ad-set allocations to campaign keys (sum). Mass is conserved —
  // each ad-set's contribution lands in exactly one campaign bucket.
  for (const [asKey, alloc] of adSetOut.entries()) {
    const cKey = campaignKeyFromAdSetKey(asKey);
    const cur = out.get(cKey) ?? emptyAlloc();
    cur.revenue += alloc.revenue;
    cur.units += alloc.units;
    cur.deterministicRevenue += alloc.deterministicRevenue;
    cur.deterministicUnits += alloc.deterministicUnits;
    out.set(cKey, cur);
    if (emitAdSetKeys) out.set(asKey, alloc);
  }

  return out;
}
