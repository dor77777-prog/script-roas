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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).CustomEvent = class {
    constructor(public type: string) {}
  };
}

installWindowShim();

// Import AFTER the shim so the module-level checks see `window`.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mod = await import('@/lib/campaignProductMap');
const { campaignKey, migrateProductMapKeys, writeProductMap } = mod;
type ProductMap = ReturnType<typeof mod.readProductMap>;

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
