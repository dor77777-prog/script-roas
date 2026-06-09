/**
 * aiReportProfitLabel.test.ts — P0-1 contract test.
 *
 * Asserts that the AI report's summary table labels the
 * revenue−spend−cogs figure as "רווח תפעולי" (operating profit),
 * NOT as "רווח נטו" (which is reserved for trueNetProfit in KpiCards).
 *
 * The test is intentionally minimal — it feeds a known revenue/spend/cogs
 * triple through generateAiReport() and pins the bold table row label.
 *
 * Also guards the DetailTable column header (rev−spend−cogs → "רווח תפעולי")
 * and the Dashboard.tsx KpiCards SectionIntro formula via source-file string
 * assertions. This avoids needing @testing-library/react while still failing
 * on accidental label reversions.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateAiReport } from '@/lib/aiReport';
import type { DailyRow } from '@/lib/types';

const STORE_ID = 'uzoshop';
const STORE_NAME = 'uzoshop';
const RANGE = { from: '2026-05-01', to: '2026-05-07' };

function makeDaily(overrides: Partial<DailyRow> = {}): DailyRow {
  return {
    date: '2026-05-01',
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

describe('aiReport profit label — P0-1', () => {
  it('summary table uses "רווח תפעולי" for revenue−spend−cogs, not "רווח נטו"', () => {
    // revenue=10000, fbSpend=3000 (totalSpend=3000), cogs=2500
    // netProfit (inside the report) = 10000 − 3000 − 2500 = 4500
    // The bold row must say "רווח תפעולי", NOT "רווח נטו"
    const daily = [
      makeDaily({
        date: '2026-05-01',
        fbSpend: 3000,
        totalSpend: 3000,
        revenue: 10000,
        roas: 10000 / 3000,
        cogs: 2500,
        hasCogs: true,
        grossProfit: 10000 - 3000,
      }),
    ];

    const md = generateAiReport({
      storeName: STORE_NAME,
      storeId: STORE_ID,
      range: RANGE,
      dailyRows: daily,
      productRows: [],
      campaignRows: [],
    });

    // The bold table row must be labeled "רווח תפעולי" (a clarifying
    // formula parenthetical may follow the bold label — 2026-06-09).
    expect(md).toMatch(/\|\s*\*\*רווח תפעולי\*\*[^|]*\|/);

    // And must NOT contain a bold "רווח נטו" row in the summary table
    expect(md).not.toMatch(/\|\s*\*\*רווח נטו\*\*\s*\|/);

    // The value itself should be correct: 10000 − 3000 − 2500 = 4,500
    expect(md).toMatch(/\*\*רווח תפעולי\*\*.*CAD 4,500/);
  });

  it('AI prompt context describes "רווח תפעולי" as revenue−spend−COGS formula', () => {
    // The prompt context block in the report (the AI instructions section)
    // must use "רווח תפעולי" for the narrower formula description
    const daily = [
      makeDaily({
        date: '2026-05-01',
        fbSpend: 1000,
        totalSpend: 1000,
        revenue: 5000,
        roas: 5,
        cogs: 1250,
        hasCogs: true,
        grossProfit: 4000,
      }),
    ];

    const md = generateAiReport({
      storeName: STORE_NAME,
      storeId: STORE_ID,
      range: RANGE,
      dailyRows: daily,
      productRows: [],
      campaignRows: [],
    });

    // The AI context line that defines the formula must use "רווח תפעולי"
    expect(md).toMatch(/רווח תפעולי\s*=\s*הכנסות − פרסום/);
  });
});

// ============================================================================
// Source-file label guards (no React renderer needed)
//
// DetailTable.tsx and Dashboard.tsx are React components; without
// @testing-library/react we cannot render them. Instead we read the source
// as a string and assert the key label literals. These tests fail immediately
// if anyone reverts "רווח תפעולי" back to "רווח נטו" in the wrong slot.
// ============================================================================
describe('P0-1 label guard — source-file string assertions', () => {
  const root = resolve(__dirname, '../../../');

  it('DetailTable.tsx COGS column header is "רווח תפעולי", not "רווח נטו"', () => {
    const src = readFileSync(
      resolve(root, 'src/components/DetailTable.tsx'),
      'utf8',
    );
    expect(src).toMatch(/showCogs.*רווח תפעולי/s);
    expect(src).not.toMatch(/showCogs.*רווח נטו/s);
  });

  it('aiReport.ts section 1.2 uses "רווח תפעולי", not "רווח נטו בפועל"', () => {
    const src = readFileSync(
      resolve(root, 'src/lib/aiReport.ts'),
      'utf8',
    );
    expect(src).toMatch(/1\.2 רווחיות.*רווח תפעולי/s);
    expect(src).not.toMatch(/רווח נטו בפועל/);
  });
});
