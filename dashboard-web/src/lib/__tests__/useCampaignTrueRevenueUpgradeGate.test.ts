/**
 * useCampaignTrueRevenueUpgradeGate.test.ts — 2026-06-11 adversarial review.
 *
 * The two-method-agreement trust upgrade (Phase 05.7.9c, operator-locked
 * 2026-05-22) fired on `trust.level !== 'high'`, which after the 2026-06-10
 * batch ALSO matched a P1-8b-capped medium (coverage > 2, the broken-pixel
 * signature). A campaign with claim=$100 / det=$250 (capped medium-65 +
 * 'חשד לתקלת מעקב' + check-pixel recommendation) whose product-mapping
 * agreed with the claim within 10% was silently promoted back to 'אמין 9x'
 * — a trusted chip beside the broken-pixel banner, and a NEW drawer-vs-table
 * split (the drawer's raw analyzeAttribution call has no upgrade).
 *
 * The upgrade is now an exported pure function gated on
 * `coverageExceedsClamp`: a P1-8b-capped verdict STAYS medium and keeps its
 * tracking-check recommendation. The operator-locked behavior for normal
 * (clamp-free) coverage is preserved and pinned here too.
 */

import { describe, it, expect } from 'vitest';
import { analyzeAttribution } from '@/lib/attributionAnalysis';
import { applyTwoMethodAgreementUpgrade } from '@/lib/hooks/useCampaignTrueRevenue';
import { makeOrder, makeCampaign } from './fixtures';

const DATE_FROM = '2026-05-01';
const DATE_TO = '2026-05-15';

describe('applyTwoMethodAgreementUpgrade — P1-8b cap gate (2026-06-11 review)', () => {
  it('coverage 2.5 (capped medium) + mapping gap < 10% does NOT return to high — stays medium with the tracking check', () => {
    // claim $100, det $250 → coverage 2.5 → coverageExceedsClamp + medium-65.
    const campaign = makeCampaign({ metaClaim: 100, spend: 100 });
    const orders = [
      makeOrder({ orderId: 'o-0', totalCad: 120, utmId: 'camp-1', date: '2026-05-10' }),
      makeOrder({ orderId: 'o-1', totalCad: 130, utmId: 'camp-1', date: '2026-05-11' }),
    ];
    const analysis = analyzeAttribution(campaign, orders, DATE_FROM, DATE_TO);
    expect(analysis).not.toBeNull();
    expect(analysis!.coverageExceedsClamp).toBe(true);
    expect(analysis!.trust.level).toBe('medium');

    // Product mapping agrees with the platform claim within 5% — pre-fix
    // this promoted trust to high/95 while the broken-pixel reason +
    // check-pixel recommendation were retained on the same card.
    const upgraded = applyTwoMethodAgreementUpgrade(analysis, 100, 105, 'Meta');
    expect(upgraded).not.toBeNull();
    expect(upgraded!.trust.level).toBe('medium');
    expect(upgraded!.trust.score).toBeLessThanOrEqual(65);
    // The tracking-check recommendation survives untouched.
    expect(upgraded!.recommendation).toMatch(/Pixel|פיקסל|תגית/);
    // No agreement reason was prepended.
    expect(upgraded!.reasons[0]).not.toContain('שתי שיטות עצמאיות חופפות');
  });

  it('control: normal coverage (no clamp) + gap < 10% still upgrades to high (operator-locked 2026-05-22)', () => {
    // claim $200, det $100 → coverage 0.5 → medium, clamp NOT exceeded.
    const campaign = makeCampaign({ metaClaim: 200, spend: 100 });
    const orders = [
      makeOrder({ orderId: 'o-0', totalCad: 40, utmId: 'camp-1', date: '2026-05-10' }),
      makeOrder({ orderId: 'o-1', totalCad: 60, utmId: 'camp-1', date: '2026-05-11' }),
    ];
    const analysis = analyzeAttribution(campaign, orders, DATE_FROM, DATE_TO);
    expect(analysis).not.toBeNull();
    expect(analysis!.coverageExceedsClamp).toBe(false);
    expect(analysis!.trust.level).toBe('medium');

    const upgraded = applyTwoMethodAgreementUpgrade(analysis, 200, 195, 'Meta');
    expect(upgraded!.trust.level).toBe('high');
    expect(upgraded!.trust.score).toBeGreaterThanOrEqual(90);
    expect(upgraded!.reasons[0]).toContain('שתי שיטות עצמאיות חופפות');
  });

  it('claim=0 unknown-40 verdict is untouched (no platform claim → no agreement to measure)', () => {
    const campaign = makeCampaign({ metaClaim: 0, spend: 100 });
    const orders = [
      makeOrder({ orderId: 'o-0', totalCad: 150, utmId: 'camp-1', date: '2026-05-10' }),
    ];
    const analysis = analyzeAttribution(campaign, orders, DATE_FROM, DATE_TO);
    expect(analysis).not.toBeNull();
    expect(analysis!.trust.label).toBe('הפלטפורמה מדווחת 0');

    const upgraded = applyTwoMethodAgreementUpgrade(analysis, 0, 150, 'Meta');
    expect(upgraded).toBe(analysis); // identity — nothing rewritten
    expect(upgraded!.trust.level).toBe('unknown');
    expect(upgraded!.trust.score).toBe(40);
  });

  it('null attribution passes through', () => {
    expect(applyTwoMethodAgreementUpgrade(null, 100, 100, 'Meta')).toBeNull();
  });
});
