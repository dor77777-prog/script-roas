/**
 * aiReportGoogleValueTrack.test.ts — 2026-06-09
 *
 * Pins the deterministic-matcher alignment between the AI report
 * (`aiReport.ts`) and the canonical `orderMatchesCampaign`
 * (`attributionAnalysis.ts`).
 *
 * BUG (operator-reported): a Google PMax campaign showed `ROAS Pixel = 2.69`
 * but `Shopify det. = 0` ("אין click-id"), recommending the operator "fix
 * Enhanced Conversions / gclid / URL tracking" — even though the campaign's
 * URL parameters WERE correctly configured.
 *
 * ROOT CAUSE: the report's per-campaign matcher bucketed orders by
 *   - `utm_id` (looked up by campaign.id), and
 *   - `utm_campaign` lowercased (looked up by campaign NAME).
 * Google's ValueTrack tagging flows the *numeric campaign id* into
 * `utm_campaign` (`{campaignid}`), NOT the human-readable name — so the
 * name lookup (`campaign.name.toLowerCase()`) never matched the numeric id
 * bucket, and `det` collapsed to 0. The canonical `orderMatchesCampaign`
 * already handles this (Google path: `utm_id === campaignId` OR
 * `utm_campaign === campaignId`, plus a first-touch fallback). These tests
 * pin the report onto that single source of truth.
 */

import { describe, expect, it } from 'vitest';
import { generateAiReport } from '@/lib/aiReport';
import type { DailyRow } from '@/lib/types';
import type { CampaignRow } from '@/lib/campaigns';
import type { OrderAttributionRow } from '@/lib/ordersAttribution';

const STORE_ID = 'uzoshop';
const STORE_NAME = 'uzoshop';
const RANGE = { from: '2026-05-01', to: '2026-05-31' };

function makeDaily(overrides: Partial<DailyRow>): DailyRow {
  return {
    date: '2026-05-15',
    storeId: STORE_ID,
    storeName: STORE_NAME,
    fbSpend: 0,
    gaSpend: 100,
    ttSpend: 0,
    totalSpend: 100,
    revenue: 500,
    roas: 5,
    grossProfit: 400,
    cogs: 100,
    netProfit: 300,
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
    storeId: STORE_ID,
    storeName: STORE_NAME,
    platform: 'Google',
    campaignId: '1234567890',
    campaignName: 'PMax — Brand',
    adSetId: '',
    adSetName: '',
    spend: 100,
    impressions: 5000,
    clicks: 200,
    conversions: 5,
    conversionValue: 269, // ROAS Pixel = 2.69
    campaignBudgetCad: null,
    adSetBudgetCad: null,
    budgetType: '',
    effectiveStatus: 'ENABLED',
    regConfiguredStatus: null,
    regEffectiveStatus: null,
    regDeliveryStatus: null,
    regFirstSeenAt: null,
    regStatusChangedAt: null,
    regLastStatusSuccessAt: null,
    ...overrides,
  };
}

