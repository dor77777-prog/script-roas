/**
 * Deterministic data fixtures for attribution tests.
 * Pure factories — no side effects, no IO.
 * All overrides use shallow merge: { ...defaults, ...overrides }
 */

import type { OrderAttributionRow, OrderLineItem } from '@/lib/ordersAttribution';
import type { AttributionAnalysis } from '@/lib/attributionAnalysis';

// Re-export types for convenience in tests
export type { OrderAttributionRow, OrderLineItem, AttributionAnalysis };

// ============================================================================
// Order factory
// ============================================================================

export function makeOrder(overrides: Partial<OrderAttributionRow> = {}): OrderAttributionRow {
  return {
    date: '2026-05-15',
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    orderId: 'o-1',
    totalCad: 100,
    source: 'meta-paid',
    utmSource: 'facebook',
    utmMedium: 'cpc',
    utmCampaign: 'Summer Sale',
    utmContent: 'ad-1',
    fbclidPresent: true,
    gclidPresent: false,
    referringSite: '',
    utmId: 'camp-1',
    utmTerm: 'adset-1',
    lineItems: [],
    customerId: 'cust-1',
    orderCreatedAt: '2026-05-15T12:00:00-04:00',
    isFirstOrder: true,
    // Phase 4 — first-click lens defaults (no first-click signal).
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
    paymentGateway: null,
    ...overrides,
  };
}

// ============================================================================
// Campaign factory
// ============================================================================

export function makeCampaign(overrides: Partial<{
  campaignName: string;
  campaignId: string;
  storeId: string;
  platform: string;
  metaClaim: number;
  spend: number;
}> = {}) {
  return {
    campaignName: 'Summer Sale',
    campaignId: 'camp-1',
    storeId: 'uzoshop',
    platform: 'Meta',
    metaClaim: 500,
    spend: 200,
    ...overrides,
  };
}

// ============================================================================
// Ad-set factory
// ============================================================================

export function makeAdSet(overrides: Partial<{
  adSetId: string;
  adSetName: string;
  storeId: string;
  platform: string;
  metaClaim: number;
  spend: number;
}> = {}) {
  return {
    adSetId: 'adset-1',
    adSetName: 'Ad Set 1',
    storeId: 'uzoshop',
    platform: 'Meta',
    metaClaim: 500,
    spend: 200,
    ...overrides,
  };
}

// ============================================================================
// Ad factory
// ============================================================================

export function makeAd(overrides: Partial<{
  adId: string;
  adName: string;
  storeId: string;
  platform: string;
  metaClaim: number;
  spend: number;
}> = {}) {
  return {
    adId: 'ad-1',
    adName: 'Ad 1',
    storeId: 'uzoshop',
    platform: 'Meta',
    metaClaim: 500,
    spend: 200,
    ...overrides,
  };
}

// ============================================================================
// Line-item factory
// ============================================================================

export function makeLineItem(overrides: Partial<OrderLineItem> = {}): OrderLineItem {
  return {
    productId: 'p-1',
    units: 1,
    revenueCad: 50,
    ...overrides,
  };
}

// ============================================================================
// Daily series helpers
// ============================================================================

/**
 * Generate N consecutive days starting from 2026-05-01.
 * valueFn(dayIdx) returns the numeric value for that day.
 */
export function makeDailySeries(
  days: number,
  valueFn: (idx: number) => number,
): Array<{ date: string; value: number }> {
  const result: Array<{ date: string; value: number }> = [];
  const base = new Date('2026-05-01T00:00:00Z');
  for (let i = 0; i < days; i++) {
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() + i);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    result.push({ date: `${yyyy}-${mm}-${dd}`, value: valueFn(i) });
  }
  return result;
}

/**
 * Return a { dateFrom, dateTo } range in YYYY-MM-DD format.
 */
export function makeDateRange(from: string, to: string): { dateFrom: string; dateTo: string } {
  return { dateFrom: from, dateTo: to };
}
