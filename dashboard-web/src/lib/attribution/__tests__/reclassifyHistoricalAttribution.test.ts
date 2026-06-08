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
  utm_content: null,
  utm_id: null,
  utm_term: null,
  fbclid_present: null,
  gclid_present: null,
  referrer: null,
  first_touch_source: null,
  first_utm_source: null,
  first_utm_medium: null,
  first_utm_campaign: null,
  first_utm_content: null,
  first_utm_id: null,
  first_utm_term: null,
  first_fbclid_present: null,
  first_gclid_present: null,
  first_ttclid_present: null,
  first_seen_at: null,
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

describe('reclassifyStoredRow — never DOWNGRADES a stored *-paid (data-loss guard)', () => {
  // (a) clid INPUT now reconstructed from fbclid_present → re-derives meta-paid
  // (the clid branch fires) OR the guard keeps it. Either way: NO source change.
  it('keeps meta-paid when utm_source empty but fbclid_present=true (clid reconstructed)', () => {
    const row: StoredAttributionRow = {
      ...base,
      source: 'meta-paid',
      utm_source: '', // empty — only the click-id drove the original classification
      fbclid_present: true,
    };
    const r = reclassifyStoredRow(row);
    expect(r.newSource).toBe('meta-paid');
    expect(r.sourceChanged).toBe(false);
  });

  it('keeps google-paid when utm_source empty but gclid_present=true', () => {
    const row: StoredAttributionRow = {
      ...base,
      source: 'google-paid',
      utm_source: '',
      gclid_present: true,
    };
    const r = reclassifyStoredRow(row);
    expect(r.newSource).toBe('google-paid');
    expect(r.sourceChanged).toBe(false);
  });

  // (b) source_name-driven paid with NO clid columns → NOT re-derivable; the
  // guard alone must keep it (NO downgrade to direct/other-*).
  it('keeps meta-paid when utm_source empty AND no clid (source_name-driven) — guard', () => {
    const row: StoredAttributionRow = {
      ...base,
      source: 'meta-paid', // was source_name='fb' on the live path
      utm_source: '',
      // no fbclid_present, no referrer, no utm → recompute would be 'direct'
    };
    const r = reclassifyStoredRow(row);
    expect(r.newSource).toBe('meta-paid'); // guard keeps it, NOT 'direct'
    expect(r.sourceChanged).toBe(false);
  });

  // (c) ttclid has NO last-touch stored column, so it can NEVER be reconstructed
  // → the guard is the only protection. A stored tiktok-paid with no signal must
  // stay tiktok-paid.
  it('keeps tiktok-paid when utm_source empty AND no signal (ttclid not stored) — guard', () => {
    const row: StoredAttributionRow = {
      ...base,
      source: 'tiktok-paid', // was ttclid- or source_name='tiktok'-driven
      utm_source: '',
    };
    const r = reclassifyStoredRow(row);
    expect(r.newSource).toBe('tiktok-paid'); // guard keeps it, NOT 'direct'
    expect(r.sourceChanged).toBe(false);
  });

  it('keeps google-paid even when a non-platform referrer would recompute other-referral', () => {
    // A clid-only google-paid that ALSO happens to carry a stored referrer:
    // without the guard this recomputes to other-referral (a DOWNGRADE).
    const row: StoredAttributionRow = {
      ...base,
      source: 'google-paid',
      utm_source: '',
      referrer: 'someblog.example/post',
    };
    const r = reclassifyStoredRow(row);
    expect(r.newSource).toBe('google-paid');
    expect(r.sourceChanged).toBe(false);
  });
});

describe('reclassifyStoredRow — never NULLS / EMPTIES a stored non-null first_touch_source', () => {
  // (d) clid-only first click stored as meta-paid with null first_utm_* → without
  // the completed inputs + guard this recomputes to null (data loss).
  it('keeps first_touch_source=meta-paid when first_fbclid_present=true (no first_utm_*)', () => {
    const row: StoredAttributionRow = {
      ...base,
      source: 'direct',
      first_touch_source: 'meta-paid',
      first_fbclid_present: true,
      // first_utm_* all null
    };
    const r = reclassifyStoredRow(row);
    expect(r.newFirstTouchSource).toBe('meta-paid');
    expect(r.firstTouchChanged).toBe(false);
  });

  it('keeps first_touch_source=tiktok-paid when first_ttclid_present=true', () => {
    const row: StoredAttributionRow = {
      ...base,
      source: 'direct',
      first_touch_source: 'tiktok-paid',
      first_ttclid_present: true,
    };
    const r = reclassifyStoredRow(row);
    expect(r.newFirstTouchSource).toBe('tiktok-paid');
    expect(r.firstTouchChanged).toBe(false);
  });

  it('keeps a stored non-null first_touch_source even when NO first signal can be reconstructed', () => {
    // Defensive: a stored first_touch_source that we cannot reconstruct at all
    // (no clid cols, no first_utm_*) must NOT be nulled out.
    const row: StoredAttributionRow = {
      ...base,
      source: 'direct',
      first_touch_source: 'meta-paid', // source_name-style first touch, unreconstructable
    };
    const r = reclassifyStoredRow(row);
    expect(r.newFirstTouchSource).toBe('meta-paid'); // guard keeps it, NOT null
    expect(r.firstTouchChanged).toBe(false);
  });
});

describe('reclassifyStoredRow — intended upgrades STILL apply (guard only blocks downgrades)', () => {
  it('still promotes other-paid → email (shopify_email)', () => {
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

  it('still promotes other-referral → tiktok-organic (tiktok.com referrer)', () => {
    const row: StoredAttributionRow = {
      ...base,
      source: 'other-referral',
      referrer: 'www.tiktok.com/@someone',
    };
    const r = reclassifyStoredRow(row);
    expect(r.newSource).toBe('tiktok-organic');
    expect(r.sourceChanged).toBe(true);
  });

  it('still promotes other-paid → google-paid (product_sync) — same-or-upgrade, allowed', () => {
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

  it('still UPGRADES first_touch_source other-paid → google-paid (product_sync)', () => {
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
