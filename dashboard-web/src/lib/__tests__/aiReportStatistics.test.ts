/**
 * aiReportStatistics.test.ts — oracle for the statistical helpers buried
 * inside generateAiReport(). Backfills AUDIT C-01.
 *
 * Why this file exists (per .planning/AUDIT.md surface 9):
 *   ~700 LOC of operator-facing report math had ZERO unit tests before
 *   this fix — only the storeId regex filter was covered. A future change
 *   that bumped the CV thresholds (0.15 / 0.35), flipped the 1.4826 MAD
 *   consistency factor, or rebroke the medianMad even/odd formulas would
 *   ship undetected. This file pins each of those constants by feeding
 *   known-input fixtures through generateAiReport and asserting the
 *   rendered markdown contains the exact numbers + verdict labels.
 *
 * Pure-helper accessibility: medianMad / mean / variance / stddev / cv
 * are NOT exported from aiReport.ts — they live inside generateAiReport's
 * closure. We exercise them indirectly via the rendered output:
 *   - CPM volatility table (cv / mean / stddev / min / max)
 *   - Anomaly days table (medianMad + robust z-score with the
 *     1.4826 consistency factor)
 *
 * Each test designs fixtures whose statistic values are HAND-COMPUTED so
 * the assertion is a true oracle, not just a regression pin.
 */

import { describe, it, expect } from 'vitest';
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
    platform: 'Meta',
    campaignId: 'c1',
    campaignName: 'Campaign 1',
    adSetId: 'as1',
    adSetName: 'AdSet 1',
    spend: 0,
    impressions: 0,
    clicks: 0,
    conversions: 0,
    conversionValue: 0,
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

/**
 * Build N campaign rows (one per date) for a given platform whose daily
 * CPM (spend/imps * 1000) equals each entry in `cpmPerDay`. We pin imps=1000
 * so CPM=spend → easy fixture math.
 */
function makeCpmCampaigns(platform: string, cpmPerDay: number[]): CampaignRow[] {
  return cpmPerDay.map((cpm, i) => {
    const date = `2026-05-${String(10 + i).padStart(2, '0')}`;
    // (spend / imps) * 1000 = cpm  →  spend = cpm * imps / 1000
    // With imps=1000, spend = cpm.
    return makeCampaign({
      date,
      platform,
      campaignId: `${platform}-c${i}`,
      adSetId: `${platform}-as${i}`,
      spend: cpm,
      impressions: 1000,
      clicks: 10,
      conversions: 0,
      conversionValue: 0,
    });
  });
}

