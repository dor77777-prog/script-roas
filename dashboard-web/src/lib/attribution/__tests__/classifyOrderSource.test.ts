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
