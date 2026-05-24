/**
 * aiReportTikTokBudget.test.ts — AUDIT regression (Phase 12.2.1 / 2026-05-24)
 *
 * Pins ALG-02 from `.planning/AUDIT.md` §Phase 12.2 — the
 * 'חלוקת תקציב לפי פלטפורמה' (budget allocation by platform) section in
 * `aiReport.ts` excluded TikTok from `totalSpendAll`:
 *
 *   let metaSpend = 0, googleSpend = 0;
 *   for (const r of daily) { metaSpend += r.fbSpend; googleSpend += r.gaSpend; }
 *   const totalSpendAll = metaSpend + googleSpend;  // TikTok absent
 *
 * Effect on TikTok-heavy stores (e.g. uzoshop with TikTok at 60% of mix):
 *   - Total spend mix appears as "Meta 50% / Google 50%" instead of true
 *     "Meta 20% / Google 20% / TikTok 60%".
 *   - Operator decisions on inter-platform budget shifts are based on a
 *     distorted picture.
 *   - Contradicts every other section in the same report (Per-platform CPM,
 *     Top summary, TikTok deep-dive) which all include TikTok.
 *
 * Evidence pack:
 *   .planning/phases/12-codebase-audit-baseline/raw-returns/lib_algorithm_aiReport.json
 *     (ALG-02 lines 19-27 — failing_input + fix_sketch)
 *
 * Cross-ref: .planning/phases/12-codebase-audit-baseline/12-tests-needed.md
 *   (TikTok-inclusive budget allocation fixture)
 */

import { describe, expect, it } from 'vitest';
import { generateAiReport } from '@/lib/aiReport';
import type { DailyRow } from '@/lib/types';

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
    ttSpend: 0,
    totalSpend: 0,
    revenue: 0,
    roas: 0,
    grossProfit: 0,
    cogs: 0,
    netProfit: 0,
    hasCogs: false,
    grossRevenue: null,
    refundDeduction: null,
    ...overrides,
  };
}

/**
 * Extract the budget-allocation section from the generated markdown, bounded
 * by the next `## ` heading.
 */
function extractBudgetSection(md: string): string {
  const idx = md.indexOf('חלוקת תקציב לפי פלטפורמה');
  if (idx < 0) return '';
  const after = md.slice(idx);
  const nextSectionMatch = after.match(/\n## /);
  return nextSectionMatch ? after.slice(0, nextSectionMatch.index) : after;
}

describe('aiReport TikTok budget allocation (Phase 12.2.1 — ALG-02)', () => {
  // ---------- Test 1: Mixed-platform store — TikTok dominates 60% of spend ----------
  it('TikTok row IS rendered and percentages are computed over fb+ga+tt total', () => {
    // Failing_input from raw-returns: fb=100, ga=100, tt=300, total=500.
    // Expected post-fix: Meta 20% / Google 20% / TikTok 60%.
    // Pre-fix output: Meta 50% / Google 50% (TikTok absent, divisor=200).
    const daily: DailyRow[] = [
      makeDaily({ fbSpend: 100, gaSpend: 100, ttSpend: 300 }),
    ];
    const md = generateAiReport({
      storeName: STORE_NAME,
      storeId: STORE_ID,
      range: RANGE,
      dailyRows: daily,
      productRows: [],
      campaignRows: [],
      ordersRows: [],
      adsRows: [],
    });

    const budgetSection = extractBudgetSection(md);

    // TikTok row MUST be present.
    expect(budgetSection).toMatch(/\| TikTok \|/);
    // Meta row — post-fix: 20% (= 100/500). Pre-fix: 50% (= 100/200).
    expect(budgetSection).toMatch(/\| Meta \| CAD 100 \| 20% \|/);
    // Google row — post-fix: 20%. Pre-fix: 50%.
    expect(budgetSection).toMatch(/\| Google \| CAD 100 \| 20% \|/);
    // TikTok row — post-fix: 60% (= 300/500). Pre-fix: absent.
    expect(budgetSection).toMatch(/\| TikTok \| CAD 300 \| 60% \|/);
  });

  // ---------- Test 2: No TikTok — section gates TikTok row on ttSpend > 0 ----------
  it('TikTok row is NOT rendered when ttSpend is 0 across all daily rows', () => {
    // Per fix_sketch: emit a TikTok row gated on `ttSpend > 0`. A
    // Meta+Google-only store should see only the Meta + Google rows
    // (no empty TikTok row) so the table stays clean.
    const daily: DailyRow[] = [
      makeDaily({ fbSpend: 50, gaSpend: 50, ttSpend: 0 }),
    ];
    const md = generateAiReport({
      storeName: STORE_NAME,
      storeId: STORE_ID,
      range: RANGE,
      dailyRows: daily,
      productRows: [],
      campaignRows: [],
      ordersRows: [],
      adsRows: [],
    });

    const budgetSection = extractBudgetSection(md);
    // Meta + Google rows present with the pre-fix percentages (Meta 50%, Google 50%).
    expect(budgetSection).toMatch(/\| Meta \| CAD 50 \| 50% \|/);
    expect(budgetSection).toMatch(/\| Google \| CAD 50 \| 50% \|/);
    // TikTok row MUST NOT be present.
    expect(budgetSection).not.toMatch(/\| TikTok \|/);
  });

  // ---------- Test 3: Accumulator sums ttSpend across days, not single-row ----------
  it('TikTok ttSpend accumulator sums across multiple daily rows (one day with tt=0, another with tt=200)', () => {
    // Two daily rows: one with tt=0, one with tt=200. Total fb=80,
    // ga=120, tt=200 (sum=400). Post-fix: Meta 20% / Google 30% /
    // TikTok 50%. Pre-fix: Meta 40% / Google 60% (tt absent).
    //
    // Asserts the accumulator pattern (`ttSpend += r.ttSpend ?? 0;`
    // inside the loop) sums correctly across days, not just looks at
    // the first row.
    const daily: DailyRow[] = [
      makeDaily({ date: '2026-05-10', fbSpend: 40, gaSpend: 60, ttSpend: 0 }),
      makeDaily({ date: '2026-05-11', fbSpend: 40, gaSpend: 60, ttSpend: 200 }),
    ];
    const md = generateAiReport({
      storeName: STORE_NAME,
      storeId: STORE_ID,
      range: RANGE,
      dailyRows: daily,
      productRows: [],
      campaignRows: [],
      ordersRows: [],
      adsRows: [],
    });

    const budgetSection = extractBudgetSection(md);
    expect(budgetSection).toMatch(/\| Meta \| CAD 80 \| 20% \|/);
    expect(budgetSection).toMatch(/\| Google \| CAD 120 \| 30% \|/);
    expect(budgetSection).toMatch(/\| TikTok \| CAD 200 \| 50% \|/);
  });
});
