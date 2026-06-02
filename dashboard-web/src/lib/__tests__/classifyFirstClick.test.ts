import { describe, it, expect } from 'vitest';
import { classifyOrderAttribution } from '@/lib/fetchers/shopify';

/**
 * First-click (Phase 4) extension of classifyOrderAttribution. The classifier
 * already folds note_attributes into the params bag; we additionally read the
 * ft_*-namespaced keys (single underscore _ft_ on the storefront is normalized
 * to ft_) and run a TRIMMED source chain over ONLY those keys — never
 * source_name / referring_site.
 */
describe('classifyOrderAttribution — first-click (ft_*) extension', () => {
  it('emits null/false first-click fields when no ft_* keys are present', () => {
    const c = classifyOrderAttribution({
      landing_site: 'https://x.com/?utm_source=facebook&utm_medium=cpc&fbclid=ABC',
      note_attributes: [],
    });
    // Last-click still works.
    expect(c.source).toBe('meta-paid');
    // First-click absent → "no first-click signal", NOT 'direct'.
    expect(c.firstTouchSource).toBeNull();
    expect(c.firstFbclidPresent).toBe(false);
    expect(c.firstGclidPresent).toBe(false);
    expect(c.firstTtclidPresent).toBe(false);
    expect(c.firstUtmSource).toBeNull();
    expect(c.firstUtmCampaign).toBeNull();
    expect(c.firstUtmContent).toBeNull();
    expect(c.firstUtmId).toBeNull();
    expect(c.firstUtmTerm).toBeNull();
    expect(c.firstSeenAt).toBeNull();
  });

  it('reads ft_* from note_attributes (single-underscore _ft_ normalized to ft_)', () => {
    const c = classifyOrderAttribution({
      landing_site: 'https://x.com/?gclid=LAST',
      note_attributes: [
        { name: '_ft_fbclid', value: 'FBFIRST' },
        { name: '_ft_utm_source', value: 'facebook' },
        { name: '_ft_utm_medium', value: 'cpc' },
        { name: '_ft_utm_campaign', value: 'Intro Campaign' },
        { name: '_ft_utm_id', value: 'camp-first-1' },
        { name: '_ft_utm_content', value: 'ad-first-1' },
        { name: '_ft_utm_term', value: 'adset-first-1' },
        { name: '_ft_set_at', value: '2026-06-01T10:00:00.000Z' },
      ],
    });
    // Last-click is gclid → google-paid (unchanged).
    expect(c.source).toBe('google-paid');
    // First-click is the introducer = Meta.
    expect(c.firstTouchSource).toBe('meta-paid');
    expect(c.firstFbclidPresent).toBe(true);
    expect(c.firstGclidPresent).toBe(false);
    expect(c.firstUtmSource).toBe('facebook');
    expect(c.firstUtmCampaign).toBe('Intro Campaign');
    expect(c.firstUtmId).toBe('camp-first-1');
    expect(c.firstUtmContent).toBe('ad-first-1');
    expect(c.firstUtmTerm).toBe('adset-first-1');
    expect(c.firstSeenAt).toBe('2026-06-01T10:00:00.000Z');
  });

  it('first-click chain is TRIMMED: ignores source_name and referring_site', () => {
    // source_name=tiktok and an fb referrer would change LAST-click, but the
    // first-click chain must NOT consult them — only ft_* keys.
    const c = classifyOrderAttribution({
      landing_site: 'https://x.com/',
      referring_site: 'https://facebook.com/',
      source_name: 'tiktok',
      note_attributes: [
        { name: 'ft_ttclid', value: 'TTFIRST' },
      ],
    });
    // First-click resolves from ft_ttclid alone → tiktok-paid.
    expect(c.firstTouchSource).toBe('tiktok-paid');
    expect(c.firstTtclidPresent).toBe(true);
    // No ft_utm_* present.
    expect(c.firstUtmSource).toBeNull();
  });

  it('first-click utm chain mirrors last-click cpc/source classification', () => {
    const c = classifyOrderAttribution({
      landing_site: 'https://x.com/',
      note_attributes: [
        { name: 'ft_utm_source', value: 'tiktok' },
        { name: 'ft_utm_medium', value: 'paidsocial' },
      ],
    });
    expect(c.firstTouchSource).toBe('tiktok-paid');
  });

  it('ft_* keys with only utm_source (no medium, no clid) → other-paid', () => {
    const c = classifyOrderAttribution({
      landing_site: 'https://x.com/',
      note_attributes: [{ name: 'ft_utm_source', value: 'influencer-x' }],
    });
    expect(c.firstTouchSource).toBe('other-paid');
  });
});
