import { describe, it, expect } from 'vitest';
import { ordersAttributionRowKeys } from '@/inngest/functions/cronDaily';

// Phase 0 (2026-06-02) — dual-write drift guard. cronDaily and cronLive
// both UPSERT into orders_attribution; if their column sets ever diverge,
// one path silently drops a field (e.g. a new attribution column added to
// only one writer). We pin a single canonical key set both maps consume.
//
// The cronLive upsert map is built from the SAME exported helper, so this
// test reading the helper once is sufficient: the source contract is that
// neither writer hand-rolls its own object literal.
describe('orders_attribution dual-write key parity', () => {
  it('exposes the exact canonical column set written to orders_attribution', () => {
    expect(ordersAttributionRowKeys().sort()).toEqual(
      [
        'store_id',
        'order_id',
        'date',
        'total_cad',
        'source',
        'utm_source',
        'utm_medium',
        'utm_campaign',
        'utm_content',
        'fbclid_present',
        'gclid_present',
        'referrer',
        'utm_id',
        'utm_term',
        'line_items',
        // Phase 3 (2026-06-02) — new-vs-returning columns (dual-written by
        // both cronDaily + cronLive via the shared toOrdersAttributionRow
        // mapper). is_first_order itself is owned by the recompute RPC, not
        // the writers — so it is NOT in this writer key set.
        'customer_id',
        'order_created_at',
        // Phase 4 (2026-06-02) — first-click lens columns (additive, migration
        // 20260603090000). Dual-written by both maps via the same mapper.
        // NULL = "no first-click signal" (NOT 'direct'); read-only toward ad
        // platforms (Shopify cart attributes only).
        'first_touch_source',
        'first_fbclid_present',
        'first_gclid_present',
        'first_ttclid_present',
        'first_utm_source',
        'first_utm_medium',
        'first_utm_campaign',
        'first_utm_content',
        'first_utm_id',
        'first_utm_term',
        'first_seen_at',
      ].sort(),
    );
  });

  it('cronLive imports and reuses the same helper (no independent literal)', async () => {
    // Static guarantee: cronLive must import the helper. We assert the
    // module source references it so a future hand-rolled literal regresses.
    const fs = await import('node:fs');
    const src = fs.readFileSync(
      new URL('../cronLive.ts', import.meta.url),
      'utf8',
    );
    expect(src).toMatch(/ordersAttributionRowKeys|toOrdersAttributionRow/);
  });
});
