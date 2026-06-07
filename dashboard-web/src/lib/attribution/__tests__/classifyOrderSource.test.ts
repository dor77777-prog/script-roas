import { describe, it, expect } from 'vitest';
import {
  detectAdPlatform,
  classifyOrderSource,
  classifyOrderAttribution,
} from '@/lib/attribution/classifyOrderSource';

/**
 * Broadened ad-platform detection from messy real-world utm_source values.
 *
 * Calibrated from production `orders_attribution` data (2026-06): the strict
 * exact-match chain (`^(facebook|fb|meta|instagram|ig)$`) demoted very common
 * ad utm_source values — `Facebook_Mobile_Feed`, `Instagram_Stories`, `meta`,
 * `ig`, `an`, `goog`, Hebrew `פייסבוק` — to `other-paid` (shown as "ישיר").
 * The "balanced" ruleset: substring of full brand names + Hebrew + safe
 * known tokens/abbreviations. Genuinely non-platform sources
 * (`copyToPasteBoard` shares, influencer names) MUST stay null/other-paid.
 */
describe('detectAdPlatform — balanced real-world utm_source matching', () => {
  const META = [
    'facebook',
    'Facebook',
    'fb',
    'FB',
    'Facebook_Mobile_Feed',
    'Facebook_Mobile_Reels',
    'Facebook_Stories',
    'Instagram_Stories',
    'Instagram_Feed',
    'Instagram_Reels',
    'instagram',
    'ig',
    'IG',
    'meta',
    'fa',
    'face',
    'faceb',
    'an', // Meta Audience Network
    'פייסבוק',
    'אינסטגרם',
    'fb_retargeting',
    'ig-story',
    'meta.ads',
  ];
  const GOOGLE = ['google', 'Google', 'youtube', 'goog', 'gads', 'gdn', 'Google_Search', 'goog_pmax'];
  const TIKTOK = ['tiktok', 'TikTok', 'tt', 'bytedance', 'tiktok_ads', 'tt-spark'];
  const NONE = [
    'copyToPasteBoard', // native share/copy-link — NOT a paid platform
    'shopify_email',
    'influencer-x',
    'נועה פרטוש', // influencer recommendation name
    'web',
    'an-influencer', // 'an' only matches when standalone (no false positive)
    'fashion', // must not match 'fa'
    'metallica', // must not match 'meta'
    'answer', // must not match 'an'
    '',
    '   ',
  ];

  for (const s of META) it(`maps "${s}" → meta`, () => expect(detectAdPlatform(s)).toBe('meta'));
  for (const s of GOOGLE) it(`maps "${s}" → google`, () => expect(detectAdPlatform(s)).toBe('google'));
  for (const s of TIKTOK) it(`maps "${s}" → tiktok`, () => expect(detectAdPlatform(s)).toBe('tiktok'));
  for (const s of NONE) it(`maps ${JSON.stringify(s)} → null`, () => expect(detectAdPlatform(s)).toBeNull());

  it('handles null/undefined', () => {
    expect(detectAdPlatform(null)).toBeNull();
    expect(detectAdPlatform(undefined)).toBeNull();
  });
});

describe('classifyOrderSource — platform detection wired into the source chain', () => {
  const ls = (qs: string) => classifyOrderSource({ landing_site: `/?${qs}` });

  it('Facebook_Mobile_Feed + cpc → meta-paid (was other-paid)', () => {
    expect(ls('utm_source=Facebook_Mobile_Feed&utm_medium=cpc')).toBe('meta-paid');
  });
  it('Instagram_Stories + cpc → meta-paid (was other-paid)', () => {
    expect(ls('utm_source=Instagram_Stories&utm_medium=cpc')).toBe('meta-paid');
  });
  it('platform beats medium: facebook with NO medium → meta-paid', () => {
    expect(ls('utm_source=facebook')).toBe('meta-paid');
  });
  it('Hebrew פייסבוק → meta-paid', () => {
    expect(ls('utm_source=%D7%A4%D7%99%D7%99%D7%A1%D7%91%D7%95%D7%A7&utm_medium=cpc')).toBe('meta-paid');
  });
  it('an (audience network) + cpc → meta-paid', () => {
    expect(ls('utm_source=an&utm_medium=cpc')).toBe('meta-paid');
  });
  it('goog + product_sync → google-paid', () => {
    expect(ls('utm_source=goog&utm_medium=product_sync')).toBe('google-paid');
  });
  it('tiktok variants → tiktok-paid', () => {
    expect(ls('utm_source=tt&utm_medium=cpc')).toBe('tiktok-paid');
  });
  it('copyToPasteBoard share link stays other-paid (NOT a platform)', () => {
    expect(ls('utm_source=copyToPasteBoard&utm_medium=product-links')).toBe('other-paid');
  });
  it('unknown paid source stays other-paid', () => {
    expect(ls('utm_source=influencer-x&utm_medium=cpc')).toBe('other-paid');
  });
  it('no utm at all → direct', () => {
    expect(classifyOrderSource({ landing_site: '/' })).toBe('direct');
  });
  it('click-id still wins over utm_source: ttclid + utm_source=Facebook_Mobile_Feed → tiktok-paid', () => {
    expect(ls('ttclid=ABC&utm_source=Facebook_Mobile_Feed')).toBe('tiktok-paid');
  });
});

