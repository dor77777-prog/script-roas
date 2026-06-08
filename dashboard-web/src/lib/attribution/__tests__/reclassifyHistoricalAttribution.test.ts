import { describe, it, expect } from 'vitest';
import {
  reclassifyStoredRow,
  type StoredAttributionRow,
} from '../../../../scripts/reclassifyHistoricalAttribution';

/**
 * Unit tests for the PURE reclassification core used by the classify-v2
 * reclassify-history backfill runner (scripts/reclassifyHistoricalAttribution.ts).
 *
 * The runner cannot re-fetch from Shopify (orders_attribution stores neither
 * landing_site nor source_name), so it RECONSTRUCTS classifier inputs from the
 * stored utm_* columns + the trimmed `referrer`, then re-runs
 * classifyOrderAttribution. These tests pin which classify-v2 rules are
 * re-derivable from stored data and which are NOT (self-referral).
 */

const base: StoredAttributionRow = {
  source: null,
  utm_source: null,
  utm_medium: null,
  utm_campaign: null,
  utm_id: null,
  utm_term: null,
  referrer: null,
  first_touch_source: null,
  first_utm_source: null,
  first_utm_medium: null,
};

describe('reclassifyStoredRow — classify-v2 rules re-derivable from stored columns', () => {
  it('promotes shopify_email (utm_source) + utm_medium=email from other-paid → email', () => {
    const row: StoredAttributionRow = {
      ...base,
      source: 'other-paid',
      utm_source: 'shopify_email',
      utm_medium: 'email',
    };
    const r = reclassifyStoredRow(row);
    expect(r.newSource).toBe('email');
    expect(r.sourceChanged).toBe(true);
  });

  it('classifies klaviyo utm_source (medium not email) → email', () => {
    const row: StoredAttributionRow = {
      ...base,
      source: 'other-paid',
      utm_source: 'klaviyo',
      utm_medium: 'newsletter',
    };
    expect(reclassifyStoredRow(row).newSource).toBe('email');
  });

  it('classifies Google Merchant feed (utm_medium=product_sync) → google-paid', () => {
    const row: StoredAttributionRow = {
      ...base,
      source: 'other-paid',
      utm_source: 'g',
      utm_medium: 'product_sync',
    };
    const r = reclassifyStoredRow(row);
    expect(r.newSource).toBe('google-paid');
    expect(r.sourceChanged).toBe(true);
  });

  it('reclassifies tiktok.com referrer other-referral → tiktok-organic', () => {
    const row: StoredAttributionRow = {
      ...base,
      source: 'other-referral',
      referrer: 'www.tiktok.com/@someone',
    };
    const r = reclassifyStoredRow(row);
    expect(r.newSource).toBe('tiktok-organic');
    expect(r.sourceChanged).toBe(true);
  });

  it('reclassifies bing referrer other-referral → search-organic', () => {
    const row: StoredAttributionRow = {
      ...base,
      source: 'other-referral',
      referrer: 'bing.com/search?q=x',
    };
    expect(reclassifyStoredRow(row).newSource).toBe('search-organic');
  });

  it('reclassifies android-app referrer (scheme survives stored trim) → app-referral', () => {
    const row: StoredAttributionRow = {
      ...base,
      source: 'other-referral',
      // The write-time refTrimmed only strips http(s)://, so android-app:// is
      // preserved in the stored `referrer` — app-referral is re-derivable.
      referrer: 'android-app://com.google.android.gm',
    };
    const r = reclassifyStoredRow(row);
    expect(r.newSource).toBe('app-referral');
    expect(r.sourceChanged).toBe(true);
  });

  it('reclassifies first_touch_source product_sync → google-paid (UTM-only ft chain)', () => {
    const row: StoredAttributionRow = {
      ...base,
      source: 'direct',
      first_touch_source: 'other-paid',
      first_utm_source: 'g',
      first_utm_medium: 'product_sync',
    };
    const r = reclassifyStoredRow(row);
    expect(r.newFirstTouchSource).toBe('google-paid');
    expect(r.firstTouchChanged).toBe(true);
    // last-touch has no signal → direct, unchanged from stored 'direct'.
    expect(r.sourceChanged).toBe(false);
  });
});

describe('reclassifyStoredRow — DOCUMENTED limitation: self-referral NOT re-derivable', () => {
  it('leaves a self-referral row (other-referral) UNCHANGED — landing_site host not stored', () => {
    // On the live path this would be self-referral → direct (referrer host ==
    // landing host). But landing_site is NOT stored; the synthetic landing has
    // no host, so isSelfReferral() cannot fire. Row keeps its old source.
    const row: StoredAttributionRow = {
      ...base,
      source: 'other-referral',
      referrer: 'uzoshop.com/products/x', // would equal the store's own host
    };
    const r = reclassifyStoredRow(row);
    expect(r.newSource).toBe('other-referral');
    expect(r.sourceChanged).toBe(false);
  });
});

describe('reclassifyStoredRow — idempotency / no spurious changes', () => {
  it('does NOT flag an already-correct meta-paid row (utm_source=facebook)', () => {
    const row: StoredAttributionRow = {
      ...base,
      source: 'meta-paid',
      utm_source: 'facebook',
      utm_medium: 'cpc',
    };
    const r = reclassifyStoredRow(row);
    expect(r.newSource).toBe('meta-paid');
    expect(r.sourceChanged).toBe(false);
  });

  it('does NOT flag a genuine other-referral (non-platform host) — stays other-referral', () => {
    const row: StoredAttributionRow = {
      ...base,
      source: 'other-referral',
      referrer: 'someblog.example/post',
    };
    const r = reclassifyStoredRow(row);
    expect(r.newSource).toBe('other-referral');
    expect(r.sourceChanged).toBe(false);
  });

  it('does NOT flag a clean direct row (no utm, no referrer)', () => {
    const row: StoredAttributionRow = { ...base, source: 'direct' };
    const r = reclassifyStoredRow(row);
    expect(r.newSource).toBe('direct');
    expect(r.sourceChanged).toBe(false);
    expect(r.firstTouchChanged).toBe(false);
  });

  it('null first_touch_source stays null (no fabricated first-click)', () => {
    const row: StoredAttributionRow = {
      ...base,
      source: 'direct',
      first_touch_source: null,
    };
    const r = reclassifyStoredRow(row);
    expect(r.newFirstTouchSource).toBeNull();
    expect(r.firstTouchChanged).toBe(false);
  });
});
