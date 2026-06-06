import { describe, it, expect } from 'vitest';
import { fbcIsFreshClick, classifyOrderAttribution } from '@/lib/attribution/classifyOrderSource';

// Meta `_fbc` cookie = `fb.<subdomainIndex>.<creationTimeMs>.<fbclid>` (official
// spec). creationTime is the click time; Meta's DEFAULT attribution is 7-day
// click — so the cookie should only count as a paid signal when its click is
// within 7 days of the order. Its 90-day persistence must NOT over-attribute.
const ORDER = '2026-06-05T12:00:00Z';
const fbcAt = (iso: string) => `fb.1.${Date.parse(iso)}.AbCdEffbclid123`;

describe('fbcIsFreshClick — Meta 7-day click window', () => {
  it('click 2 days before order → fresh (true)', () => {
    expect(fbcIsFreshClick(fbcAt('2026-06-03T12:00:00Z'), ORDER)).toBe(true);
  });
  it('click exactly 7 days before → fresh (boundary, true)', () => {
    expect(fbcIsFreshClick(fbcAt('2026-05-29T12:00:00Z'), ORDER)).toBe(true);
  });
  it('click 30 days before → stale (false)', () => {
    expect(fbcIsFreshClick(fbcAt('2026-05-06T12:00:00Z'), ORDER)).toBe(false);
  });
  it('click AFTER the order → false', () => {
    expect(fbcIsFreshClick(fbcAt('2026-06-06T12:00:00Z'), ORDER)).toBe(false);
  });
  it('missing / malformed cookie → false', () => {
    expect(fbcIsFreshClick(undefined, ORDER)).toBe(false);
    expect(fbcIsFreshClick(null, ORDER)).toBe(false);
    expect(fbcIsFreshClick('', ORDER)).toBe(false);
    expect(fbcIsFreshClick('garbage', ORDER)).toBe(false);
    expect(fbcIsFreshClick('fb.1.notanumber.x', ORDER)).toBe(false);
    expect(fbcIsFreshClick('fb.1', ORDER)).toBe(false);
  });
  it('no order date → false (cannot verify freshness, do not over-attribute)', () => {
    expect(fbcIsFreshClick(fbcAt('2026-06-03T12:00:00Z'), null)).toBe(false);
  });
});

describe('classifyOrderAttribution — _fbc cookie gating', () => {
  const mk = (landing: string, created_at: string | null) =>
    ({ landing_site: landing, created_at, note_attributes: [] }) as Parameters<typeof classifyOrderAttribution>[0];

  it('fresh _fbc cookie (3 days) → meta-paid', () => {
    const r = classifyOrderAttribution(mk(`https://shop.com/?_fbc=${fbcAt('2026-06-02T12:00:00Z')}`, ORDER));
    expect(r.source).toBe('meta-paid');
  });
  it('stale _fbc cookie (60 days) → NOT meta-paid', () => {
    const r = classifyOrderAttribution(mk(`https://shop.com/?_fbc=${fbcAt('2026-04-06T12:00:00Z')}`, ORDER));
    expect(r.source).not.toBe('meta-paid');
  });
  it('real fbclid URL param → meta-paid (fresh signal, regardless of cookie)', () => {
    const r = classifyOrderAttribution(mk('https://shop.com/?fbclid=AbCd123', ORDER));
    expect(r.source).toBe('meta-paid');
  });
});