describe('classifyOrderAttribution — first-touch chain mirrors the broadened matching', () => {
  it('ft_utm_source=Instagram_Feed (no medium) → first-touch meta-paid', () => {
    const c = classifyOrderAttribution({
      landing_site: '/',
      note_attributes: [{ name: 'ft_utm_source', value: 'Instagram_Feed' }],
    });
    expect(c.firstTouchSource).toBe('meta-paid');
  });
  it('ft_utm_source=copyToPasteBoard → first-touch other-paid (unchanged)', () => {
    const c = classifyOrderAttribution({
      landing_site: '/',
      note_attributes: [{ name: 'ft_utm_source', value: 'copyToPasteBoard' }],
    });
    expect(c.firstTouchSource).toBe('other-paid');
  });
});

/**
 * Diag-driven classifier expansion (production, 1388 orders, 2026-06):
 *  - shopify_email/utm_medium=email were hiding in other-paid → email
 *  - utm_medium=product_sync (Google Merchant feed) was unrecognized → google-paid
 *  - 18 self-referrals (referring_site host == landing_site host) were
 *    other-referral → must fall through to direct (NOT an external referral)
 *  - tiktok.com referrer was other-referral → tiktok-organic
 *  - bing/ddg/ecosia/yahoo referrers were other-referral → search-organic
 *  - android-app:/ios-app: referrers were other-referral → app-referral
 * ZERO REGRESSION: every existing classification stays identical.
 */
describe('classifyOrderSource — diag-driven expansion (last-touch)', () => {
  const ls = (qs: string) => classifyOrderSource({ landing_site: `/?${qs}` });

  // 1. Email broadening
  it('utm_source=shopify_email + utm_medium=email → email (was other-paid)', () => {
    expect(ls('utm_source=shopify_email&utm_medium=email')).toBe('email');
  });
  it('utm_medium=email alone (no recognizable source) → email', () => {
    expect(ls('utm_source=somethingrandom&utm_medium=email')).toBe('email');
  });
  it('utm_source=foo_email → email (suffix _email)', () => {
    expect(ls('utm_source=foo_email&utm_medium=cpc')).toBe('email');
  });
  it('exact utm_source=klaviyo still → email (zero regression)', () => {
    expect(ls('utm_source=klaviyo')).toBe('email');
  });
  it('exact utm_source=newsletter still → email (zero regression)', () => {
    expect(ls('utm_source=newsletter')).toBe('email');
  });

  // 2. Google Shopping product feed
  it('utm_medium=product_sync (unrecognized source) → google-paid', () => {
    expect(ls('utm_source=mystery&utm_medium=product_sync')).toBe('google-paid');
  });
  it('utm_medium=product_sync with no source → google-paid', () => {
    expect(ls('utm_medium=product_sync')).toBe('google-paid');
  });
  it('bare utm_source=g (no product_sync) is NOT forced to google → other-paid', () => {
    // 'g' is too ambiguous; only product_sync medium is the reliable signal.
    expect(ls('utm_source=g')).toBe('other-paid');
  });

  // 4. TikTok organic referrer
  it('tiktok.com referrer → tiktok-organic (was other-referral)', () => {
    expect(
      classifyOrderSource({ landing_site: '/', referring_site: 'https://www.tiktok.com/@someone' }),
    ).toBe('tiktok-organic');
  });

  // 5. Search-engine organic referrers
  for (const host of ['bing.com', 'duckduckgo.com', 'ecosia.org', 'search.yahoo.com']) {
    it(`${host} referrer → search-organic`, () => {
      expect(
        classifyOrderSource({ landing_site: '/', referring_site: `https://www.${host}/` }),
      ).toBe('search-organic');
    });
  }

  // 6. App referrers
  it('android-app: referrer → app-referral (was other-referral)', () => {
    expect(
      classifyOrderSource({ landing_site: '/', referring_site: 'android-app://com.google.android.gm/' }),
    ).toBe('app-referral');
  });
  it('ios-app: referrer → app-referral', () => {
    expect(
      classifyOrderSource({ landing_site: '/', referring_site: 'ios-app://com.example.app/' }),
    ).toBe('app-referral');
  });

  // 3. Self-referral → direct (host-equality referring_site vs landing_site)
  it('self-referral (same host on landing+referring) → direct (was other-referral)', () => {
    expect(
      classifyOrderSource({
        landing_site: 'https://360usmile.com/products/widget',
        referring_site: 'https://360usmile.com/collections/all',
      }),
    ).toBe('direct');
  });
  it('self-referral with www on one side only still → direct', () => {
    expect(
      classifyOrderSource({
        landing_site: 'https://www.uzoshop.com/cart',
        referring_site: 'https://uzoshop.com/products/x',
      }),
    ).toBe('direct');
  });
  it('paid/email checks STILL run before self-referral fallthrough', () => {
    // A self-host referrer must NOT swallow a real paid click-id / utm.
    expect(
      classifyOrderSource({
        landing_site: 'https://uzoshop.com/?fbclid=ABC',
        referring_site: 'https://uzoshop.com/products/x',
      }),
    ).toBe('meta-paid');
  });

  // Real external referral stays other-referral (zero regression).
  it('external non-platform referrer stays other-referral', () => {
    expect(
      classifyOrderSource({ landing_site: '/', referring_site: 'https://news.example.com/article' }),
    ).toBe('other-referral');
  });
  it('bing.com referrer is NOT other-referral anymore (proves search-organic split)', () => {
    expect(
      classifyOrderSource({ landing_site: '/', referring_site: 'https://www.bing.com/search' }),
    ).not.toBe('other-referral');
  });
});