describe('aiReport statistics — CPM volatility table (mean / stddev / CV)', () => {
  // The volatility section fires when ≥3 daily CPM points exist per platform.
  // The verdict bucketing is: cv < 0.15 → 'יציב', cv < 0.35 → 'בינוני',
  // else → 'תנודתי'. Anchor inputs that land squarely inside each bucket.

  it('CV ≈ 0.408 on CPMs [10, 20, 30] → verdict "תנודתי" (cv > 0.35)', () => {
    // Hand-computed oracle:
    //   mean = (10+20+30)/3 = 20
    //   popVariance = ((10-20)^2 + 0 + (30-20)^2) / 3 = 200/3 ≈ 66.6667
    //   stddev = √(200/3) ≈ 8.1650
    //   cv = stddev/mean ≈ 0.4082
    // Rendered: fmtCad(mean) = 'CAD 20', fmtPct(cv, 0) = '41%'.
    // Daily rows MUST exist so the dependent sections fire — and the
    // dates must align with the campaign dates so the per-platform CPM
    // aggregator has impressions to bucket.
    const daily = [10, 20, 30].map((_, i) =>
      makeDaily({
        date: `2026-05-${String(10 + i).padStart(2, '0')}`,
        fbSpend: [10, 20, 30][i],
        totalSpend: [10, 20, 30][i],
        revenue: 100,
      }),
    );
    const campaigns = makeCpmCampaigns('Meta', [10, 20, 30]);

    const md = generateAiReport({
      storeName: STORE_NAME,
      storeId: STORE_ID,
      range: RANGE,
      dailyRows: daily,
      productRows: [],
      campaignRows: campaigns,
    });

    // Section header must be present (proves the section gated to fire).
    expect(md).toMatch(/תנודתיות CPM לאורך הימים/);
    // Row format: '| Meta | 3 | CAD 20 | CAD 10 | CAD 30 | 41% | תנודתי |'
    // Match flexibly on order: pin mean=20, min=10, max=30, cv=41%, verdict.
    expect(md).toMatch(/\| Meta \| 3 \| CAD 20 \| CAD 10 \| CAD 30 \| 41% \| תנודתי \|/);
  });

  it('CV ≈ 0.163 on CPMs [16, 20, 24] → verdict "בינוני" (0.15 ≤ cv < 0.35)', () => {
    // mean = 20; popVariance = (16 + 0 + 16) / 3 = 32/3 ≈ 10.6667;
    // stddev ≈ 3.2660; cv ≈ 0.1633 → '16%' rounded → "בינוני".
    const daily = [16, 20, 24].map((_, i) =>
      makeDaily({
        date: `2026-05-${String(10 + i).padStart(2, '0')}`,
        fbSpend: [16, 20, 24][i],
        totalSpend: [16, 20, 24][i],
        revenue: 100,
      }),
    );
    const campaigns = makeCpmCampaigns('Meta', [16, 20, 24]);

    const md = generateAiReport({
      storeName: STORE_NAME,
      storeId: STORE_ID,
      range: RANGE,
      dailyRows: daily,
      productRows: [],
      campaignRows: campaigns,
    });

    expect(md).toMatch(/\| Meta \| 3 \| CAD 20 \| CAD 16 \| CAD 24 \| 16% \| בינוני \|/);
  });

  it('CV ≈ 0.082 on CPMs [18, 20, 22] → verdict "יציב" (cv < 0.15)', () => {
    // mean = 20; popVariance = (4 + 0 + 4) / 3 ≈ 2.6667;
    // stddev ≈ 1.6330; cv ≈ 0.0816 → '8%' rounded → "יציב".
    const daily = [18, 20, 22].map((_, i) =>
      makeDaily({
        date: `2026-05-${String(10 + i).padStart(2, '0')}`,
        fbSpend: [18, 20, 22][i],
        totalSpend: [18, 20, 22][i],
        revenue: 100,
      }),
    );
    const campaigns = makeCpmCampaigns('Meta', [18, 20, 22]);

    const md = generateAiReport({
      storeName: STORE_NAME,
      storeId: STORE_ID,
      range: RANGE,
      dailyRows: daily,
      productRows: [],
      campaignRows: campaigns,
    });

    expect(md).toMatch(/\| Meta \| 3 \| CAD 20 \| CAD 18 \| CAD 22 \| 8% \| יציב \|/);
  });

  it('CV = 0 on flat CPMs [20, 20, 20] → verdict "יציב" (zero-variance edge)', () => {
    // mean = 20; variance = 0; stddev = 0; cv = 0 → '0%' → "יציב".
    // Pins the cv-formula's stddev=0 path which would otherwise NaN if
    // someone refactored the variance accumulator.
    const daily = [20, 20, 20].map((_, i) =>
      makeDaily({
        date: `2026-05-${String(10 + i).padStart(2, '0')}`,
        fbSpend: 20,
        totalSpend: 20,
        revenue: 100,
      }),
    );
    const campaigns = makeCpmCampaigns('Meta', [20, 20, 20]);

    const md = generateAiReport({
      storeName: STORE_NAME,
      storeId: STORE_ID,
      range: RANGE,
      dailyRows: daily,
      productRows: [],
      campaignRows: campaigns,
    });

    expect(md).toMatch(/\| Meta \| 3 \| CAD 20 \| CAD 20 \| CAD 20 \| 0% \| יציב \|/);
  });

  it('volatility section is SKIPPED when fewer than 3 daily CPMs exist per platform', () => {
    // Two days only → arr.length < 3 → continue, no row emitted.
    const daily = [10, 20].map((_, i) =>
      makeDaily({
        date: `2026-05-${String(10 + i).padStart(2, '0')}`,
        fbSpend: [10, 20][i],
        totalSpend: [10, 20][i],
        revenue: 100,
      }),
    );
    const campaigns = makeCpmCampaigns('Meta', [10, 20]);

    const md = generateAiReport({
      storeName: STORE_NAME,
      storeId: STORE_ID,
      range: RANGE,
      dailyRows: daily,
      productRows: [],
      campaignRows: campaigns,
    });

    // The CPM/CTR per-platform table fires when impressions > 0 (it does
    // here — Meta gets the row), but the dedicated volatility table only
    // fires once a platform has ≥3 distinct daily CPMs.
    expect(md).not.toMatch(/תנודתיות CPM לאורך הימים/);
  });
});

