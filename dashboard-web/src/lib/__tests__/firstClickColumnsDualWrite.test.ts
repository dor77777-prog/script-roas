import { describe, it, expect } from 'vitest';
import { toOrdersAttributionRow } from '@/inngest/functions/cronDaily';
import type { ShopifyOrderRow } from '@/lib/fetchers/shopify';

/**
 * Dual-write guard (Phase 4 — first-click lens): BOTH cron maps (cronDaily +
 * cronLive) persist orders_attribution via the shared toOrdersAttributionRow
 * mapper. This pins the exact first_* DB column key-set so the two writers can
 * never drift. The companion parity guard lives in
 * `src/inngest/functions/__tests__/ordersAttributionDualWriteKeys.test.ts`.
 */
function makeRow(overrides: Partial<ShopifyOrderRow> = {}): ShopifyOrderRow {
  return {
    storeId: 'uzoshop',
    orderId: 'o-1',
    date: '2026-06-02',
    totalCad: 100,
    source: 'meta-paid',
    utmSource: 'facebook',
    utmMedium: 'cpc',
    utmCampaign: 'Closer',
    utmContent: 'ad-1',
    fbclidPresent: true,
    gclidPresent: false,
    referrer: '',
    utmId: 'camp-1',
    utmTerm: 'adset-1',
    lineItems: [{ p: 'p-1', u: 1, r: 100 }],
    customerId: 'cust-1',
    createdAt: '2026-06-02T09:00:00.000Z',
    firstTouchSource: 'meta-paid',
    firstFbclidPresent: true,
    firstGclidPresent: false,
    firstTtclidPresent: false,
    firstUtmSource: 'facebook',
    firstUtmMedium: 'cpc',
    firstUtmCampaign: 'Intro',
    firstUtmContent: 'ad-first-1',
    firstUtmId: 'camp-first-1',
    firstUtmTerm: 'adset-first-1',
    firstSeenAt: '2026-06-01T10:00:00.000Z',
    paymentGateway: 'shopify_payments',
    ...overrides,
  };
}

describe('toOrdersAttributionRow — first-click dual-write key-set', () => {
  it('maps every first_* column from the ShopifyOrderRow', () => {
    const db = toOrdersAttributionRow(makeRow());
    expect(db.first_touch_source).toBe('meta-paid');
    expect(db.first_fbclid_present).toBe(true);
    expect(db.first_gclid_present).toBe(false);
    expect(db.first_ttclid_present).toBe(false);
    expect(db.first_utm_source).toBe('facebook');
    expect(db.first_utm_medium).toBe('cpc');
    expect(db.first_utm_campaign).toBe('Intro');
    expect(db.first_utm_content).toBe('ad-first-1');
    expect(db.first_utm_id).toBe('camp-first-1');
    expect(db.first_utm_term).toBe('adset-first-1');
    expect(db.first_seen_at).toBe('2026-06-01T10:00:00.000Z');
  });

  it('still maps the existing last-click + Phase-3 columns (no regression)', () => {
    const db = toOrdersAttributionRow(makeRow());
    expect(db.store_id).toBe('uzoshop');
    expect(db.order_id).toBe('o-1');
    expect(db.source).toBe('meta-paid');
    expect(db.fbclid_present).toBe(true);
    expect(db.utm_id).toBe('camp-1');
    expect(db.line_items).toEqual([{ p: 'p-1', u: 1, r: 100 }]);
    expect(db.customer_id).toBe('cust-1');
    expect(db.order_created_at).toBe('2026-06-02T09:00:00.000Z');
  });

  it('passes NULL first-click through unchanged (no first-click signal)', () => {
    const db = toOrdersAttributionRow(
      makeRow({
        firstTouchSource: null,
        firstFbclidPresent: false,
        firstGclidPresent: false,
        firstTtclidPresent: false,
        firstUtmSource: null,
        firstUtmMedium: null,
        firstUtmCampaign: null,
        firstUtmContent: null,
        firstUtmId: null,
        firstUtmTerm: null,
        firstSeenAt: null,
      }),
    );
    expect(db.first_touch_source).toBeNull();
    expect(db.first_utm_id).toBeNull();
    expect(db.first_seen_at).toBeNull();
  });
});
