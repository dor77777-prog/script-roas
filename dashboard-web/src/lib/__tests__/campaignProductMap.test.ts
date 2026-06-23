import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Tests for the campaignProductMap migration helper.
 *
 * Scope: pins the WR-07 regression — `migrateProductMapKeys` uses an
 * explicit segment-count check instead of the legacy
 * `^[^:]+::[^:]+$` regex, so 2-segment detection is robust to colons
 * inside ids and to malformed empty segments.
 *
 * The shared vitest config uses `environment: 'node'` (no DOM), so we
 * shim a minimal `window.localStorage` + `window.dispatchEvent` here.
 * Adding a jsdom dependency just for this test would violate the
 * documented "DOM tests need a separate vitest config" boundary in
 * dashboard-web/vitest.config.ts.
 */

vi.mock('@/lib/cloudSync', () => ({
  pushCloudKey: vi.fn(),
}));

// Minimal localStorage shim. `window` already exists as a global in many
// node envs; we set it up before importing the module under test so the
// `typeof window === 'undefined'` short-circuits in readProductMap /
// writeProductMap evaluate to `false`.
function installWindowShim() {
  const store = new Map<string, string>();
  (globalThis as any).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    },
    dispatchEvent: () => true,
    // CustomEvent is used by writeProductMap but its return value is
    // ignored — a no-op shim is enough.
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  (globalThis as any).CustomEvent = class {
    constructor(public type: string) {}
  };
}

installWindowShim();

// Import AFTER the shim so the module-level checks see `window`.
const mod = await import('@/lib/campaignProductMap');
const {
  campaignKey,
  migrateProductMapKeys,
  writeProductMap,
  adSetKey,
  setMappedProductsForAdSet,
  readProductsForAdSet,
  readProductMap,
} = mod;
type ProductMap = ReturnType<typeof mod.readProductMap>;

beforeEach(() => {
  ((globalThis as any).window.localStorage as { clear(): void }).clear();
});