function makeOrder(overrides: Partial<OrderAttributionRow>): OrderAttributionRow {
  return {
    date: '2026-05-15',
    storeId: STORE_ID,
    storeName: STORE_NAME,
    orderId: 'o-default',
    totalCad: 100,
    source: 'google-paid',
    utmSource: 'google',
    utmMedium: 'cpc',
    utmCampaign: '1234567890', // ValueTrack {campaignid} — the NUMERIC id, not the name
    utmContent: '',
    fbclidPresent: false,
    gclidPresent: true,
    referringSite: '',
    utmId: '', // PMax often leaves utm_id empty; the id rides in utm_campaign
    utmTerm: '',
    lineItems: [],
    customerId: 'cust-default',
    orderCreatedAt: '2026-05-15T12:00:00-04:00',
    isFirstOrder: true,
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

/** Extract the Pixel↔Shopify comparison row for a campaign name. */
function pxRow(md: string, campaignName: string): string | null {
  const idx = md.indexOf('השוואת ROAS לקמפיין — Pixel ↔ Shopify');
  if (idx < 0) return null;
  const after = md.slice(idx);
  const next = after.indexOf('\n## ', 1);
  const section = next > -1 ? after.slice(0, next) : after;
  return (
    section.split('\n').find(l => l.startsWith('| ') && l.includes(campaignName)) ?? null
  );
}

describe('aiReport — Google ValueTrack deterministic matching', () => {
  it('matches a Google order whose ValueTrack campaign id rides in utm_campaign (det > 0, not "אין click-id")', () => {
    const md = generateAiReport({
      storeName: STORE_NAME,
      storeId: STORE_ID,
      range: RANGE,
      dailyRows: [makeDaily({})],
      productRows: [],
      campaignRows: [makeCampaign({})],
      ordersRows: [makeOrder({ orderId: 'o-g1', totalCad: 269 })],
      adsRows: [],
    });

    const row = pxRow(md, 'PMax — Brand');
    expect(row).toBeTruthy();
    // Deterministic revenue must equal the matched order (269), NOT 0.
    expect(row!).toMatch(/CAD 269/);
    // The false "no click-id" verdict must NOT appear for this campaign.
    expect(row!).not.toMatch(/אין click-id/);
    // Verdict must name the platform correctly — never hardcoded "Meta".
    expect(row!).not.toMatch(/Meta/);
  });

  it('falls back to first-touch when the converting session carried no campaign signal', () => {
    const md = generateAiReport({
      storeName: STORE_NAME,
      storeId: STORE_ID,
      range: RANGE,
      dailyRows: [makeDaily({})],
      productRows: [],
      campaignRows: [makeCampaign({})],
      ordersRows: [
        makeOrder({
          orderId: 'o-ft',
          totalCad: 150,
          utmCampaign: '', // last-click lost the campaign signal
          utmId: '',
          firstUtmCampaign: '1234567890', // first-touch carried the ValueTrack id
        }),
      ],
      adsRows: [],
    });

    const row = pxRow(md, 'PMax — Brand');
    expect(row).toBeTruthy();
    expect(row!).toMatch(/CAD 150/);
    expect(row!).not.toMatch(/אין click-id/);
  });

  it('a Google over-report verdict names "Google", not "Meta"', () => {
    // Platform claims 269, Shopify det only 100 → platform over-reports.
    const md = generateAiReport({
      storeName: STORE_NAME,
      storeId: STORE_ID,
      range: RANGE,
      dailyRows: [makeDaily({})],
      productRows: [],
      campaignRows: [makeCampaign({ conversionValue: 269 })],
      ordersRows: [
        // 4 small orders so the sample clears the low-n floor (n>=3).
        makeOrder({ orderId: 'g-a', totalCad: 25 }),
        makeOrder({ orderId: 'g-b', totalCad: 25 }),
        makeOrder({ orderId: 'g-c', totalCad: 25 }),
        makeOrder({ orderId: 'g-d', totalCad: 25 }),
      ],
      adsRows: [],
    });

    const row = pxRow(md, 'PMax — Brand');
    expect(row).toBeTruthy();
    expect(row!).toMatch(/Google/);
    expect(row!).not.toMatch(/Meta/);
  });

  it('labels a zero-conversion-both-sides campaign as "אין המרות", never "מאוזן (אמין)"', () => {
    // spend ≥ 50 but platform claims 0 AND no matched Shopify orders (e.g. an
    // awareness/reach campaign). Must NOT fall through to "reliable".
    const md = generateAiReport({
      storeName: STORE_NAME,
      storeId: STORE_ID,
      range: RANGE,
      dailyRows: [makeDaily({})],
      productRows: [],
      campaignRows: [makeCampaign({ conversionValue: 0, spend: 80 })],
      // One unrelated direct order so the Pixel↔Shopify section renders
      // (it is gated on orders.length > 0), but it matches NO campaign.
      ordersRows: [
        makeOrder({ orderId: 'direct-1', source: 'direct', utmSource: '', utmCampaign: '', utmId: '', gclidPresent: false }),
      ],
      adsRows: [],
    });
    const row = pxRow(md, 'PMax — Brand');
    expect(row).toBeTruthy();
    expect(row!).toMatch(/אין המרות/);
    expect(row!).not.toMatch(/מאוזן \(אמין\)/);
  });

  it('flags a tiny (n<3) deterministic sample instead of calling it "מאוזן (אמין)"', () => {
    // Single matched order whose value happens to equal the platform claim
    // (gap ~0) — pre-fix this rendered as "מאוזן (אמין)" on a 1-order sample.
    const md = generateAiReport({
      storeName: STORE_NAME,
      storeId: STORE_ID,
      range: RANGE,
      dailyRows: [makeDaily({})],
      productRows: [],
      campaignRows: [makeCampaign({ conversionValue: 100 })],
      ordersRows: [makeOrder({ orderId: 'g-solo', totalCad: 100 })],
      adsRows: [],
    });

    const row = pxRow(md, 'PMax — Brand');
    expect(row).toBeTruthy();
    // Must surface the small-sample caveat (n=1), not a confident "reliable".
    expect(row!).toMatch(/מדגם קטן/);
    expect(row!).not.toMatch(/מאוזן \(אמין\)/);
  });
});
