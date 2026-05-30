import { describe, expect, it } from 'vitest';
import { generateAiReport } from '@/lib/aiReport';
import type { DailyRow } from '@/lib/types';
import type { ProductRow } from '@/lib/products';
import type { CampaignRow } from '@/lib/campaigns';

/**
 * AUDIT regression (Phase 12.3 / 2026-05-24) — ALG-03 belt-and-suspenders:
 * chronological sort BEFORE the statusByCampaign last-write-wins loop.
 *
 *   Original bug (ALG-03):
 *     aiReport.ts:1384-1388 (post-12.1.2 line numbers) builds a
 *     `statusByCampaign` Map by iterating `for (const c of campaigns)` and
 *     calling `statusByCampaign.set(key, c.effectiveStatus)` on each row.
 *     This is "last write wins" — the latest iterated row's status wins.
 *     12.1.2 (ALG-04) fixed the cross-store collision by scoping the key
 *     with storeId (`${storeId}::${platform}::${campaignId}`), but the
 *     underlying iteration order over `campaigns` is still
 *     INPUT-ORDER-DEPENDENT. When the same (storeId, platform, campaignId)
 *     appears on multiple dates, the report's "Currently Off" section
 *     silently varies based on which fetcher order delivered the rows.
 *
 *   12.3 belt-and-suspenders fix:
 *     Sort campaigns by date ASC before the loop so the chronologically
 *     latest status deterministically wins, regardless of fetcher input
 *     order.
 *
 * Evidence pack:
 *   .planning/phases/12-codebase-audit-baseline/raw-returns/
 *     lib_algorithm_aiReport.json (ALG-03 lines 28-34)
 *
 * Fixture shape — minimum reproduction of the ALG-03 failing_input:
 *   - Single store (uzoshop).
 *   - Single Meta campaign (campaignId='c1', campaignName='Brand').
 *   - Same campaign on TWO dates with DIFFERENT effectiveStatus per row.
 *   - The first two tests vary the input order (out-of-order vs in-order);
 *     assert that the chronologically latest status wins in both cases.
 *   - Test 3 uses a 3-status flip (ACTIVE → PAUSED → ACTIVE) to confirm
 *     latest-wins over multi-step transitions.
 */

function makeDaily(overrides: Partial<DailyRow>): DailyRow {
  return {
    date: '2026-05-15',
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    fbSpend: 100,
    gaSpend: 50,
    ttSpend: 0,
    totalSpend: 150,
    revenue: 1000,
    roas: 6.67,
    grossProfit: 850,
    cogs: 200,
    netProfit: 650,
    hasCogs: true,
    grossRevenue: null,
    refundDeduction: null,
    fbImpressions: null,
    gaImpressions: null,
    ttImpressions: null,
    ...overrides,
  };
}

function makeCampaign(overrides: Partial<CampaignRow>): CampaignRow {
  return {
    date: '2026-05-15',
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    platform: 'Meta',
    campaignId: 'c1',
    campaignName: 'Brand',
    adSetId: 'as1',
    adSetName: 'AdSet 1',
    spend: 75,
    impressions: 5000,
    clicks: 200,
    conversions: 10,
    conversionValue: 400,
    campaignBudgetCad: null,
    adSetBudgetCad: null,
    budgetType: '',
    effectiveStatus: 'ACTIVE',
    regConfiguredStatus: null,
    regEffectiveStatus: null,
    regDeliveryStatus: null,
    regFirstSeenAt: null,
    regStatusChangedAt: null,
    regLastStatusSuccessAt: null,
    ...overrides,
  };
}

function makeProduct(overrides: Partial<ProductRow>): ProductRow {
  return {
    date: '2026-05-15',
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    productId: 'p1',
    productTitle: 'Product 1',
    units: 1,
    orders: 1,
    revenue: 100,
    netRevenue: 80,
    ...overrides,
  };
}

function baseFixture() {
  return {
    daily: [
      makeDaily({ date: '2026-05-01', revenue: 800 }),
      makeDaily({ date: '2026-05-08', revenue: 900 }),
      makeDaily({ date: '2026-05-15', revenue: 1000 }),
    ],
    products: [makeProduct({})],
    range: { from: '2026-05-01', to: '2026-05-15' },
  };
}

function extractOffSection(md: string): string {
  const offIdx = md.indexOf('קמפיינים כבויים כעת');
  if (offIdx === -1) return '';
  const after = md.slice(offIdx);
  const nextSection = after.indexOf('\n## ', 1);
  return nextSection > -1 ? after.slice(0, nextSection) : after;
}

