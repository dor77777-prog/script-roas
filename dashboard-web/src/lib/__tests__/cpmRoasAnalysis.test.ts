import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { analyzeCpmVsRoas, pearsonForCpmRoas } from '@/lib/cpmRoasAnalysis';
import { PRODUCT_MAP_CHIP_KEY } from '@/lib/sessionKeys';

/**
 * Build a 7-day series. Each day overrides any field via the patch arg.
 */
function makeSeries(base: { cpm: number; roas: number }, patches: Partial<{ cpm: number; roas: number }>[] = []) {
  return Array.from({ length: 7 }, (_, i) => {
    const day = String(i + 1).padStart(2, '0');
    return {
      date: `2026-05-${day}`,
      cpm: patches[i]?.cpm ?? base.cpm,
      roas: patches[i]?.roas ?? base.roas,
    };
  });
}

describe('analyzeCpmVsRoas', () => {
  it('returns hasData: false when fewer than 5 valid days are provided', () => {
    const series = makeSeries({ cpm: 5, roas: 2 }).slice(0, 4);
    const result = analyzeCpmVsRoas(series);
    expect(result.hasData).toBe(false);
    expect(result.tone).toBe('neutral');
    expect(result.text).toContain('5 ימים');
  });

  it('FIX-24: placeholder text explains the 5-day threshold so the UI can surface it', () => {
    // CampaignDrawer + CampaignsTable render the analysis box unconditionally
    // (the {analysis.hasData &&} gate was removed in FIX-24 5.2.2.1). For sparse
    // campaigns this is the message the user reads — it MUST be self-explanatory.
    const result = analyzeCpmVsRoas(makeSeries({ cpm: 5, roas: 2 }).slice(0, 3));
    expect(result.hasData).toBe(false);
    expect(result.text).toMatch(/5 ימים/);
    expect(result.text).toMatch(/ניתוח יופיע|מספיק היסטוריה|מסקנה/);
    // Tone is neutral so the UI renders in the muted gray bg, not red/green.
    expect(result.tone).toBe('neutral');
  });

  it('filters out days with zero CPM or zero ROAS before checking n', () => {
    // 7 days but 3 with zero ROAS = 4 valid; below threshold.
    const series = makeSeries({ cpm: 5, roas: 2 }, [{}, {}, {}, { roas: 0 }, { roas: 0 }, { roas: 0 }]);
    const result = analyzeCpmVsRoas(series);
    expect(result.hasData).toBe(false);
  });

  it('flags UP/UP — paying more, returning more (positive)', () => {
    // CPM trends up, ROAS trends up
    const series = makeSeries({ cpm: 3, roas: 2 }, [
      { cpm: 3, roas: 2 },
      { cpm: 3.2, roas: 2.1 },
      { cpm: 3.5, roas: 2.2 },
      { cpm: 4, roas: 2.8 },
      { cpm: 4.5, roas: 3.0 },
      { cpm: 5, roas: 3.2 },
      { cpm: 5.5, roas: 3.5 },
    ]);
    const result = analyzeCpmVsRoas(series);
    expect(result.hasData).toBe(true);
    expect(result.tone).toBe('positive');
    expect(result.text).toContain('עובד');
  });

  it('flags UP/DOWN — paying more, returning less (negative)', () => {
    const series = makeSeries({ cpm: 3, roas: 3 }, [
      { cpm: 3, roas: 3 },
      { cpm: 3.5, roas: 2.8 },
      { cpm: 4, roas: 2.5 },
      { cpm: 4.5, roas: 2.2 },
      { cpm: 5, roas: 2 },
      { cpm: 5.5, roas: 1.8 },
      { cpm: 6, roas: 1.5 },
    ]);
    const result = analyzeCpmVsRoas(series);
    expect(result.hasData).toBe(true);
    expect(result.tone).toBe('negative');
    expect(result.text).toContain('דבר רע');
  });

  it('flags DOWN/UP — best case (positive)', () => {
    const series = makeSeries({ cpm: 6, roas: 2 }, [
      { cpm: 6, roas: 2 },
      { cpm: 5.5, roas: 2.2 },
      { cpm: 5, roas: 2.5 },
      { cpm: 4.5, roas: 2.8 },
      { cpm: 4, roas: 3.2 },
      { cpm: 3.5, roas: 3.5 },
      { cpm: 3, roas: 3.8 },
    ]);
    const result = analyzeCpmVsRoas(series);
    expect(result.hasData).toBe(true);
    expect(result.tone).toBe('positive');
    expect(result.text).toContain('האידיאלי');
  });

  it('flags DOWN/DOWN — cheap impressions but non-auction problem (negative)', () => {
    const series = makeSeries({ cpm: 6, roas: 3 }, [
      { cpm: 6, roas: 3 },
      { cpm: 5.5, roas: 2.8 },
      { cpm: 5, roas: 2.5 },
      { cpm: 4.5, roas: 2.2 },
      { cpm: 4, roas: 2 },
      { cpm: 3.5, roas: 1.8 },
      { cpm: 3, roas: 1.5 },
    ]);
    const result = analyzeCpmVsRoas(series);
    expect(result.hasData).toBe(true);
    expect(result.tone).toBe('negative');
    expect(result.text).toContain('לא הצילו');
  });

  it('flags FLAT/FLAT — steady state (neutral)', () => {
    const series = makeSeries({ cpm: 5, roas: 3 });
    const result = analyzeCpmVsRoas(series);
    expect(result.hasData).toBe(true);
    expect(result.tone).toBe('neutral');
    expect(result.text).toContain('סטדי');
  });

  it('flags FLAT/DOWN — creative fatigue (warning)', () => {
    const series = makeSeries({ cpm: 5, roas: 3 }, [
      { roas: 3 },
      { roas: 2.9 },
      { roas: 2.7 },
      { roas: 2.4 },
      { roas: 2.1 },
      { roas: 1.9 },
      { roas: 1.7 },
    ]);
    const result = analyzeCpmVsRoas(series);
    expect(result.hasData).toBe(true);
    expect(result.tone).toBe('warning');
    expect(result.text).toContain('נשחק');
  });

  it('handles equal-length series with zero variance via pearson guard', () => {
    // Both flat = zero variance; pearson returns null; categorize falls
    // to "flat" via the halfOverHalfDelta path (delta = 0)
    const series = makeSeries({ cpm: 5, roas: 2 });
    const result = analyzeCpmVsRoas(series);
    expect(result.details.pearson).toBeNull();
  });

  it('exposes diagnostic deltas in details object', () => {
    const series = makeSeries({ cpm: 5, roas: 2 }, [
      { cpm: 4, roas: 2 },
      { cpm: 4.5, roas: 2 },
      { cpm: 5, roas: 2 },
      { cpm: 6, roas: 2 },
      { cpm: 7, roas: 2 },
      { cpm: 8, roas: 2 },
      { cpm: 9, roas: 2 },
    ]);
    const result = analyzeCpmVsRoas(series);
    expect(result.details.n).toBe(7);
    expect(result.details.cpmDeltaPct).not.toBeNull();
    // Second half (6,7,8,9 mean) is higher than first half (4, 4.5, 5)
    expect(result.details.cpmDeltaPct!).toBeGreaterThan(0);
  });

  it("reports mode = 'half-over-half' when no prev series is provided", () => {
    const series = makeSeries({ cpm: 5, roas: 3 });
    const result = analyzeCpmVsRoas(series);
    expect(result.mode).toBe('half-over-half');
  });

  it("reports mode = 'previous-period' when prev series is provided with >= 3 valid days", () => {
    const current = makeSeries({ cpm: 5, roas: 3 });
    const prev = makeSeries({ cpm: 4, roas: 2.5 });
    const result = analyzeCpmVsRoas(current, { prev });
    expect(result.mode).toBe('previous-period');
  });

  it('falls back to half-over-half when prev has fewer than 3 valid days', () => {
    const current = makeSeries({ cpm: 5, roas: 3 });
    const prev = makeSeries({ cpm: 4, roas: 2 }, [{}, { cpm: 0, roas: 0 }, { cpm: 0, roas: 0 }, { cpm: 0, roas: 0 }, { cpm: 0, roas: 0 }, { cpm: 0, roas: 0 }, { cpm: 0, roas: 0 }]);
    const result = analyzeCpmVsRoas(current, { prev });
    // Only 1 valid prev day → falls back
    expect(result.mode).toBe('half-over-half');
  });

  it('computes previous-period delta = (curMean - prevMean) / prevMean', () => {
    // Current: 5 days, all CPM=10. Mean current = 10.
    const current = [
      { date: '2026-05-10', cpm: 10, roas: 3 },
      { date: '2026-05-11', cpm: 10, roas: 3 },
      { date: '2026-05-12', cpm: 10, roas: 3 },
      { date: '2026-05-13', cpm: 10, roas: 3 },
      { date: '2026-05-14', cpm: 10, roas: 3 },
    ];
    // Prev: 5 days, all CPM=8. Mean prev = 8. Delta = (10-8)/8 = +0.25 = +25%.
    const prev = [
      { date: '2026-05-05', cpm: 8, roas: 2.5 },
      { date: '2026-05-06', cpm: 8, roas: 2.5 },
      { date: '2026-05-07', cpm: 8, roas: 2.5 },
      { date: '2026-05-08', cpm: 8, roas: 2.5 },
      { date: '2026-05-09', cpm: 8, roas: 2.5 },
    ];
    const result = analyzeCpmVsRoas(current, { prev });
    expect(result.mode).toBe('previous-period');
    // CPM up 25%, ROAS up 20% — both growing
    expect(result.details.cpmDeltaPct).toBeCloseTo(0.25, 2);
    expect(result.details.roasDeltaPct).toBeCloseTo(0.2, 2);
  });
});