describe('migrateProductMapKeys', () => {
  it('WR-07: migrates a legacy 2-segment key when exactly one platform matches the row data', () => {
    writeProductMap({ 'uzoshop::camp-1': ['prod-A'] } as ProductMap);
    const migrated = migrateProductMapKeys({
      rows: [{ storeId: 'uzoshop', campaignId: 'camp-1', platform: 'Meta' }],
    });
    expect(migrated[campaignKey('uzoshop', 'Meta', 'camp-1')]).toEqual(['prod-A']);
    // Legacy key removed.
    expect(migrated['uzoshop::camp-1']).toBeUndefined();
  });

  it('WR-07: skips a 3-segment (already migrated) key — explicit count, no regex false-positive', () => {
    const key3 = campaignKey('uzoshop', 'Meta', 'camp-1'); // "uzoshop::Meta::camp-1"
    writeProductMap({ [key3]: ['prod-A'] } as ProductMap);
    const migrated = migrateProductMapKeys({
      rows: [{ storeId: 'uzoshop', campaignId: 'camp-1', platform: 'Meta' }],
    });
    // 3-seg key untouched.
    expect(migrated[key3]).toEqual(['prod-A']);
  });

  it('WR-07: skips a malformed key with an empty segment ("storeId::" or "::campaignId")', () => {
    // Both halves of the split must be non-empty for migration to proceed.
    writeProductMap({
      'uzoshop::': ['prod-A'],
      '::camp-1': ['prod-B'],
    } as ProductMap);
    const migrated = migrateProductMapKeys({
      rows: [{ storeId: 'uzoshop', campaignId: 'camp-1', platform: 'Meta' }],
    });
    // Both malformed keys stay untouched — defensive against silently
    // mis-attributing a missing-half key to the wrong campaign.
    expect(migrated['uzoshop::']).toEqual(['prod-A']);
    expect(migrated['::camp-1']).toEqual(['prod-B']);
  });

  it('WR-07: preserves a 4+ segment key (defensive — colons in ids should NOT auto-migrate)', () => {
    // Hypothetical future input where a campaignId contained a colon
    // (manual sheet edit, future platform). The legacy regex
    // `^[^:]+::[^:]+$` would silently NOT match this anyway, but the
    // pre-WR-07 fallback used `.split('::')` destructuring which would
    // pick `['foo', '']` for a 3-piece split. Explicit count guards this.
    writeProductMap({ 'foo::bar::Meta::camp-1': ['prod-A'] } as ProductMap);
    const migrated = migrateProductMapKeys({
      rows: [{ storeId: 'foo', campaignId: 'bar::Meta::camp-1', platform: 'Meta' }],
    });
    // Key untouched — segments.length === 4, not 2, so the migrator
    // leaves it alone rather than mis-parsing.
    expect(migrated['foo::bar::Meta::camp-1']).toEqual(['prod-A']);
  });

  it('keeps the legacy key when platform cannot be inferred (no matching rows)', () => {
    writeProductMap({ 'uzoshop::camp-1': ['prod-A'] } as ProductMap);
    // No rows match — platforms set is empty (size !== 1) → kept.
    const migrated = migrateProductMapKeys({ rows: [] });
    expect(migrated['uzoshop::camp-1']).toEqual(['prod-A']);
    expect(migrated[campaignKey('uzoshop', 'Meta', 'camp-1')]).toBeUndefined();
  });

  it('migration is idempotent on re-run (3-seg keys already migrated are skipped)', () => {
    writeProductMap({ 'uzoshop::camp-1': ['prod-A'] } as ProductMap);
    const once = migrateProductMapKeys({
      rows: [{ storeId: 'uzoshop', campaignId: 'camp-1', platform: 'Meta' }],
    });
    // Re-running on the migrated map shouldn't mutate it.
    const twice = migrateProductMapKeys({
      rows: [{ storeId: 'uzoshop', campaignId: 'camp-1', platform: 'Meta' }],
    });
    expect(twice).toEqual(once);
  });

  it('ad-set: leaves a 4-segment ad-set key untouched (not misclassified as legacy 2-seg)', () => {
    // New ad-set keys (storeId::platform::campaignId::adSetId) must coexist
    // with campaign keys in the same map without being migrated/mangled.
    const asKey = adSetKey('uzoshop', 'Meta', 'camp-1', 'as-9');
    writeProductMap({ [asKey]: ['prod-A'] } as ProductMap);
    const migrated = migrateProductMapKeys({
      rows: [{ storeId: 'uzoshop', campaignId: 'camp-1', platform: 'Meta' }],
    });
    expect(migrated[asKey]).toEqual(['prod-A']);
  });
});

// =============================================================================
// Ad-set-level mapping helpers (adSetKey / setMappedProductsForAdSet /
// readProductsForAdSet)
// =============================================================================

describe('adSetKey', () => {
  it('produces a 4-segment key storeId::platform::campaignId::adSetId', () => {
    expect(adSetKey('uzoshop', 'Meta', 'camp-1', 'as-9')).toBe(
      'uzoshop::Meta::camp-1::as-9',
    );
    // The campaign key is the 3-segment prefix of the ad-set key.
    expect(adSetKey('uzoshop', 'Meta', 'camp-1', 'as-9')).toBe(
      `${campaignKey('uzoshop', 'Meta', 'camp-1')}::as-9`,
    );
  });
});

describe('setMappedProductsForAdSet', () => {
  it('writes a 4-segment ad-set entry and dedupes/filters empties', () => {
    const map = setMappedProductsForAdSet('uzoshop', 'Meta', 'camp-1', 'as-9', [
      'prod-A',
      'prod-A',
      '',
      'prod-B',
    ]);
    expect(map[adSetKey('uzoshop', 'Meta', 'camp-1', 'as-9')]).toEqual([
      'prod-A',
      'prod-B',
    ]);
    // Persisted to storage too.
    expect(
      readProductMap()[adSetKey('uzoshop', 'Meta', 'camp-1', 'as-9')],
    ).toEqual(['prod-A', 'prod-B']);
  });

  it('removes the ad-set entry when given an empty product list', () => {
    setMappedProductsForAdSet('uzoshop', 'Meta', 'camp-1', 'as-9', ['prod-A']);
    const map = setMappedProductsForAdSet('uzoshop', 'Meta', 'camp-1', 'as-9', []);
    expect(map[adSetKey('uzoshop', 'Meta', 'camp-1', 'as-9')]).toBeUndefined();
  });

  it('does NOT touch the campaign-level entry for the same campaign', () => {
    writeProductMap({
      [campaignKey('uzoshop', 'Meta', 'camp-1')]: ['camp-prod'],
    } as ProductMap);
    const map = setMappedProductsForAdSet('uzoshop', 'Meta', 'camp-1', 'as-9', [
      'as-prod',
    ]);
    // Campaign entry preserved exactly.
    expect(map[campaignKey('uzoshop', 'Meta', 'camp-1')]).toEqual(['camp-prod']);
    // Ad-set entry added alongside.
    expect(map[adSetKey('uzoshop', 'Meta', 'camp-1', 'as-9')]).toEqual([
      'as-prod',
    ]);
  });
});

