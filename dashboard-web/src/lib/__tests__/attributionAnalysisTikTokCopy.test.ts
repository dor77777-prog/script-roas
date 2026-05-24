/**
 * Audit fix 2026-05-24 (AUDIT attributionAnalysis ALG-01, Phase 12.2.2) —
 * locks the platform-agnostic operator-copy contract for analyzeAttribution
 * + analyzeAttributionForAdSet + analyzeAttributionForAd.
 *
 * Pre-fix surface (per .planning/AUDIT.md §Phase 12.2 + raw-returns/
 * lib_algorithm_attributionAnalysis.json #ALG-01):
 *   After Phase 05.7.9c widened the analyzer gate to TikTok (commits
 *   7c4261a + efd628c), the operator-facing Hebrew copy in analyzeAttribution
 *   continued to hardcode 'Meta' in 10+ branches:
 *     - 'אין המרות מ-Meta או מ-Shopify' (line 442)
 *     - 'URL Parameters ב-Meta Ads Manager' (line 453)
 *     - 'הוסף URL Parameters לקמפיין ב-Meta' (line 458-459)
 *     - 'ה"modeled" של Meta' (line 469)
 *     - 'מעבר למה ש-Meta מדווח' (line 473)
 *     - 'Meta מייחס בלי click-id' (line 483)
 *     - 'ROAS לפי Meta' (line 495)
 *     - 'Meta מייחס CAD ... אבל רק ...' (line 522)
 *     - 'Meta מנפח דיווחים' (line 525)
 *   For a TikTok-platform campaign, the operator would read 'Meta מייחס
 *   בלי click-id' for what is actually a TikTok campaign — leading them
 *   to troubleshoot the wrong platform and the wrong ad-account.
 *
 * Post-fix: every operator-copy literal 'Meta' that referred to the
 * SOURCE PLATFORM is parameterized to `${campaign.platform}` (or
 * `${opts.platform}` in buildAnalysis). Literals that refer to OTHER
 * platforms in comparisons / cross-channel rebalance copy stay literal.
 *
 * Evidence pack: .planning/phases/12-codebase-audit-baseline/raw-returns/
 *   lib_algorithm_attributionAnalysis.json (ALG-01).
 *
 * Test coverage (6 tests):
 *   1. TikTok low-coverage analyzeAttribution: reasons + recommendation
 *      reference TikTok, not Meta.
 *   2. TikTok high-coverage halo analyzeAttribution: same.
 *   3. TikTok no-matched-orders branch: 'TikTok דיווח' / 'TikTok מייחס'
 *      replace 'Meta דיווח' / 'Meta מייחס'.
 *   4. Meta-regression-guard: Meta-platform campaign still says 'Meta'
 *      (no over-correction).
 *   5. analyzeAttributionForAdSet TikTok: ad-set advice references TikTok.
 *   6. analyzeAttributionForAd TikTok: ad advice references TikTok.
 */
import { describe, it, expect } from 'vitest';
import {
  analyzeAttribution,
  analyzeAttributionForAdSet,
  analyzeAttributionForAd,
} from '@/lib/attributionAnalysis';
import { makeOrder, makeCampaign, makeAdSet, makeAd } from './fixtures';

const DATE_FROM = '2026-05-01';
const DATE_TO = '2026-05-15';

