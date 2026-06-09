/**
 * campaignPendingState.test.ts — 2026-06-09 (Problem B)
 *
 * With spend=0 the directional ROAS is uncomputable; the cell used to show a
 * bare "—" that made a self-healing intraday state look broken. This helper
 * distinguishes "updating" (conversions/value before billed spend lands) and
 * "awaiting" (placeholder before first metrics tick) from genuinely idle — but
 * ONLY when the selected range includes today (a historical spend=0 is final).
 */
import { describe, expect, it } from 'vitest';
import { campaignPendingState } from '@/lib/campaignPendingState';

const TODAY = true;

describe('campaignPendingState (range includes today)', () => {
  it('spend>0 → null (normal row, ROAS computed)', () => {
    expect(campaignPendingState({ spend: 100, conversionValue: 200, conversions: 2, impressions: 5000 }, TODAY)).toBeNull();
  });

  it('spend=0 but value>0 → updating (Meta conversions-before-spend lag)', () => {
    expect(campaignPendingState({ spend: 0, conversionValue: 210, conversions: 1, impressions: 4000 }, TODAY)).toBe('updating');
  });

  it('spend=0, value=0, conversions>0 → updating', () => {
    expect(campaignPendingState({ spend: 0, conversionValue: 0, conversions: 2, impressions: 100 }, TODAY)).toBe('updating');
  });

  it('spend=0, value=0, conversions=0, impressions>0 → awaiting (placeholder before first tick)', () => {
    expect(campaignPendingState({ spend: 0, conversionValue: 0, conversions: 0, impressions: 1200 }, TODAY)).toBe('awaiting');
  });

  it('all zero → null (genuinely idle → "—")', () => {
    expect(campaignPendingState({ spend: 0, conversionValue: 0, conversions: 0, impressions: 0 }, TODAY)).toBeNull();
  });
});

describe('campaignPendingState (historical range — NOT today)', () => {
  it('historical spend=0 with value>0 → null (final data, show "—" not "מתעדכן")', () => {
    expect(campaignPendingState({ spend: 0, conversionValue: 210, conversions: 1, impressions: 4000 }, false)).toBeNull();
  });
  it('historical spend=0 with impressions>0 → null (not "ממתין")', () => {
    expect(campaignPendingState({ spend: 0, conversionValue: 0, conversions: 0, impressions: 1200 }, false)).toBeNull();
  });
});