describe('Pearson N=3 threshold — locks TEST-08 (5.2.2.1)', () => {
  it('returns null for N=2', () => {
    expect(pearsonForCpmRoas([10, 12], [2, 3])).toBeNull();
  });

  it('returns a finite number for N=3', () => {
    const result = pearsonForCpmRoas([10, 12, 15], [2, 3, 5]);
    expect(typeof result).toBe('number');
    expect(Number.isFinite(result)).toBe(true);
  });

  it('PRODUCT_MAP_CHIP_KEY is the shared product-map freshness key', () => {
    expect(PRODUCT_MAP_CHIP_KEY).toBe('roas:productMapChipHidden');
  });

  // WR-03 (5.2.2.1): the assertion above only locks the literal value of
  // the constant. It does NOT verify that the two consumer components
  // (MetaShopifyReconciliation, ProductChannelBreakdown) actually import
  // and use the shared constant — a regression where one component
  // reverts to the inline literal 'roas:productMapChipHidden' (while the
  // constant stays in sessionKeys.ts) would still pass the value
  // assertion, even though the whole point of FIX-08's extraction is
  // that the two components stay in lockstep on key changes.
  //
  // The smoke checks below load each component's source via fs.readFileSync
  // and assert that
  //   (a) it imports PRODUCT_MAP_CHIP_KEY from @/lib/sessionKeys (or a
  //       relative path), and
  //   (b) it does NOT contain an inline 'roas:productMapChipHidden'
  //       literal outside of the sessionKeys.ts definition.
  // If either component drifts back to the inline literal, BOTH guards
  // fire and the regression is loud.

  const consumerComponents = [
    {
      label: 'MetaShopifyReconciliation',
      // Path is relative to the test file's location (`src/lib/__tests__/`).
      relPath: '../../components/MetaShopifyReconciliation.tsx',
    },
    {
      label: 'ProductChannelBreakdown',
      relPath: '../../components/ProductChannelBreakdown.tsx',
    },
  ];

  for (const { label, relPath } of consumerComponents) {
    it(`${label} imports PRODUCT_MAP_CHIP_KEY from sessionKeys and does not inline the literal`, () => {
      const filePath = path.resolve(__dirname, relPath);
      const source = fs.readFileSync(filePath, 'utf-8');

      // (a) An import statement referencing PRODUCT_MAP_CHIP_KEY from
      //     sessionKeys must be present. Matches either '@/lib/sessionKeys'
      //     or any relative './'/'../' path ending in 'sessionKeys'.
      const importRegex = /import\s*\{[^}]*\bPRODUCT_MAP_CHIP_KEY\b[^}]*\}\s*from\s*['"](?:@\/lib\/sessionKeys|(?:\.\.?\/)+(?:[^'"]*\/)?sessionKeys)['"]/;
      expect(source).toMatch(importRegex);

      // (b) The literal must NOT appear anywhere outside the import we
      //     just verified. The import line itself contains the constant
      //     IDENTIFIER, not the string literal, so this check catches a
      //     `sessionStorage.getItem('roas:productMapChipHidden')` regression.
      expect(source).not.toContain("'roas:productMapChipHidden'");
      expect(source).not.toContain('"roas:productMapChipHidden"');
    });
  }
});
