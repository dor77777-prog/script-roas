/**
 * aiReportTikTokStatus.test.ts — AUDIT regression (Phase 12.2.1 / 2026-05-24)
 *
 * Pins ALG-01 from `.planning/AUDIT.md` §Phase 12.2 — TikTok status taxonomy
 * in `aiReport.ts` was hard-coded to a single allowlist:
 *
 *   if (p === 'tiktok') return norm !== 'ADGROUP_STATUS_DELIVERY_OK';
 *
 * Evidence pack:
 *   .planning/phases/12-codebase-audit-baseline/raw-returns/lib_algorithm_aiReport.json
 *     (ALG-01 lines 8-16 — failing_input + fix_sketch)
 *
 * Failing input: TikTok campaign with effectiveStatus ∈ {ADGROUP_STATUS_BUDGET_EXCEED,
 *   ADGROUP_STATUS_AUDIT, ADGROUP_STATUS_REVIEWING, ADGROUP_STATUS_NOT_START} — all
 *   of which TikTok considers "active enough" (per platformConfig.TIKTOK_ACTIVE_ENOUGH)
 *   but the pre-fix code flagged as OFF, listing them in 'קמפיינים כבויים כעת' AND
 *   subtracting -30 from Health Score via the operator-adjustment penalty.
 *
 * Symmetry: per AUDIT U-01, `cronLive.isActiveForPlatform` + `postgresReaders`
 * already share the `TIKTOK_ACTIVE_ENOUGH` set. This test pins the FINAL
 * consumer (aiReport) onto the same set so all 3 sides agree.
 *
 * Cross-ref: .planning/phases/12-codebase-audit-baseline/12-tests-needed.md HP-05
 *   (TikTok status matrix fixture).
 */

import { describe, expect, it } from 'vitest';
import { generateAiReport } from '@/lib/aiReport';
import type { DailyRow } from '@/lib/types';
import type { CampaignRow } from '@/lib/campaigns';

const STORE_ID = 'uzoshop';
const STORE_NAME = 'uzoshop';
const RANGE = { from: '2026-05-01', to: '2026-05-31' };

function makeDaily(overrides: Partial<DailyRow>): DailyRow {
  return {
    date: '2026-05-15',
    storeId: STORE_ID,
    storeName: STORE_NAME,
    fbSpend: 0,
    gaSpend: 0,
    ttSpend: 100, // ensure TikTok section is exercised
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
    platform: 'TikTok',
    campaignId: 'tt-c1',
    campaignName: 'TikTok Brand Awareness',
    adSetId: 'tt-as1',
    adSetName: 'TikTok AdSet 1',
    spend: 200,
    impressions: 10000,
    clicks: 250,
    conversions: 5,
    conversionValue: 500,
    campaignBudgetCad: null,
    adSetBudgetCad: null,
    budgetType: '',
    effectiveStatus: 'ADGROUP_STATUS_DELIVERY_OK',
    ...overrides,
  };
}

/**
 * Extract the 'קמפיינים כבויים כעת' (Currently-Off) section from the
 * generated markdown, bounded by the next `## ` heading.
 */
