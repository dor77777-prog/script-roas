import { describe, expect, it } from 'vitest';
import {
  analyzeAttribution,
  analyzeAttributionForAdSet,
} from '@/lib/attributionAnalysis';
import { makeOrder } from './fixtures';

/**
 * d/CR-06 (audit 2026-05-23) — pins the platform-gate architecture for the
 * useCampaignAttribution hook.
 *
 * Before this fix the hook short-circuited with
 *   if (!summary || summary.platform !== 'Meta') return new Map(...);
 * which killed TikTok ad-set ROAS-Shopify rendering even though the
 * underlying `analyzeAttribution` (campaign-level) already accepts both
 * Meta + TikTok per Phase 05.7.9c.
 *
 * After this fix the hook only short-circuits on `!summary` and forwards
 * any platform to the analyzer. The analyzer is the single source of truth
 * for "do I support this platform?".
 *
 * Today the per-ad-set / per-ad analyzers still hard-return null for non-
 * Meta platforms (lib/attributionAnalysis.ts:717, :767) — that widening is
 * Wave 2 work in attributionAnalysis.ts, owned by a different agent. This
 * suite locks BOTH facts: (a) the campaign-level analyzer accepts TikTok,
 * proving the architecture wants TikTok parity; (b) the ad-set-level
 * analyzer still returns null for TikTok, documenting the deferred
 * follow-up that will light up TikTok numbers on the ROAS Shopify chip
 * once it lands.
 *
 * The hook itself isn't tested here directly — the vitest config is
 * node-only and React hooks need JSDOM. The architectural contract above
 * is what the hook now relies on.
 */
describe('useCampaignAttribution platform gate — locks d/CR-06', () => {
  const range = { from: '2026-05-01', to: '2026-05-31' };

  it('analyzeAttribution accepts TikTok at the campaign level (architecture supports TikTok)', () => {
    const order = makeOrder({
      date: '2026-05-10',
      utmId: 'tt-camp-1',
      utmCampaign: 'TT Summer',
      totalCad: 200,
    });
    const result = analyzeAttribution(
      {
        campaignName: 'TT Summer',
        campaignId: 'tt-camp-1',
        storeId: 'uzoshop',
        platform: 'TikTok',
        metaClaim: 100,
        spend: 50,
      },
      [order],
      range.from,
      range.to,
    );
    // TikTok is a first-class platform for analyzeAttribution as of
    // Phase 05.7.9c (line ~310 of attributionAnalysis.ts). Result is a
    // real analysis object, not null.
    expect(result).not.toBeNull();
    expect(result!.deterministicOrders).toBe(1);
  });

  it('analyzeAttribution still rejects Google (PMax utm-tracking unreliable)', () => {
    const result = analyzeAttribution(
      {
        campaignName: 'Google PMax',
        campaignId: 'g-camp-1',
        storeId: 'uzoshop',
        platform: 'Google',
        metaClaim: 100,
        spend: 50,
      },
      [makeOrder()],
      range.from,
      range.to,
    );
    expect(result).toBeNull();
  });

  it('analyzeAttributionForAdSet still returns null for TikTok (deferred follow-up)', () => {
    // DOCUMENTS the deferred analyzer-level fix. When this test starts
    // failing, the analyzer was widened to accept TikTok — at that point,
    // update this expectation to non-null and remove the documenting
    // comment in lib/hooks/useCampaignAttribution.ts.
    const result = analyzeAttributionForAdSet(
      {
        adSetId: 'tt-adset-1',
        adSetName: 'TT Adset',
        storeId: 'uzoshop',
        platform: 'TikTok',
        metaClaim: 100,
        spend: 50,
      },
      [makeOrder({ utmTerm: 'tt-adset-1' })],
      range.from,
      range.to,
    );
    // Deferred: until lib/attributionAnalysis.ts:717 is widened, TikTok
    // ad-set analysis stays null. The hook-level fix (d/CR-06) is still
    // correct — it removes the duplicate gate so the analyzer becomes the
    // sole source of truth for platform support.
    expect(result).toBeNull();
  });

  it('analyzeAttributionForAdSet accepts Meta (baseline still works)', () => {
    const result = analyzeAttributionForAdSet(
      {
        adSetId: 'fb-adset-1',
        adSetName: 'FB Adset',
        storeId: 'uzoshop',
        platform: 'Meta',
        metaClaim: 100,
        spend: 50,
      },
      [makeOrder({ utmTerm: 'fb-adset-1', totalCad: 80 })],
      range.from,
      range.to,
    );
    expect(result).not.toBeNull();
    expect(result!.deterministicOrders).toBe(1);
  });
});
