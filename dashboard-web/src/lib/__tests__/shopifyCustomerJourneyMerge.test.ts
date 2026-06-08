/**
 * Task 9 — mergeCustomerJourney unit tests.
 *
 * The helper gap-fills empty UTM fields on a ShopifyOrderRow from a
 * CustomerJourneyEntry (first + last visit). NEVER overwrites a present
 * value, NEVER changes `source`. Flag-off (entry=undefined) is a no-op.
 */

import { describe, expect, it } from 'vitest';
import { mergeCustomerJourney } from '@/lib/attribution/mergeCustomerJourney';
import type { ShopifyOrderRow } from '@/lib/fetchers/shopify';
import type { CustomerJourneyEntry } from '@/lib/fetchers/shopifyCustomerJourney';

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

/** Build a minimal but fully-shaped ShopifyOrderRow. */
function makeRow(overrides: Partial<ShopifyOrderRow> = {}): ShopifyOrderRow {
  return {
    storeId: 'teststore',
    orderId: '111',
    date: '2026-06-07',
    totalCad: 100,
    source: 'direct',
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmContent: null,
    fbclidPresent: false,
    gclidPresent: false,
    referrer: null,
    utmId: null,
    utmTerm: null,
    lineItems: null,
    customerId: null,
    createdAt: null,
    firstTouchSource: null,
    firstFbclidPresent: false,
    firstGclidPresent: false,
    firstTtclidPresent: false,
    firstUtmSource: null,
    firstUtmMedium: null,
    firstUtmCampaign: null,
    firstUtmContent: null,
    firstUtmId: null,
    firstUtmTerm: null,
    firstSeenAt: null,
    paymentGateway: null,
    ...overrides,
  };
}

/** Build a CustomerJourneyEntry with both first + last visits. */
function makeEntry(overrides: Partial<CustomerJourneyEntry> = {}): CustomerJourneyEntry {
  return {
    first: null,
    last: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('mergeCustomerJourney', () => {
  it('gap-fills empty firstUtmId + firstUtmCampaign from entry.first', () => {
    const row = makeRow({
      // last-touch empty
      utmId: null,
      utmCampaign: null,
      // first-touch empty
      firstUtmId: null,
      firstUtmCampaign: null,
    });
    const entry = makeEntry({
      first: {
        landingPage: '/pages/sale?utm_id=c1',
        source: 'google',
        utmSource: 'google',
        utmMedium: 'cpc',
        utmCampaign: 'Sale',
        utmContent: null,
        utmTerm: null,
        utmId: 'c1',
      },
      last: null,
    });

    const merged = mergeCustomerJourney(row, entry);

    // first-touch gap-filled
    expect(merged.firstUtmId).toBe('c1');
    expect(merged.firstUtmCampaign).toBe('Sale');
    expect(merged.firstUtmSource).toBe('google');

    // last-touch not filled (entry.last is null)
    expect(merged.utmId).toBeNull();
    expect(merged.utmCampaign).toBeNull();
  });

  it('never overwrites a present utmId; fills firstUtmId when empty', () => {
    const row = makeRow({
      utmId: 'c9',          // already set — must NOT be overwritten
      firstUtmId: null,     // empty — should be filled from entry.first
      firstUtmCampaign: null,
    });
    const entry = makeEntry({
      first: {
        landingPage: '/pages/sale?utm_id=c1',
        source: 'google',
        utmSource: 'google',
        utmMedium: 'cpc',
        utmCampaign: 'Sale',
        utmContent: null,
        utmTerm: null,
        utmId: 'c1',
      },
      last: {
        landingPage: '/pages/sale?utm_id=c9',
        source: 'google',
        utmSource: 'google',
        utmMedium: 'cpc',
        utmCampaign: 'SummerSale',
        utmContent: null,
        utmTerm: null,
        utmId: 'c9',
      },
    });

    const merged = mergeCustomerJourney(row, entry);

    // last-touch: utmId already 'c9' — NOT overwritten
    expect(merged.utmId).toBe('c9');

    // first-touch: was null — filled from entry.first
    expect(merged.firstUtmId).toBe('c1');
    expect(merged.firstUtmCampaign).toBe('Sale');
  });

  it('never changes source in any scenario', () => {
    const row = makeRow({ source: 'meta-paid' });
    const entry = makeEntry({
      first: {
        landingPage: '/x',
        source: 'tiktok',
        utmSource: 'tiktok',
        utmMedium: 'cpc',
        utmCampaign: 'TikTokCamp',
        utmContent: null,
        utmTerm: null,
        utmId: null,
      },
      last: {
        landingPage: '/y',
        source: 'tiktok',
        utmSource: 'tiktok',
        utmMedium: 'cpc',
        utmCampaign: 'TikTokCamp',
        utmContent: null,
        utmTerm: null,
        utmId: null,
      },
    });

    const merged = mergeCustomerJourney(row, entry);

    expect(merged.source).toBe('meta-paid');
  });

  it('returns the row unchanged when entry is undefined', () => {
    const row = makeRow({ utmSource: 'facebook', utmCampaign: 'CampA' });
    const merged = mergeCustomerJourney(row, undefined);
    // Deep-equal to original (no mutation, no change)
    expect(merged).toEqual(row);
  });

  it('fills last-touch UTM fields from entry.last when empty', () => {
    const row = makeRow({
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmContent: null,
      utmId: null,
      utmTerm: null,
    });
    const entry = makeEntry({
      last: {
        landingPage: '/lp?utm_id=last1',
        source: 'facebook',
        utmSource: 'facebook',
        utmMedium: 'cpc',
        utmCampaign: 'LastCamp',
        utmContent: 'ad123',
        utmTerm: 'adset7',
        utmId: 'last1',
      },
      first: null,
    });

    const merged = mergeCustomerJourney(row, entry);

    expect(merged.utmSource).toBe('facebook');
    expect(merged.utmMedium).toBe('cpc');
    expect(merged.utmCampaign).toBe('LastCamp');
    expect(merged.utmContent).toBe('ad123');
    expect(merged.utmId).toBe('last1');
    expect(merged.utmTerm).toBe('adset7');
  });

  it('does not overwrite non-null last-touch fields even when entry.last has values', () => {
    const row = makeRow({
      utmSource: 'facebook',
      utmCampaign: 'OrigCamp',
    });
    const entry = makeEntry({
      last: {
        landingPage: '/lp',
        source: 'google',
        utmSource: 'google',
        utmMedium: 'cpc',
        utmCampaign: 'NewCamp',
        utmContent: null,
        utmTerm: null,
        utmId: null,
      },
      first: null,
    });

    const merged = mergeCustomerJourney(row, entry);

    expect(merged.utmSource).toBe('facebook');
    expect(merged.utmCampaign).toBe('OrigCamp');
  });

  it('returns a NEW row object (immutability check)', () => {
    const row = makeRow({ utmSource: null });
    const entry = makeEntry({
      last: {
        landingPage: '/lp',
        source: 'google',
        utmSource: 'google',
        utmMedium: null,
        utmCampaign: null,
        utmContent: null,
        utmTerm: null,
        utmId: null,
      },
      first: null,
    });

    const merged = mergeCustomerJourney(row, entry);

    expect(merged).not.toBe(row);
    // original unchanged
    expect(row.utmSource).toBeNull();
  });
});