function extractOffSection(md: string): string {
  const offIdx = md.indexOf('קמפיינים כבויים כעת');
  if (offIdx < 0) return '';
  const afterOff = md.slice(offIdx);
  const nextSectionMatch = afterOff.match(/\n## /);
  return nextSectionMatch
    ? afterOff.slice(0, nextSectionMatch.index)
    : afterOff;
}

/**
 * Extract the Health Score table row for a given campaign name. Returns the
 * raw markdown line. Used to assert the operator-adjustment (-30) column.
 */
function extractHealthRow(md: string, campaignName: string): string | null {
  const healthIdx = md.indexOf('Campaign Health Score');
  if (healthIdx < 0) return null;
  const afterHealth = md.slice(healthIdx);
  const nextSectionMatch = afterHealth.match(/\n## /);
  const section = nextSectionMatch
    ? afterHealth.slice(0, nextSectionMatch.index)
    : afterHealth;
  for (const line of section.split('\n')) {
    if (line.startsWith('| ') && line.includes(campaignName) && line.includes('TikTok')) {
      return line;
    }
  }
  return null;
}

describe('aiReport TikTok status taxonomy (Phase 12.2.1 — ALG-01)', () => {
  // ---------- Test 1: BUDGET_EXCEED is NOT off ----------
  it('TikTok campaign with effectiveStatus=ADGROUP_STATUS_BUDGET_EXCEED is NOT listed in Currently-Off', () => {
    // Per platformConfig.TIKTOK_ACTIVE_ENOUGH, BUDGET_EXCEED is the
    // "paused today due to daily cap, resumes tomorrow" state — TikTok
    // Ads Manager still paints it as Active. Pre-fix, aiReport's
    // allowlist (DELIVERY_OK only) treated this as OFF and listed the
    // campaign in 'קמפיינים כבויים כעת'.
    const daily: DailyRow[] = [makeDaily({})];
    const campaigns: CampaignRow[] = [
      makeCampaign({
        effectiveStatus: 'ADGROUP_STATUS_BUDGET_EXCEED',
        campaignName: 'TT Brand BudgetExceed',
      }),
    ];
    const md = generateAiReport({
      storeName: STORE_NAME,
      storeId: STORE_ID,
      range: RANGE,
      dailyRows: daily,
      productRows: [],
      campaignRows: campaigns,
      ordersRows: [],
      adsRows: [],
    });

    const offSection = extractOffSection(md);
    // Post-fix: BUDGET_EXCEED is "active enough" → NOT listed.
    expect(offSection).not.toMatch(/TT Brand BudgetExceed/);
  });

  // ---------- Test 2: DISABLE genuinely off → IS listed ----------
  it('TikTok campaign with effectiveStatus=ADGROUP_STATUS_DISABLE IS listed in Currently-Off', () => {
    // DISABLE is the genuinely-off state (operator paused the ad-group).
    // Both pre-fix and post-fix must list this. Sanity check that the
    // post-fix predicate didn't accidentally widen to include OFF
    // statuses too.
    const daily: DailyRow[] = [makeDaily({})];
    const campaigns: CampaignRow[] = [
      makeCampaign({
        effectiveStatus: 'ADGROUP_STATUS_DISABLE',
        campaignName: 'TT Brand Disabled',
      }),
    ];
    const md = generateAiReport({
      storeName: STORE_NAME,
      storeId: STORE_ID,
      range: RANGE,
      dailyRows: daily,
      productRows: [],
      campaignRows: campaigns,
      ordersRows: [],
      adsRows: [],
    });

    const offSection = extractOffSection(md);
    expect(offSection).toMatch(/TT Brand Disabled/);
  });

  // ---------- Test 3: DELIVERY_OK active → NOT listed ----------
  it('TikTok campaign with effectiveStatus=ADGROUP_STATUS_DELIVERY_OK is NOT listed in Currently-Off', () => {
    // Baseline: the one status the pre-fix allowlist already handled
    // correctly. Asserts post-fix behavior is unchanged for this case.
    const daily: DailyRow[] = [makeDaily({})];
    const campaigns: CampaignRow[] = [
      makeCampaign({
        effectiveStatus: 'ADGROUP_STATUS_DELIVERY_OK',
        campaignName: 'TT Brand Delivering',
      }),
    ];
    const md = generateAiReport({
      storeName: STORE_NAME,
      storeId: STORE_ID,
      range: RANGE,
      dailyRows: daily,
      productRows: [],
      campaignRows: campaigns,
      ordersRows: [],
      adsRows: [],
    });

    const offSection = extractOffSection(md);
    expect(offSection).not.toMatch(/TT Brand Delivering/);
  });

  // ---------- Test 4: Health Score -30 penalty differential ----------
  it('Health Score operator-adjustment column matches isStatusOff predicate: BUDGET_EXCEED gets NO -30 penalty, DISABLE gets -30', () => {
    // Two TikTok campaigns identical except for effectiveStatus.
    // Pre-fix isStatusOff returned TRUE for BOTH (only DELIVERY_OK was
    // active), so both got the -30 operator-adjustment penalty.
    // Post-fix, BUDGET_EXCEED is "active enough" → no penalty, only
    // DISABLE gets -30.
    //
    // We assert this by comparing the operator-adjustment ('אופ׳' column)
    // cell for each campaign's row. Per the rendering code at
    // aiReport.ts:1302-1314, the column value is '—' (em-dash) when
    // operatorAdjustment===0 and '-30' when isCurrentlyOff=true.
    const daily: DailyRow[] = [makeDaily({})];
    const campaigns: CampaignRow[] = [
      makeCampaign({
        campaignId: 'tt-budgetexceed',
        campaignName: 'TT BudgetExceed',
        adSetId: 'as-budgetexceed',
        effectiveStatus: 'ADGROUP_STATUS_BUDGET_EXCEED',
      }),
      makeCampaign({
        campaignId: 'tt-disable',
        campaignName: 'TT Disabled',
        adSetId: 'as-disable',
        effectiveStatus: 'ADGROUP_STATUS_DISABLE',
      }),
    ];
    const md = generateAiReport({
      storeName: STORE_NAME,
      storeId: STORE_ID,
      range: RANGE,
      dailyRows: daily,
      productRows: [],
      campaignRows: campaigns,
      ordersRows: [],
      adsRows: [],
    });

    const budgetRow = extractHealthRow(md, 'TT BudgetExceed');
    const disabledRow = extractHealthRow(md, 'TT Disabled');
    expect(budgetRow).toBeTruthy();
    expect(disabledRow).toBeTruthy();

    // Disabled row MUST contain `-30` operator adjustment (penalty applied).
    expect(disabledRow!).toContain('-30');
    // BudgetExceed row MUST NOT contain `-30` (no penalty, status is active-enough).
    // We check for `| -30 |` specifically because `-30` might appear in
    // other cells (e.g., a profitability sub-component of -30).
    expect(budgetRow!).not.toContain('| -30 |');
  });
});
