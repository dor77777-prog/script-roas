import { describe, it, expect } from 'vitest';
import { parseSource, parseLineItems } from '@/lib/ordersAttribution';
import type { OrderSource } from '@/lib/ordersAttribution';

/**
 * Contract test: every source string emitted by the Apps Script writer
 * (Shopify.gs `classifyOrderAttribution_` lines 759-778) must parse
 * cleanly via `parseSource` in the dashboard. If the writer adds a new
 * source label, this test will keep passing (parseSource is permissive
 * by design — IN5-06), but the new label MUST be added to WRITER_EMITS
 * so the reader-side test is also explicit about what it round-trips.
 *
 * Pins fix for AUDIT-P0-01 — original ORGANIC_SOURCES set had 3
 * impossible labels AND omitted 'google-organic' which Shopify.gs
 * actually emits. The inverted paid-exclusion predicate in
 * MetaShopifyReconciliation.tsx no longer relies on the whitelist, but
 * we still want the writer↔reader contract to be exercised end-to-end.
 */
describe('OrderSource writer↔reader contract', () => {
  // Hard-coded from Shopify.gs:759-778 — every literal the classifier
  // can emit. Keep in sync with Shopify.gs when new buckets are added.
  const WRITER_EMITS = [
    'meta-paid',
    'meta-organic',
    'google-paid',
    'google-organic',
    'tiktok-paid',
    'tiktok-organic',  // diag 2026-06 — tiktok.com referrer
    'search-organic',  // diag 2026-06 — bing/ddg/ecosia/yahoo referrer
    'email',
    'other-paid',
    'other-referral',
    'app-referral',    // diag 2026-06 — android-app:/ios-app: referrer
    'direct',
  ] as const satisfies readonly OrderSource[];

  for (const label of WRITER_EMITS) {
    it(`accepts and round-trips "${label}"`, () => {
      const parsed = parseSource(label);
      expect(parsed).toBe(label);
    });
  }

  it('passes through unknown labels (IN5-06 permissive design)', () => {
    // parseSource is intentionally permissive: a new writer label like
    // 'tiktok-paid' or 'youtube-shopping-paid' should NOT silently
    // collapse to '', otherwise the dashboard goes blind on new
    // categories. The type cast is the documented contract.
    expect(parseSource('tiktok-paid')).toBe('tiktok-paid');
    expect(parseSource('made-up-source')).toBe('made-up-source');
  });

  it('returns empty string for empty/whitespace input', () => {
    expect(parseSource('')).toBe('');
    expect(parseSource('   ')).toBe('');
    expect(parseSource(null)).toBe('');
    expect(parseSource(undefined)).toBe('');
  });

  it('trims surrounding whitespace before classification', () => {
    expect(parseSource('  meta-paid  ')).toBe('meta-paid');
    expect(parseSource('\tgoogle-organic\n')).toBe('google-organic');
  });
});

/**
 * parseLineItems must handle BOTH storage formats that reach it:
 *   - an already-PARSED array (supabase-js decodes the jsonb `line_items`
 *     column to a JS array before our code sees it) — this is the LIVE path
 *     for the /api/activity-stats per-product table.
 *   - a JSON STRING (legacy/text fixtures, the Sheets-era writer).
 *
 * The live bug: the function assumed a string and did
 * `JSON.parse(String(array))` → `JSON.parse('[object Object],[object Object]')`
 * → throws → caught → `[]`. Every product showed 0 purchases. The array
 * test below bites on the broken implementation and is the regression pin.
 */
describe('parseLineItems — supabase jsonb array + legacy JSON string', () => {
  it('parses an already-parsed ARRAY (supabase jsonb — the live path)', () => {
    const out = parseLineItems([
      { p: '123', u: 2, r: 31.1 },
      { p: '456', u: 1, r: 15 },
    ]);
    expect(out).toEqual([
      { productId: '123', units: 2, revenueCad: 31.1 },
      { productId: '456', units: 1, revenueCad: 15 },
    ]);
  });

  it('still parses a JSON STRING (legacy/text — must not regress)', () => {
    const out = parseLineItems(
      JSON.stringify([{ p: '123', u: 2, r: 31.1 }, { p: '456', u: 1, r: 15 }]),
    );
    expect(out).toEqual([
      { productId: '123', units: 2, revenueCad: 31.1 },
      { productId: '456', units: 1, revenueCad: 15 },
    ]);
  });

  it('drops elements with empty/non-string productId in BOTH formats', () => {
    expect(parseLineItems([{ p: '', u: 1, r: 1 }, { p: 'A', u: 1, r: 1 }])).toEqual([
      { productId: 'A', units: 1, revenueCad: 1 },
    ]);
    expect(
      parseLineItems(JSON.stringify([{ p: '', u: 1, r: 1 }, { p: 'A', u: 1, r: 1 }])),
    ).toEqual([{ productId: 'A', units: 1, revenueCad: 1 }]);
  });

  it('returns [] for empty / null / undefined / non-array / malformed', () => {
    expect(parseLineItems(null)).toEqual([]);
    expect(parseLineItems(undefined)).toEqual([]);
    expect(parseLineItems('')).toEqual([]);
    expect(parseLineItems('   ')).toEqual([]);
    expect(parseLineItems('not json')).toEqual([]);
    expect(parseLineItems({ p: '1', u: 1, r: 1 })).toEqual([]); // object, not array
    expect(parseLineItems(42)).toEqual([]);
  });
});