describe('aiReport statusByCampaign chronological sort (Phase 12.3 — ALG-03 belt-and-suspenders)', () => {
  // ---------- Test 1 — OUT-OF-ORDER input; latest-wins must still hold ----------
  it('Test 1: when campaign rows are passed OUT of chronological order, latest-date PAUSED is the status used', () => {
    // Same (storeId='uzoshop', platform='Meta', campaignId='c1') on two
    // dates: row A '2026-05-01' ACTIVE, row B '2026-05-15' PAUSED.
    // The fetcher delivers them OUT of order — row B first, row A second.
    // Pre-fix (no sort): the for-of iteration ends with row A's status,
    // so statusByCampaign[c1] = ACTIVE and the campaign DOES NOT appear
    // in the Currently-Off section. Post-fix (sort by date ASC): the
    // iteration ends with row B (latest), so statusByCampaign[c1] =
    // PAUSED and the campaign DOES appear.
    const f = baseFixture();
    const campaigns: CampaignRow[] = [
      makeCampaign({
        date: '2026-05-15',
        effectiveStatus: 'PAUSED',
        spend: 50,
      }),
      makeCampaign({
        date: '2026-05-01',
        effectiveStatus: 'ACTIVE',
        spend: 75,
      }),
    ];
    const md = generateAiReport({
      storeName: 'uzoshop',
      storeId: 'uzoshop',
      range: f.range,
      dailyRows: f.daily,
      productRows: f.products,
      campaignRows: campaigns,
      ordersRows: [],
      adsRows: [],
    });
    const offSection = extractOffSection(md);
    expect(offSection.length).toBeGreaterThan(0);
    // The Brand campaign must appear with status PAUSED — chronologically latest.
    expect(offSection).toMatch(/Brand/);
    expect(offSection).toMatch(/PAUSED/);
  });

  // ---------- Test 2 — IN-ORDER input; same outcome (sort is order-independent) ----------
  it('Test 2: when campaign rows are passed IN chronological order, latest-date PAUSED is still the status used', () => {
    // Same fixture but in CORRECT chronological order. Confirms the sort
    // is idempotent — the latest-wins contract holds regardless of input
    // order. (Pre-fix this test would happen to pass since input order
    // matches chronological order; it's a parity check with Test 1.)
    const f = baseFixture();
    const campaigns: CampaignRow[] = [
      makeCampaign({
        date: '2026-05-01',
        effectiveStatus: 'ACTIVE',
        spend: 75,
      }),
      makeCampaign({
        date: '2026-05-15',
        effectiveStatus: 'PAUSED',
        spend: 50,
      }),
    ];
    const md = generateAiReport({
      storeName: 'uzoshop',
      storeId: 'uzoshop',
      range: f.range,
      dailyRows: f.daily,
      productRows: f.products,
      campaignRows: campaigns,
      ordersRows: [],
      adsRows: [],
    });
    const offSection = extractOffSection(md);
    expect(offSection.length).toBeGreaterThan(0);
    expect(offSection).toMatch(/Brand/);
    expect(offSection).toMatch(/PAUSED/);
  });

  // ---------- Test 3 — 3-status flip ACTIVE → PAUSED → ACTIVE ----------
  it('Test 3: 3 rows with statuses ACTIVE/PAUSED/ACTIVE on increasing dates — latest ACTIVE wins, NOT listed in Off', () => {
    // Tests that the sort is robust over multi-step transitions. The
    // chronologically latest status is ACTIVE, so Brand campaign MUST
    // NOT appear in the Currently-Off section regardless of input order.
    // Pass in shuffled order (mid date first, latest second, earliest
    // last) to confirm input-order-independence.
    const f = baseFixture();
    const campaigns: CampaignRow[] = [
      makeCampaign({
        date: '2026-05-08',
        effectiveStatus: 'PAUSED',
        spend: 60,
      }),
      makeCampaign({
        date: '2026-05-15',
        effectiveStatus: 'ACTIVE',
        spend: 50,
      }),
      makeCampaign({
        date: '2026-05-01',
        effectiveStatus: 'ACTIVE',
        spend: 75,
      }),
    ];
    const md = generateAiReport({
      storeName: 'uzoshop',
      storeId: 'uzoshop',
      range: f.range,
      dailyRows: f.daily,
      productRows: f.products,
      campaignRows: campaigns,
      ordersRows: [],
      adsRows: [],
    });
    const offSection = extractOffSection(md);
    // If the Currently-Off section exists, Brand must NOT be in it
    // (since latest status is ACTIVE).
    if (offSection.length > 0) {
      // Brand must not appear within a row in the Currently-Off section.
      // Use a row-level check: each campaign row is a single line starting with '| Brand |'.
      const offBrandLines = offSection
        .split('\n')
        .filter((l) => l.startsWith('| Brand |'));
      expect(offBrandLines.length).toBe(0);
    }
  });
});