describe('readProductsForAdSet — precedence', () => {
  it('returns the ad-set products when an ad-set entry exists (overrides campaign)', () => {
    const map: ProductMap = {
      [campaignKey('uzoshop', 'Meta', 'camp-1')]: ['camp-prod'],
      [adSetKey('uzoshop', 'Meta', 'camp-1', 'as-9')]: ['as-prod'],
    };
    expect(
      readProductsForAdSet('uzoshop', 'Meta', 'camp-1', 'as-9', map),
    ).toEqual(['as-prod']);
  });

  it('falls back to the campaign products when the ad-set has no own entry', () => {
    const map: ProductMap = {
      [campaignKey('uzoshop', 'Meta', 'camp-1')]: ['camp-prod'],
    };
    expect(
      readProductsForAdSet('uzoshop', 'Meta', 'camp-1', 'as-unmapped', map),
    ).toEqual(['camp-prod']);
  });

  it('returns [] when neither the ad-set nor the campaign is mapped', () => {
    expect(
      readProductsForAdSet('uzoshop', 'Meta', 'camp-1', 'as-9', {}),
    ).toEqual([]);
  });
});

// =============================================================================
// allocateProductRevenue — Phase 05.7.9 deterministic-first + spend-fallback
// =============================================================================

const { allocateProductRevenue } = mod;