describe('classifyOrderSource — ZERO REGRESSION for existing source values', () => {
  const ls = (qs: string) => classifyOrderSource({ landing_site: `/?${qs}` });

  it('fbclid → meta-paid', () => expect(ls('fbclid=ABC')).toBe('meta-paid'));
  it('gclid → google-paid', () => expect(ls('gclid=ABC')).toBe('google-paid'));
  it('ttclid → tiktok-paid', () => expect(ls('ttclid=ABC')).toBe('tiktok-paid'));
  it('source_name=fb → meta-paid', () =>
    expect(classifyOrderSource({ source_name: 'fb' })).toBe('meta-paid'));
  it('source_name=google → google-paid', () =>
    expect(classifyOrderSource({ source_name: 'google' })).toBe('google-paid'));
  it('source_name=tiktok → tiktok-paid', () =>
    expect(classifyOrderSource({ source_name: 'tiktok' })).toBe('tiktok-paid'));
  it('utm_source=facebook → meta-paid', () => expect(ls('utm_source=facebook')).toBe('meta-paid'));
  it('utm_source=google → google-paid', () => expect(ls('utm_source=google')).toBe('google-paid'));
  it('existing other-paid (medium=paid, no source) stays other-paid', () =>
    expect(ls('utm_medium=paid')).toBe('other-paid'));
  it('existing other-paid (tagged unrecognized source) stays other-paid', () =>
    expect(ls('utm_source=influencer-x')).toBe('other-paid'));
  it('fb.com referrer → meta-organic', () =>
    expect(classifyOrderSource({ landing_site: '/', referring_site: 'https://facebook.com/p' })).toBe(
      'meta-organic',
    ));
  it('google.com referrer → google-organic', () =>
    expect(classifyOrderSource({ landing_site: '/', referring_site: 'https://google.com/' })).toBe(
      'google-organic',
    ));
  it('no signal → direct', () =>
    expect(classifyOrderSource({ landing_site: '/' })).toBe('direct'));
  it('empty everything → direct', () => expect(classifyOrderSource({})).toBe('direct'));
});

describe('classifyOrderAttribution — first-touch symmetry for expansion rules', () => {
  const ft = (attrs: Array<{ name: string; value: string }>) =>
    classifyOrderAttribution({ landing_site: '/', note_attributes: attrs }).firstTouchSource;

  it('ft shopify_email + email medium → first-touch email', () => {
    expect(
      ft([
        { name: 'ft_utm_source', value: 'shopify_email' },
        { name: 'ft_utm_medium', value: 'email' },
      ]),
    ).toBe('email');
  });
  it('ft utm_medium=product_sync → first-touch google-paid', () => {
    expect(
      ft([
        { name: 'ft_utm_source', value: 'mystery' },
        { name: 'ft_utm_medium', value: 'product_sync' },
      ]),
    ).toBe('google-paid');
  });
  it('ft exact klaviyo still → first-touch email (zero regression)', () => {
    expect(ft([{ name: 'ft_utm_source', value: 'klaviyo' }])).toBe('email');
  });
});
