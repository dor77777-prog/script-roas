import { describe, it, expect } from 'vitest';
import { parseSource } from '@/lib/ordersAttribution';
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
    'email',
    'other-paid',
    'other-referral',
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