describe('allocateProductRevenue — deterministic-first attribution (Phase 05.7.9)', () => {
  const STORE = 'uzoshop';
  const PROD = 'prod-A';
  const META_KEY = campaignKey(STORE, 'Meta', 'meta-1');
  const TIKTOK_KEY = campaignKey(STORE, 'TikTok', 'tt-1');

  // Helper: build a minimal allocator order with the product as a single
  // line-item. Keeps tests focused on the algorithm under test.
  function mkOrder(opts: {
    source: string;
    fbclidPresent?: boolean;
    gclidPresent?: boolean;
    units?: number;
    revenue?: number;
  }) {
    return {
      storeId: STORE,
      source: opts.source,
      fbclidPresent: opts.fbclidPresent ?? false,
      gclidPresent: opts.gclidPresent ?? false,
      lineItems: [
        { productId: PROD, units: opts.units ?? 1, revenueCad: opts.revenue ?? 50 },
      ],
    };
  }

  it('falls back to pure spend-proportional when no orders are provided (back-compat)', () => {
    // 2 units total of PROD. Meta has CAD 30 spend, TikTok has CAD 70.
    // Expected (old behaviour): TikTok 70% → 1.4 units; Meta 30% → 0.6.
    const result = allocateProductRevenue({
      storeId: STORE,
      map: { [META_KEY]: [PROD], [TIKTOK_KEY]: [PROD] } as ProductMap,
      productRevenue: [{ productId: PROD, netRevenueCad: 100, units: 2 }],
      campaignSpend: new Map([[META_KEY, 30], [TIKTOK_KEY, 70]]),
      // orders intentionally omitted.
    });
    const tt = result.get(TIKTOK_KEY)!;
    const meta = result.get(META_KEY)!;
    expect(tt.units).toBeCloseTo(1.4, 5);
    expect(meta.units).toBeCloseTo(0.6, 5);
    expect(tt.revenue + meta.revenue).toBeCloseTo(100, 5);
  });

  it('credits TikTok directly when ALL orders have source=tiktok-paid (operator scenario)', () => {
    // 2 units, both deterministically TikTok. Meta gets 0; TikTok gets 2.
    // This is the exact case the operator complained about ("why 1.7 and not 2").
    const orders = [
      mkOrder({ source: 'tiktok-paid', units: 1, revenue: 50 }),
      mkOrder({ source: 'tiktok-paid', units: 1, revenue: 50 }),
    ];
    const result = allocateProductRevenue({
      storeId: STORE,
      map: { [META_KEY]: [PROD], [TIKTOK_KEY]: [PROD] } as ProductMap,
      productRevenue: [{ productId: PROD, netRevenueCad: 100, units: 2 }],
      campaignSpend: new Map([[META_KEY, 30], [TIKTOK_KEY, 70]]),
      orders,
    });
    expect(result.get(TIKTOK_KEY)!.units).toBeCloseTo(2, 5);
    expect(result.get(TIKTOK_KEY)!.revenue).toBeCloseTo(100, 5);
    // Meta gets nothing — no deterministic attribution AND no remainder.
    expect(result.get(META_KEY)?.units ?? 0).toBeCloseTo(0, 5);
  });

  it('mixes deterministic + fallback when some orders are signaled and others direct', () => {
    // 2 units: 1 has ttclid (source=tiktok-paid), 1 is direct (no signal).
    // Det step: TikTok=1. Remainder=1 split by spend (Meta 30, TikTok 70).
    // → TikTok total = 1 + 1*0.7 = 1.7. Meta total = 1*0.3 = 0.3.
    const orders = [
      mkOrder({ source: 'tiktok-paid', units: 1, revenue: 50 }),
      mkOrder({ source: 'direct', units: 1, revenue: 50 }),
    ];
    const result = allocateProductRevenue({
      storeId: STORE,
      map: { [META_KEY]: [PROD], [TIKTOK_KEY]: [PROD] } as ProductMap,
      productRevenue: [{ productId: PROD, netRevenueCad: 100, units: 2 }],
      campaignSpend: new Map([[META_KEY, 30], [TIKTOK_KEY, 70]]),
      orders,
    });
    expect(result.get(TIKTOK_KEY)!.units).toBeCloseTo(1.7, 5);
    expect(result.get(META_KEY)!.units).toBeCloseTo(0.3, 5);
  });

  it('uses fbclidPresent to attribute Meta even when source is not meta-paid', () => {
    // Two orders, both have fbclid → both deterministically Meta.
    const orders = [
      mkOrder({ source: '', fbclidPresent: true, units: 1 }),
      mkOrder({ source: 'direct', fbclidPresent: true, units: 1 }),
    ];
    const result = allocateProductRevenue({
      storeId: STORE,
      map: { [META_KEY]: [PROD], [TIKTOK_KEY]: [PROD] } as ProductMap,
      productRevenue: [{ productId: PROD, netRevenueCad: 100, units: 2 }],
      campaignSpend: new Map([[META_KEY, 30], [TIKTOK_KEY, 70]]),
      orders,
    });
    expect(result.get(META_KEY)!.units).toBeCloseTo(2, 5);
    expect(result.get(TIKTOK_KEY)?.units ?? 0).toBeCloseTo(0, 5);
  });

  it('caps deterministic count at total product units (defense against double-counting)', () => {
    // Total Shopify units = 2, but somehow 3 orders are tagged TikTok
    // (shouldn't happen but the cap must protect against it).
    const orders = [
      mkOrder({ source: 'tiktok-paid', units: 1 }),
      mkOrder({ source: 'tiktok-paid', units: 1 }),
      mkOrder({ source: 'tiktok-paid', units: 1 }),
    ];
    const result = allocateProductRevenue({
      storeId: STORE,
      map: { [META_KEY]: [PROD], [TIKTOK_KEY]: [PROD] } as ProductMap,
      productRevenue: [{ productId: PROD, netRevenueCad: 100, units: 2 }],
      campaignSpend: new Map([[META_KEY, 30], [TIKTOK_KEY, 70]]),
      orders,
    });
    expect(result.get(TIKTOK_KEY)!.units).toBeCloseTo(2, 5);
    expect(result.get(META_KEY)?.units ?? 0).toBeCloseTo(0, 5);
  });

  it('handles a platform deterministic hit when NO campaign of that platform is mapped (sends to fallback)', () => {
    // Order has source=meta-paid but only the TikTok campaign is mapped to
    // this product — there's no Meta campaign to credit, so the unit must
    // not be lost; it falls into the remainder pool and gets allocated by
    // spend share.
    const orders = [
      mkOrder({ source: 'meta-paid', units: 1, revenue: 50 }),
      mkOrder({ source: 'direct', units: 1, revenue: 50 }),
    ];
    const result = allocateProductRevenue({
      storeId: STORE,
      map: { [TIKTOK_KEY]: [PROD] } as ProductMap,
      productRevenue: [{ productId: PROD, netRevenueCad: 100, units: 2 }],
      campaignSpend: new Map([[TIKTOK_KEY, 100]]),
      orders,
    });
    // TikTok gets ALL 2 units (no Meta campaign mapped, so both the
    // meta-paid det and the direct fallback redistribute to TikTok).
    expect(result.get(TIKTOK_KEY)!.units).toBeCloseTo(2, 5);
  });

  it('single mapped campaign gets 100% regardless of order classification', () => {
    // Only TikTok campaign mapped → TikTok gets everything.
    const orders = [
      mkOrder({ source: 'meta-paid', units: 1 }),
      mkOrder({ source: 'google-paid', units: 1 }),
    ];
    const result = allocateProductRevenue({
      storeId: STORE,
      map: { [TIKTOK_KEY]: [PROD] } as ProductMap,
      productRevenue: [{ productId: PROD, netRevenueCad: 100, units: 2 }],
      campaignSpend: new Map([[TIKTOK_KEY, 50]]),
      orders,
    });
    expect(result.get(TIKTOK_KEY)!.units).toBeCloseTo(2, 5);
    expect(result.get(TIKTOK_KEY)!.revenue).toBeCloseTo(100, 5);
  });

  describe('refund-only / negative-net products — locks audit CR-01/CR-03 fix (2026-05-23)', () => {
    it('processes refund-only product (units>0, net<0) instead of dropping it', () => {
      // Scenario: product P sold 5 units day 1 ($500), refunded $700 day 5.
      // Aggregated row: units=5, net=-200.
      // Pre-fix: `<= 0 && <= 0` filter dropped it → ROAS Shopify inflated.
      // Post-fix: row propagates; negative-remainder distribution pulls
      //          Meta's ROAS down accordingly.
      const result = allocateProductRevenue({
        storeId: STORE,
        map: { [META_KEY]: [PROD] } as ProductMap,
        productRevenue: [{ productId: PROD, netRevenueCad: -200, units: 5 }],
        campaignSpend: new Map([[META_KEY, 100]]),
        // No orders — pure fallback path.
      });
      expect(result.has(META_KEY)).toBe(true);
      // Single mapped campaign → gets 100% of the negative remainder.
      expect(result.get(META_KEY)!.revenue).toBeCloseTo(-200, 5);
      expect(result.get(META_KEY)!.units).toBeCloseTo(5, 5);
    });

    it('still drops a true-empty product row (units=0, net=0)', () => {
      // The trimmed filter is `=== 0 && === 0`, not `>= 0 && >= 0`. A
      // genuine zero-zero row should NOT make it into the allocator.
      const result = allocateProductRevenue({
        storeId: STORE,
        map: { [META_KEY]: [PROD] } as ProductMap,
        productRevenue: [{ productId: PROD, netRevenueCad: 0, units: 0 }],
        campaignSpend: new Map([[META_KEY, 100]]),
      });
      expect(result.has(META_KEY)).toBe(false);
    });

    it('distributes negative remainder across cohort by spend share', () => {
      // Multi-campaign cohort. Product net = -300, no deterministic orders.
      // Remainder = -300, split by spend: Meta (100/250) = -120, TikTok (150/250) = -180.
      const result = allocateProductRevenue({
        storeId: STORE,
        map: { [META_KEY]: [PROD], [TIKTOK_KEY]: [PROD] } as ProductMap,
        productRevenue: [{ productId: PROD, netRevenueCad: -300, units: 0 }],
        campaignSpend: new Map([[META_KEY, 100], [TIKTOK_KEY, 150]]),
      });
      expect(result.get(META_KEY)!.revenue).toBeCloseTo(-120, 5);
      expect(result.get(TIKTOK_KEY)!.revenue).toBeCloseTo(-180, 5);
      // Mass conserved: sum of allocations equals product net.
      const sum =
        (result.get(META_KEY)?.revenue ?? 0) +
        (result.get(TIKTOK_KEY)?.revenue ?? 0);
      expect(sum).toBeCloseTo(-300, 5);
    });

    it('preserves positive deterministic when net is negative (skips asymmetric cap)', () => {
      // Product has 1 fbclid order ($50) but $200 refund processed cross-day.
      // Aggregated: units=1, net=-150.
      // Pre-fix: deterministic Meta = $50 → cap at p.net (-150) → -$150 (sign flip!).
      //          Then remainder = max(0, -150 - (-150)) = 0 → never deducted.
      //          Meta ended up at -$150 by accident; units displayed inconsistently.
      // Post-fix: cap gated on p.net >= 0, so deterministic stays $50.
      //           Remainder = -150 - 50 = -200 → split: Meta = -200 (only mapped).
      //           Meta total = +50 - 200 = -150 (matches product net). Mass conserved.
      const orders = [
        mkOrder({ source: 'meta-paid', units: 1, revenue: 50 }),
      ];
      const result = allocateProductRevenue({
        storeId: STORE,
        map: { [META_KEY]: [PROD] } as ProductMap,
        productRevenue: [{ productId: PROD, netRevenueCad: -150, units: 1 }],
        campaignSpend: new Map([[META_KEY, 100]]),
        orders,
      });
      const meta = result.get(META_KEY)!;
      expect(meta.revenue).toBeCloseTo(-150, 5);
      // Deterministic portion stays positive even though full alloc is negative.
      expect(meta.deterministicRevenue).toBeCloseTo(50, 5);
      expect(meta.deterministicUnits).toBeCloseTo(1, 5);
    });
  });
});