describe('aiReport statistics — Anomaly days table (medianMad + robust z-score)', () => {
  // The anomaly section fires when `daily.length >= 5`. Per-date revenue
  // and spend are aggregated, then a robust z-score
  // z = (value - median) / (1.4826 * MAD) is applied. Rows where
  // |z| ≥ 2.0 surface in the anomaly table.

  it('flags a day at |z| ≈ 2.02 as an outlier and renders z to 1 decimal', () => {
    // Revenues [50, 100, 150, 200, 300]:
    //   sorted = [50, 100, 150, 200, 300]; median (odd n) = 150
    //   deviations = [100, 50, 0, 50, 150]; sorted = [0, 50, 50, 100, 150]
    //   MAD (odd n) = 50
    //   z for day with revenue=300: (300-150)/(1.4826*50) = 150/74.13 ≈ 2.0234
    //   |z| = 2.02 → ≥ 2.0 → flagged as 'הכנסה גבוהה במיוחד'
    //   revZ.toFixed(1) = '2.0'
    // Spend held FLAT (=100) so spend MAD = 0 → spendZ short-circuits to 0
    // → no spurious spend anomaly.
    const REV = [50, 100, 150, 200, 300];
    const daily = REV.map((rev, i) =>
      makeDaily({
        date: `2026-05-${String(10 + i).padStart(2, '0')}`,
        // Place spend on fbSpend (Meta) so totalSpend = 100 each day.
        fbSpend: 100,
        totalSpend: 100,
        revenue: rev,
      }),
    );

    const md = generateAiReport({
      storeName: STORE_NAME,
      storeId: STORE_ID,
      range: RANGE,
      dailyRows: daily,
      productRows: [],
      campaignRows: [],
    });

    // Section header proves the section fired.
    expect(md).toMatch(/ימים חריגים בטווח \(אנומליות סטטיסטיות\)/);
    // Median copy: 'המדיאן בטווח: הכנסות CAD 150 · הוצאות CAD 100.'
    expect(md).toMatch(/המדיאן בטווח: הכנסות CAD 150 · הוצאות CAD 100/);
    // Anomaly row: '| 14/05/2026 | CAD 300 | 2.0 | CAD 100 | 0.0 | הכנסה גבוהה במיוחד |'
    expect(md).toMatch(
      /\| 14\/05\/2026 \| CAD 300 \| 2\.0 \| CAD 100 \| 0\.0 \| הכנסה גבוהה במיוחד \|/,
    );
  });

  it('does NOT flag a day at |z| ≈ 1.96 (just below the 2.0 threshold)', () => {
    // Revenues [50, 100, 150, 200, 295]:
    //   median = 150 (same); deviations = [100,50,0,50,145];
    //   sorted = [0,50,50,100,145]; MAD = 50
    //   z for day with revenue=295: (295-150)/(1.4826*50) = 145/74.13 ≈ 1.9559
    //   |z| ≈ 1.96 → < 2.0 → NOT flagged
    const REV = [50, 100, 150, 200, 295];
    const daily = REV.map((rev, i) =>
      makeDaily({
        date: `2026-05-${String(10 + i).padStart(2, '0')}`,
        fbSpend: 100,
        totalSpend: 100,
        revenue: rev,
      }),
    );

    const md = generateAiReport({
      storeName: STORE_NAME,
      storeId: STORE_ID,
      range: RANGE,
      dailyRows: daily,
      productRows: [],
      campaignRows: [],
    });

    // No anomaly row → no anomaly section header should render (the
    // section is only emitted when anomalies.length > 0).
    expect(md).not.toMatch(/ימים חריגים בטווח \(אנומליות סטטיסטיות\)/);
  });

  it('uses average of middle pair when MAD has even-length deviations', () => {
    // Revenues [10, 20, 30, 40, 1000, 60]:
    //   sorted = [10, 20, 30, 40, 60, 1000]; n=6 (even);
    //   median = (sorted[2] + sorted[3]) / 2 = (30 + 40) / 2 = 35
    //   deviations = [|10-35|, |20-35|, |30-35|, |40-35|, |1000-35|, |60-35|]
    //               = [25, 15, 5, 5, 965, 25]
    //   sorted = [5, 5, 15, 25, 25, 965]; n=6 (even);
    //   MAD = (sorted[2] + sorted[3]) / 2 = (15 + 25) / 2 = 20
    //   z for day with revenue=1000: (1000-35)/(1.4826*20) = 965/29.652 ≈ 32.54
    //   → flagged; |z|.toFixed(1) = '32.5'
    // Spend flat → spendZ=0.
    const REV = [10, 20, 30, 40, 1000, 60];
    const daily = REV.map((rev, i) =>
      makeDaily({
        date: `2026-05-${String(10 + i).padStart(2, '0')}`,
        fbSpend: 100,
        totalSpend: 100,
        revenue: rev,
      }),
    );

    const md = generateAiReport({
      storeName: STORE_NAME,
      storeId: STORE_ID,
      range: RANGE,
      dailyRows: daily,
      productRows: [],
      campaignRows: [],
    });

    // Median copy uses fmtCad(35) → 'CAD 35'.
    expect(md).toMatch(/המדיאן בטווח: הכנסות CAD 35/);
    // Anomaly row: revenue 1000 on date 14/05/2026 (index 4 = 2026-05-14).
    // z = 32.54 → toFixed(1) = '32.5'.
    expect(md).toMatch(
      /\| 14\/05\/2026 \| CAD 1,000 \| 32\.5 \| CAD 100 \| 0\.0 \| הכנסה גבוהה במיוחד \|/,
    );
  });

  it('short-circuits z to 0 when MAD = 0 (constant series)', () => {
    // Revenues all equal → median=100, deviations all 0 → MAD=0 → z=0 →
    // no anomaly. Pins the `mad > 0 ? ... : 0` guard.
    const REV = [100, 100, 100, 100, 100];
    const daily = REV.map((rev, i) =>
      makeDaily({
        date: `2026-05-${String(10 + i).padStart(2, '0')}`,
        fbSpend: 100,
        totalSpend: 100,
        revenue: rev,
      }),
    );

    const md = generateAiReport({
      storeName: STORE_NAME,
      storeId: STORE_ID,
      range: RANGE,
      dailyRows: daily,
      productRows: [],
      campaignRows: [],
    });

    // No anomaly section because every z = 0.
    expect(md).not.toMatch(/ימים חריגים בטווח \(אנומליות סטטיסטיות\)/);
  });

  it('flags BOTH revenue + spend outliers and surfaces both verdict strings', () => {
    // Revenues [50, 100, 150, 200, 300] AND spends [50, 100, 150, 200, 300]
    // on the same day-5 row. Both should produce |z| ≈ 2.02 → both flagged.
    // The kind line concatenates "הכנסה גבוהה במיוחד + הוצאה גבוהה במיוחד".
    const REV = [50, 100, 150, 200, 300];
    const SPEND = [50, 100, 150, 200, 300];
    const daily = REV.map((rev, i) =>
      makeDaily({
        date: `2026-05-${String(10 + i).padStart(2, '0')}`,
        // Split spend across two channels so totalSpend matches SPEND[i].
        fbSpend: SPEND[i],
        totalSpend: SPEND[i],
        revenue: rev,
      }),
    );

    const md = generateAiReport({
      storeName: STORE_NAME,
      storeId: STORE_ID,
      range: RANGE,
      dailyRows: daily,
      productRows: [],
      campaignRows: [],
    });

    expect(md).toMatch(/ימים חריגים בטווח \(אנומליות סטטיסטיות\)/);
    // Both z and the dual-kind string.
    expect(md).toMatch(
      /\| 14\/05\/2026 \| CAD 300 \| 2\.0 \| CAD 300 \| 2\.0 \| הכנסה גבוהה במיוחד \+ הוצאה גבוהה במיוחד \|/,
    );
  });

  it('flags a NEGATIVE outlier (low revenue) with revZ < -2.0', () => {
    // Symmetric construction around median=200:
    //   revenues [50, 100, 200, 300, 350]:
    //     sorted = [50, 100, 200, 300, 350]; median = 200
    //     deviations = [150, 100, 0, 100, 150]; sorted = [0, 100, 100, 150, 150]; MAD = 100
    //     z for 50: (50-200)/(1.4826*100) = -150/148.26 ≈ -1.012 — NOT flagged
    //   Need a more extreme low. Construct revenues [0, 100, 200, 300, 350]:
    //     sorted = [0, 100, 200, 300, 350]; median = 200
    //     deviations = [200, 100, 0, 100, 150]; sorted = [0, 100, 100, 150, 200]; MAD = 100
    //     z for 0: (0-200)/(1.4826*100) = -200/148.26 ≈ -1.349 — still NOT flagged
    //   Need MAD lower. Revenues [50, 180, 200, 220, 350]:
    //     sorted = [50, 180, 200, 220, 350]; median = 200
    //     deviations = [150, 20, 0, 20, 150]; sorted = [0, 20, 20, 150, 150]; MAD = 20
    //     z for 50: (50-200)/(1.4826*20) = -150/29.652 ≈ -5.058 — flagged
    //     z for 350: (350-200)/(1.4826*20) = 150/29.652 ≈ 5.058 — flagged
    //   Both extremes get flagged; this pins the SIGN of revZ < -2.0 wins
    //   the 'הכנסה נמוכה במיוחד' branch.
    const REV = [50, 180, 200, 220, 350];
    const daily = REV.map((rev, i) =>
      makeDaily({
        date: `2026-05-${String(10 + i).padStart(2, '0')}`,
        fbSpend: 100,
        totalSpend: 100,
        revenue: rev,
      }),
    );

    const md = generateAiReport({
      storeName: STORE_NAME,
      storeId: STORE_ID,
      range: RANGE,
      dailyRows: daily,
      productRows: [],
      campaignRows: [],
    });

    expect(md).toMatch(/ימים חריגים בטווח/);
    // 10/05 row is the low outlier with revenue=50, z ≈ -5.06 → '-5.1'.
    expect(md).toMatch(
      /\| 10\/05\/2026 \| CAD 50 \| -5\.1 \| CAD 100 \| 0\.0 \| הכנסה נמוכה במיוחד \|/,
    );
    // 14/05 row is the high outlier with revenue=350, z ≈ 5.06 → '5.1'.
    expect(md).toMatch(
      /\| 14\/05\/2026 \| CAD 350 \| 5\.1 \| CAD 100 \| 0\.0 \| הכנסה גבוהה במיוחד \|/,
    );
  });
});

describe('aiReport statistics — section gating (fewer than 5 days)', () => {
  it('anomaly section is SKIPPED when fewer than 5 daily rows exist', () => {
    // daily.length < 5 → section gate fails → no anomaly table.
    const REV = [50, 100, 150, 1000];
    const daily = REV.map((rev, i) =>
      makeDaily({
        date: `2026-05-${String(10 + i).padStart(2, '0')}`,
        fbSpend: 100,
        totalSpend: 100,
        revenue: rev,
      }),
    );

    const md = generateAiReport({
      storeName: STORE_NAME,
      storeId: STORE_ID,
      range: RANGE,
      dailyRows: daily,
      productRows: [],
      campaignRows: [],
    });

    expect(md).not.toMatch(/ימים חריגים בטווח \(אנומליות סטטיסטיות\)/);
  });
});
