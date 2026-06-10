/**
 * attributionPlatformTagging.test.ts — 2026-06-09
 *
 * Locks the per-platform tagging guidance (`platformTaggingGuide`) and the
 * analyzer copy that consumes it. Operator-reported bug: a Google PMax
 * campaign was told to add `utm_source=facebook&utm_campaign={{campaign.name}}`
 * (Meta-only) — wrong on every token. Google matches the NUMERIC campaign_id
 * via ValueTrack (`{campaignid}`), TikTok uses its own macros.
 *
 * These assertions are the CI guard so the class of bug ("Meta example shown
 * for a non-Meta campaign") cannot silently regress.
 */

import { describe, expect, it } from 'vitest';
import { analyzeAttribution, orderMatchesCampaign, platformTaggingGuide } from '@/lib/attributionAnalysis';
import { makeOrder } from './fixtures';

describe('platformTaggingGuide', () => {
  it('Google → ValueTrack {campaignid}, never the Meta example, no Pixel/CAPI', () => {
    const g = platformTaggingGuide('Google');
    expect(g.template).toContain('{campaignid}');
    expect(g.template).not.toContain('facebook');
    expect(g.template).not.toContain('{{campaign.name}}');
    expect(g.surface).toContain('Google Ads');
    expect(g.surface).not.toContain('Ads Manager'); // it's "Google Ads", not "Ads Manager"
    expect(g.hasPixel).toBe(false);
  });

  it('TikTok → tracking macros (__CAMPAIGN_ID__ / __AID__)', () => {
    const t = platformTaggingGuide('TikTok');
    expect(t.template).toContain('__CAMPAIGN_ID__');
    expect(t.template).toContain('tiktok');
    expect(t.surface).toContain('TikTok');
    expect(t.hasPixel).toBe(true);
  });

  it('Meta → id-first dynamic param {{campaign.id}}', () => {
    const m = platformTaggingGuide('Meta');
    expect(m.template).toContain('{{campaign.id}}');
    expect(m.surface).toContain('Meta');
    expect(m.hasPixel).toBe(true);
  });

  // The strong guard (catches the 2026-06-09 TikTok bug a substring check
  // missed): every platform's template must put the campaign id in the SLOT
  // the matcher actually checks. All three are id-first (utm_id), and an order
  // whose utm_id === campaignId (what the template's macro resolves to) must
  // satisfy orderMatchesCampaign for that platform.
  it.each(['Meta', 'Google', 'TikTok'] as const)(
    '%s template tags the campaign id into a slot orderMatchesCampaign actually matches',
    (platform) => {
      const guide = platformTaggingGuide(platform);
      expect(guide.template).toContain('utm_id=');
      const campaignId = 'CAMP-123456';
      const order = makeOrder({ utmId: campaignId, utmCampaign: '', storeId: 'uzoshop' });
      const matched = orderMatchesCampaign(order, {
        campaignName: 'Some Name Different From The Id',
        storeId: 'uzoshop',
        platform,
        campaignId,
      });
      expect(matched).toBe(true);
    },
  );
});

describe('analyzeAttribution recommendation is platform-correct', () => {
  const range = { from: '2026-05-01', to: '2026-05-31' };

  it('Google campaign with no matched orders → recommends ValueTrack, NOT the Meta UTM string', () => {
    const result = analyzeAttribution(
      { campaignName: 'PMax Brand', campaignId: '1234567890', storeId: 'uzoshop', platform: 'Google', metaClaim: 264, spend: 100 },
      // A present-but-non-matching order so the analyzer runs (it returns null
      // on an empty array) and lands in the "no click-id" branch.
      [makeOrder({ source: 'direct', utmId: '', utmCampaign: '', totalCad: 50, date: '2026-05-10' })],
      range.from,
      range.to,
    );
    expect(result).not.toBeNull();
    expect(result!.recommendation).toContain('{campaignid}');
    expect(result!.recommendation).not.toContain('utm_source=facebook');
    expect(result!.recommendation).not.toContain('{{campaign.name}}');
    // The "no tag" reason names the right surface + tag, not "Ads Manager".
    expect(result!.reasons.join(' ')).toContain('Google Ads');
  });

  it('Google low-coverage campaign → troubleshoot copy omits Pixel/CAPI (Google has none)', () => {
    const result = analyzeAttribution(
      { campaignName: 'PMax Brand', campaignId: '1234567890', storeId: 'uzoshop', platform: 'Google', metaClaim: 1000, spend: 100 },
      [makeOrder({ source: 'google-paid', utmId: '1234567890', utmCampaign: '', totalCad: 50, date: '2026-05-10' })],
      range.from,
      range.to,
    );
    expect(result).not.toBeNull();
    // coverage = 50/1000 = 5% → low branch.
    expect(result!.recommendation).not.toContain('Pixel');
    expect(result!.recommendation).not.toContain('CAPI');
  });

  it('Meta low-coverage campaign → troubleshoot copy keeps Pixel/CAPI', () => {
    const result = analyzeAttribution(
      { campaignName: 'FB Brand', campaignId: 'm-c1', storeId: 'uzoshop', platform: 'Meta', metaClaim: 1000, spend: 100 },
      [makeOrder({ source: 'meta-paid', utmId: 'm-c1', utmCampaign: '', totalCad: 50, date: '2026-05-10' })],
      range.from,
      range.to,
    );
    expect(result).not.toBeNull();
    expect(result!.recommendation).toContain('Pixel/CAPI');
  });
});

/* ---------------------------------------------------------------------------
 * P1-25 (2026-06-10 audit) — hardcoded-"Meta" grep-guard over the two bbadd3c
 * SURVIVORS the behavioural tests above can't reach (one is a React hook, the
 * other a component-private helper): useCampaignTrueRevenue's confidence
 * reason strings and ProductCentricView's "בלבד" delta chip. The guard scans
 * the SOURCE for the exact banned phrases so the class ("the literal 'Meta'
 * written where the row's platform belongs") cannot silently regress.
 * ------------------------------------------------------------------------- */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

describe('P1-25 grep-guard — no hardcoded "Meta" platform copy in the bbadd3c survivors', () => {
  // src/ root, resolved like designColorGuard does (__dirname-relative — the
  // suite must not depend on the vitest cwd).
  const SRC_DIR = resolve(__dirname, '..', '..');
  const FILES = [
    'lib/hooks/useCampaignTrueRevenue.ts',
    'components/ProductCentricView.tsx',
  ];
  // Phrases that put the LITERAL "Meta" where the row's platform belongs.
  // (Comments may mention Meta; these phrases only ever appeared inside the
  // operator-facing template literals.)
  const BANNED = [
    'מול Meta',           // "פער של X% מול Meta" on a TikTok/Google row
    'Meta בלבד',          // the delta chip on a Google PMax row
    'בין Meta ל-Shopify', // the two-method-agreement trust reason
    'Meta ↔ Shopify',     // the partial-agreement trust reason
  ];

  it.each(FILES)('%s contains none of the banned hardcoded-Meta phrases', (rel) => {
    const src = readFileSync(join(SRC_DIR, rel), 'utf8');
    for (const phrase of BANNED) {
      expect(src.includes(phrase), `found banned phrase "${phrase}" in ${rel}`).toBe(false);
    }
  });
});