describe('attributionAnalysis platform-agnostic copy (ALG-01 — TikTok widening)', () => {
  // -------------------------------------------------------------------
  // 1. TikTok low-coverage path (the visible-to-operator bug fixture)
  // -------------------------------------------------------------------

  it('TikTok low-coverage: reasons + recommendation reference TikTok, not Meta', () => {
    // Setup: TikTok campaign with high metaClaim (500) but only 1
    // matching order (100 CAD) → coverage 0.2 → low trust.
    const campaign = makeCampaign({
      platform: 'TikTok',
      metaClaim: 500,
      spend: 200,
    });
    const orders = [
      makeOrder({ utmId: 'camp-1', totalCad: 100, date: '2026-05-10' }),
    ];
    const result = analyzeAttribution(campaign, orders, DATE_FROM, DATE_TO);
    expect(result).not.toBeNull();
    expect(result!.trust.level).toBe('low');

    const reasonsText = result!.reasons.join(' ');
    const fullCopy = `${reasonsText} ${result!.recommendation}`;

    // TikTok must appear at least once.
    expect(fullCopy).toMatch(/TikTok/i);

    // 'Meta מייחס' and 'Meta מנפח' (the bug-fixture phrases) must NOT
    // appear when the platform is TikTok. The operator should be reading
    // 'TikTok מייחס' / 'TikTok מנפח' instead.
    expect(fullCopy).not.toMatch(/Meta\s+מייחס/);
    expect(fullCopy).not.toMatch(/Meta\s+מנפח/);
  });

  // -------------------------------------------------------------------
  // 2. TikTok high-coverage halo path
  // -------------------------------------------------------------------

  it('TikTok high-coverage halo: medium-band copy references TikTok', () => {
    // Coverage 1.6 (det 800 vs metaClaim 500) → high trust + halo.
    const campaign = makeCampaign({
      platform: 'TikTok',
      metaClaim: 500,
      spend: 200,
    });
    const orders = Array.from({ length: 8 }, (_, i) =>
      makeOrder({
        orderId: `o-${i}`,
        totalCad: 100,
        utmId: 'camp-1',
        date: '2026-05-10',
      }),
    );
    const result = analyzeAttribution(campaign, orders, DATE_FROM, DATE_TO);
    expect(result).not.toBeNull();
    expect(result!.trust.level).toBe('high');

    const fullCopy = `${result!.reasons.join(' ')} ${result!.recommendation}`;
    // The high-band branch builds an explicit `${campaign.platform} דיווח`
    // string that must now read 'TikTok דיווח', not 'Meta דיווח'.
    expect(fullCopy).toMatch(/TikTok\s+דיווח/);
    expect(fullCopy).not.toMatch(/Meta\s+דיווח/);
  });

  // -------------------------------------------------------------------
  // 3. TikTok no-matched-orders + metaClaim > 0
  // -------------------------------------------------------------------

  it('TikTok no-matched-orders + claim > 0: copy references TikTok', () => {
    const campaign = makeCampaign({
      platform: 'TikTok',
      campaignName: 'TT Summer Push',
      metaClaim: 800,
      spend: 300,
    });
    // Orders exist but none match this campaign.
    const orders = [
      makeOrder({
        utmCampaign: 'Some Other Campaign',
        utmId: '',
        totalCad: 50,
      }),
    ];
    const result = analyzeAttribution(campaign, orders, DATE_FROM, DATE_TO);
    expect(result).not.toBeNull();
    expect(result!.trust.level).toBe('unknown');

    const reasonsText = result!.reasons.join(' ');
    // Pre-fix the second reasons-push was:
    //   `Meta דיווח על CAD 800 המרות בלי שום click-id מתאים`
    // Post-fix must say TikTok.
    expect(reasonsText).toMatch(/TikTok/);
    // Must not contain a phrase that explicitly names Meta as the source
    // platform for a TikTok campaign.
    expect(reasonsText).not.toMatch(/Meta\s+דיווח/);
  });

  // -------------------------------------------------------------------
  // 4. Meta regression guard — Meta campaign still says Meta
  // -------------------------------------------------------------------

  it('Meta-platform campaign still says Meta (no over-correction)', () => {
    // Same low-coverage scenario as test #1, but platform = Meta.
    // The bug-fixture phrase 'Meta מייחס' MUST still appear for a Meta
    // campaign — we only fixed cross-platform mislabeling, not Meta.
    const campaign = makeCampaign({
      platform: 'Meta',
      metaClaim: 500,
      spend: 200,
    });
    const orders = [
      makeOrder({ utmId: 'camp-1', totalCad: 100, date: '2026-05-10' }),
    ];
    const result = analyzeAttribution(campaign, orders, DATE_FROM, DATE_TO);
    expect(result).not.toBeNull();
    expect(result!.trust.level).toBe('low');

    const fullCopy = `${result!.reasons.join(' ')} ${result!.recommendation}`;
    // Meta must be present (the platform name).
    expect(fullCopy).toMatch(/Meta/);
  });

  // -------------------------------------------------------------------
  // 5. analyzeAttributionForAdSet — TikTok ad-set advice
  // -------------------------------------------------------------------

  it('analyzeAttributionForAdSet TikTok ad-set: bad-coverage advice references TikTok', () => {
    // Low coverage on a TikTok ad-set → 'bad' advice line. Pre-fix the
    // advice strings were hardcoded with 'Meta' (line 793-800). Post-fix
    // they must interpolate the platform.
    const adSet = makeAdSet({
      platform: 'TikTok',
      adSetId: 'adset-1',
      metaClaim: 500,
      spend: 200,
    });
    const orders = [
      makeOrder({ utmTerm: 'adset-1', totalCad: 100, date: '2026-05-10' }),
    ];
    const result = analyzeAttributionForAdSet(adSet, orders, DATE_FROM, DATE_TO);
    expect(result).not.toBeNull();
    expect(result!.trust.level).toBe('low');

    const fullCopy = `${result!.reasons.join(' ')} ${result!.recommendation}`;
    // Must say TikTok where pre-fix said Meta.
    expect(fullCopy).toMatch(/TikTok/);
    // Pre-fix `'Meta מנפח דיווחים ל-ad-set הזה.'` was the literal — must
    // not appear for a TikTok ad-set.
    expect(fullCopy).not.toMatch(/Meta\s+מנפח/);
  });

  // -------------------------------------------------------------------
  // 6. analyzeAttributionForAd — TikTok ad advice
  // -------------------------------------------------------------------

  it('analyzeAttributionForAd TikTok ad: bad-coverage advice references TikTok', () => {
    const ad = makeAd({
      platform: 'TikTok',
      adId: 'ad-1',
      metaClaim: 500,
      spend: 200,
    });
    const orders = [
      makeOrder({ utmContent: 'ad-1', totalCad: 100, date: '2026-05-10' }),
    ];
    const result = analyzeAttributionForAd(ad, orders, DATE_FROM, DATE_TO);
    expect(result).not.toBeNull();
    expect(result!.trust.level).toBe('low');

    const fullCopy = `${result!.reasons.join(' ')} ${result!.recommendation}`;
    expect(fullCopy).toMatch(/TikTok/);
    expect(fullCopy).not.toMatch(/Meta\s+מנפח/);
  });
});
