/**
 * aiReportAov.test.ts — 2026-06-09 (Task 4)
 *
 * The AI report's summary AOV must match every dashboard surface: GROSS
 * revenue ÷ DISTINCT orders. The old `revenue(net) / Σ products_daily.orders`
 * was wrong on both axes — net numerator + a denominator that double-counts a
 * multi-product order.
 */
import { describe, expect, it } from 'vitest';
import { generateAiReport } from '@/lib/aiReport';
import type { DailyRow } from '@/lib/types';
import type { ProductRow } from '@/lib/products';
import type { OrderAttributionRow } from '@/lib/ordersAttribution';

const STORE_ID = 'uzoshop';
const STORE_NAME = 'uzoshop';
const RANGE = { from: '2026-06-01', to: '2026-06-09' };

function makeDaily(o: Partial<DailyRow> = {}): DailyRow {
  return {
    date: '2026-06-05', storeId: STORE_ID, storeName: STORE_NAME,
    fbSpend: 100, gaSpend: 0, ttSpend: 0, totalSpend: 100,
    revenue: 900, roas: 9, grossProfit: 800, cogs: 100, netProfit: 700,
    hasCogs: true, grossRevenue: 1000, refundDeduction: null,
    fbImpressions: null, gaImpressions: null, ttImpressions: null, ...o,
  };
}
function makeProduct(o: Partial<ProductRow>): ProductRow {
  return {
    date: '2026-06-05', storeId: STORE_ID, storeName: STORE_NAME,
    productId: 'p1', productTitle: 'P1', units: 1, orders: 1,
    revenue: 500, netRevenue: 450, ...o,
  };
}
function makeOrder(o: Partial<OrderAttributionRow>): OrderAttributionRow {
  return {
    date: '2026-06-05', storeId: STORE_ID, storeName: STORE_NAME, orderId: 'o1',
    totalCad: 1000, source: 'direct', utmSource: '', utmMedium: '', utmCampaign: '',
    utmContent: '', fbclidPresent: false, gclidPresent: false, referringSite: '',
    utmId: '', utmTerm: '', lineItems: [], customerId: 'c1',
    orderCreatedAt: '2026-06-05T12:00:00-04:00', isFirstOrder: true,
    firstTouchSource: null, firstFbclidPresent: false, firstGclidPresent: false,
    firstTtclidPresent: false, firstUtmSource: null, firstUtmMedium: null,
    firstUtmCampaign: null, firstUtmContent: null, firstUtmId: null,
    firstUtmTerm: null, firstSeenAt: null, paymentGateway: null, ...o,
  };
}

function summaryBlock(md: string): string {
  const i = md.indexOf('## תקציר ביצועים');
  if (i < 0) return '';
  const after = md.slice(i); const n = after.indexOf('\n## ', 1);
  return n > -1 ? after.slice(0, n) : after;
}

describe('aiReport AOV (Task 4 — gross ÷ distinct orders)', () => {
  it('uses gross revenue and the DISTINCT order count, not net ÷ product-summed orders', () => {
    // ONE distinct order containing TWO products → Σ products_daily.orders = 2,
    // distinct orders = 1. gross = 1000, net = 900.
    const md = generateAiReport({
      storeName: STORE_NAME, storeId: STORE_ID, range: RANGE,
      dailyRows: [makeDaily({})],
      productRows: [
        makeProduct({ productId: 'p1', productTitle: 'P1', orders: 1 }),
        makeProduct({ productId: 'p2', productTitle: 'P2', orders: 1 }),
      ],
      campaignRows: [],
      ordersRows: [makeOrder({ orderId: 'o1' })], // 1 distinct order
      adsRows: [],
    });
    const block = summaryBlock(md);
    // AOV = gross(1000) / distinct(1) = CAD 1,000 — NOT net(900)/2 = CAD 450.
    expect(block).toMatch(/AOV.*CAD 1,000/);
    expect(block).not.toMatch(/AOV.*CAD 450/);
  });
});