// =============================================================================
// allocateProductRevenue — AD-SET-level allocation (precedence + no-regression)
// =============================================================================

describe('allocateProductRevenue — ad-set-level allocation', () => {
  const STORE = 'uzoshop';
  const PROD = 'prod-A';
  const PROD_B = 'prod-B';
  const META_CAMP = campaignKey(STORE, 'Meta', 'meta-1');
  const TIKTOK_CAMP = campaignKey(STORE, 'TikTok', 'tt-1');

  // (a) REGRESSION: when no ad-set-level mappings exist anywhere, supplying
  // adSetSpend must NOT change the campaign-level output vs the legacy call.
  it('REGRESSION: identical campaign-level output when no ad-set mappings exist (adSetSpend ignored)', () => {
    const map = { [META_CAMP]: [PROD], [TIKTOK_CAMP]: [PROD] } as ProductMap;
    const productRevenue = [{ productId: PROD, netRevenueCad: 100, units: 2 }];
    const campaignSpend = new Map([[META_CAMP, 30], [TIKTOK_CAMP, 70]]);
    const orders = [
      {
        storeId: STORE,
        source: 'tiktok-paid',
        fbclidPresent: false,
        gclidPresent: false,
        lineItems: [{ productId: PROD, units: 1, revenueCad: 50 }],
      },
      {
        storeId: STORE,
        source: 'direct',
        fbclidPresent: false,
        gclidPresent: false,
        lineItems: [{ productId: PROD, units: 1, revenueCad: 50 }],
      },
    ];
    const legacy = allocateProductRevenue({
      storeId: STORE, map, productRevenue, campaignSpend, orders,
    });
    const withAdSetSpend = allocateProductRevenue({
      storeId: STORE, map, productRevenue, campaignSpend, orders,
      // Per-ad-set spend supplied, but NO ad-set entries in the map →
      // the campaign-level output must be byte-identical.
      adSetSpend: new Map([
        [adSetKey(STORE, 'Meta', 'meta-1', 'as-m1'), 10],
        [adSetKey(STORE, 'Meta', 'meta-1', 'as-m2'), 20],
        [adSetKey(STORE, 'TikTok', 'tt-1', 'as-t1'), 70],
      ]),
    });
    // Same keys, same numbers.
    expect([...withAdSetSpend.keys()].sort()).toEqual([...legacy.keys()].sort());
    for (const [k, v] of legacy.entries()) {
      const w = withAdSetSpend.get(k)!;
      expect(w.revenue).toBeCloseTo(v.revenue, 9);
      expect(w.units).toBeCloseTo(v.units, 9);
      expect(w.deterministicRevenue).toBeCloseTo(v.deterministicRevenue, 9);
      expect(w.deterministicUnits).toBeCloseTo(v.deterministicUnits, 9);
    }
  });

  // (b) ad-set mapping OVERRIDES the campaign mapping for that ad-set.
  it('ad-set mapping overrides campaign mapping for that ad-set', () => {
    // Campaign meta-1 maps to PROD. Ad-set as-m2 within it is remapped to
    // PROD_B. So PROD is promoted by {as-m1 (inherits camp)} and PROD_B by
    // {as-m2 (own)}. With $40 on as-m1 and $60 on as-m2 (campaign spend $100),
    // PROD's revenue should attribute only to meta-1 via as-m1 ($40 of spend)
    // and PROD_B's revenue only via as-m2.
    const map = {
      [META_CAMP]: [PROD],
      [adSetKey(STORE, 'Meta', 'meta-1', 'as-m2')]: [PROD_B],
    } as ProductMap;
    const result = allocateProductRevenue({
      storeId: STORE,
      map,
      productRevenue: [
        { productId: PROD, netRevenueCad: 100, units: 2 },
        { productId: PROD_B, netRevenueCad: 300, units: 3 },
      ],
      campaignSpend: new Map([[META_CAMP, 100]]),
      adSetSpend: new Map([
        [adSetKey(STORE, 'Meta', 'meta-1', 'as-m1'), 40],
        [adSetKey(STORE, 'Meta', 'meta-1', 'as-m2'), 60],
      ]),
    });
    // Both products' revenue rolls up to the SAME campaign key (meta-1) —
    // the contract returns campaign keys. PROD (100) + PROD_B (300) = 400.
    const meta = result.get(META_CAMP)!;
    expect(meta.revenue).toBeCloseTo(400, 5);
    expect(meta.units).toBeCloseTo(5, 5);
  });

  // (c) MIXED: some ad-sets mapped, others fall back to campaign.
  it('mixed: a remapped ad-set carries its own product; unmapped ad-sets fall back to the campaign', () => {
    // Campaign meta-1 → PROD. Ad-set as-m2 remapped to PROD_B. Two products,
    // each only attributable to its own ad-set's spend within the campaign.
    // The campaign-level rollup nets out: meta-1 gets PROD (via as-m1) + PROD_B
    // (via as-m2). We verify per-ad-set granularity via the ad-set output keys.
    const map = {
      [META_CAMP]: [PROD],
      [adSetKey(STORE, 'Meta', 'meta-1', 'as-m2')]: [PROD_B],
    } as ProductMap;
    const result = allocateProductRevenue({
      storeId: STORE,
      map,
      productRevenue: [
        { productId: PROD, netRevenueCad: 100, units: 2 },
        { productId: PROD_B, netRevenueCad: 300, units: 3 },
      ],
      campaignSpend: new Map([[META_CAMP, 100]]),
      adSetSpend: new Map([
        [adSetKey(STORE, 'Meta', 'meta-1', 'as-m1'), 40],
        [adSetKey(STORE, 'Meta', 'meta-1', 'as-m2'), 60],
      ]),
      // request ad-set-granular output too
      emitAdSetKeys: true,
    });
    const asM1 = result.get(adSetKey(STORE, 'Meta', 'meta-1', 'as-m1'))!;
    const asM2 = result.get(adSetKey(STORE, 'Meta', 'meta-1', 'as-m2'))!;
    // as-m1 inherits campaign mapping (PROD) → gets PROD's 100.
    expect(asM1.revenue).toBeCloseTo(100, 5);
    // as-m2 owns PROD_B → gets PROD_B's 300.
    expect(asM2.revenue).toBeCloseTo(300, 5);
  });

  // (d) NO DOUBLE-COUNT: sum of per-product allocations == total allocatable.
  it('no double-count: campaign rollup sum equals total product revenue', () => {
    const map = {
      [META_CAMP]: [PROD],
      [adSetKey(STORE, 'Meta', 'meta-1', 'as-m2')]: [PROD_B],
    } as ProductMap;
    const result = allocateProductRevenue({
      storeId: STORE,
      map,
      productRevenue: [
        { productId: PROD, netRevenueCad: 100, units: 2 },
        { productId: PROD_B, netRevenueCad: 300, units: 3 },
      ],
      campaignSpend: new Map([[META_CAMP, 100]]),
      adSetSpend: new Map([
        [adSetKey(STORE, 'Meta', 'meta-1', 'as-m1'), 40],
        [adSetKey(STORE, 'Meta', 'meta-1', 'as-m2'), 60],
      ]),
    });
    let sum = 0;
    for (const v of result.values()) sum += v.revenue;
    // Total allocatable = 100 + 300 = 400; no leak, no double-count.
    expect(sum).toBeCloseTo(400, 5);
  });

  // (e) MULTI-PRODUCT RETARGETING: each ad-set → its own product → each
  // ad-set's spend attributes only to its product.
  it('multi-product retargeting campaign: each ad-set attributes its spend to its own product', () => {
    // One campaign, three ad-sets, each remapped to a different product.
    const PROD_C = 'prod-C';
    const asA = adSetKey(STORE, 'Meta', 'meta-1', 'as-A');
    const asB = adSetKey(STORE, 'Meta', 'meta-1', 'as-B');
    const asC = adSetKey(STORE, 'Meta', 'meta-1', 'as-C');
    const map = {
      [asA]: [PROD],
      [asB]: [PROD_B],
      [asC]: [PROD_C],
    } as ProductMap;
    const result = allocateProductRevenue({
      storeId: STORE,
      map,
      productRevenue: [
        { productId: PROD, netRevenueCad: 100, units: 1 },
        { productId: PROD_B, netRevenueCad: 200, units: 2 },
        { productId: PROD_C, netRevenueCad: 300, units: 3 },
      ],
      campaignSpend: new Map([[META_CAMP, 60]]),
      adSetSpend: new Map([[asA, 10], [asB, 20], [asC, 30]]),
      emitAdSetKeys: true,
    });
    expect(result.get(asA)!.revenue).toBeCloseTo(100, 5);
    expect(result.get(asA)!.units).toBeCloseTo(1, 5);
    expect(result.get(asB)!.revenue).toBeCloseTo(200, 5);
    expect(result.get(asB)!.units).toBeCloseTo(2, 5);
    expect(result.get(asC)!.revenue).toBeCloseTo(300, 5);
    expect(result.get(asC)!.units).toBeCloseTo(3, 5);
    // Campaign rollup = full 600, no double-count.
    expect(result.get(META_CAMP)!.revenue).toBeCloseTo(600, 5);
  });

  // Deterministic-first behaviour preserved at ad-set granularity within a
  // single product mapped to ad-sets across platforms.
  it('preserves deterministic-first within ad-set allocation', () => {
    // PROD mapped to a Meta ad-set and a TikTok ad-set. 2 units both
    // tiktok-paid → TikTok ad-set gets both deterministically.
    const metaAs = adSetKey(STORE, 'Meta', 'meta-1', 'as-m1');
    const ttAs = adSetKey(STORE, 'TikTok', 'tt-1', 'as-t1');
    const map = { [metaAs]: [PROD], [ttAs]: [PROD] } as ProductMap;
    const orders = [
      {
        storeId: STORE, source: 'tiktok-paid', fbclidPresent: false,
        gclidPresent: false,
        lineItems: [{ productId: PROD, units: 1, revenueCad: 50 }],
      },
      {
        storeId: STORE, source: 'tiktok-paid', fbclidPresent: false,
        gclidPresent: false,
        lineItems: [{ productId: PROD, units: 1, revenueCad: 50 }],
      },
    ];
    const result = allocateProductRevenue({
      storeId: STORE,
      map,
      productRevenue: [{ productId: PROD, netRevenueCad: 100, units: 2 }],
      campaignSpend: new Map([[META_CAMP, 30], [TIKTOK_CAMP, 70]]),
      adSetSpend: new Map([[metaAs, 30], [ttAs, 70]]),
      orders,
    });
    // Deterministic → TikTok campaign gets all 2 units; Meta gets nothing.
    expect(result.get(TIKTOK_CAMP)!.units).toBeCloseTo(2, 5);
    expect(result.get(TIKTOK_CAMP)!.revenue).toBeCloseTo(100, 5);
    expect(result.get(META_CAMP)?.units ?? 0).toBeCloseTo(0, 5);
  });
});
