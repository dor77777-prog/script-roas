/**
 * storeColors.test.ts — A1-F5 / A6-S2 contract test.
 *
 * Before Task 1.11 (UI/UX overhaul 2026-05-30), per-store colors were defined
 * in FOUR places with conflicting values:
 *   • storeColors.STORE_COLORS  → chart-store CSS vars (which didn't exist)
 *   • format.STORE_HUES         → store-fg/store-bg CSS vars (which didn't exist)
 *   • format.STORE_HEX_LIGHT    → raw hex literals
 *   • format.storeColor/storeBg → fallback hex arrays
 *
 * Task 1.11 consolidated all four into `@/lib/storeColors` reading from the
 * canonical `--store-uzo / --store-usm / --store-3` tokens. This test pins
 * the new contract and verifies the format.ts duplicates are gone.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { STORE_COLORS, storeColor, storeBadge } from '@/lib/storeColors';
import * as format from '@/lib/format';

const KNOWN_STORES = ['uzoshop', 'Zol Plus', '360usmile'] as const;

describe('storeColors — canonical single-source palette (A1-F5 / A6-S2)', () => {
  it('all three known stores are keyed in STORE_COLORS', () => {
    for (const store of KNOWN_STORES) {
      expect(STORE_COLORS).toHaveProperty(store);
      expect(typeof STORE_COLORS[store]).toBe('string');
      expect(STORE_COLORS[store]).toMatch(/^var\(--store-/);
    }
  });

  it('storeColor() returns the same value for a given store regardless of call site', () => {
    for (const store of KNOWN_STORES) {
      // idx is irrelevant for known stores (direct lookup wins)
      expect(storeColor(store, 0)).toBe(STORE_COLORS[store]);
      expect(storeColor(store, 1)).toBe(STORE_COLORS[store]);
      expect(storeColor(store, 99)).toBe(STORE_COLORS[store]);
    }
  });

  it('uzoshop is keyed to --store-uzo (cyan slot from Task 1.1)', () => {
    expect(STORE_COLORS.uzoshop).toBe('var(--store-uzo)');
  });

  it('360usmile is keyed to --store-usm (magenta slot from Task 1.1)', () => {
    expect(STORE_COLORS['360usmile']).toBe('var(--store-usm)');
  });

  it('Zol Plus is keyed to --store-3 (lime slot from Task 1.1)', () => {
    expect(STORE_COLORS['Zol Plus']).toBe('var(--store-3)');
  });

  it('unknown store falls back to a non-empty hex string', () => {
    const color = storeColor('unknown-future-store', 0);
    expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it('fallback cycles by index for unknown stores', () => {
    const color0 = storeColor('future-store-a', 0);
    const color1 = storeColor('future-store-b', 1);
    expect(color0).not.toBe(color1);
  });
});

describe('storeColor() — brandColor preference (self-serve Phase 6a)', () => {
  it('PREFERS a non-empty brandColor over the name-keyed lookup', () => {
    // A self-serve 4th store with its own chosen token.
    expect(storeColor('Acme Store', 3, 'var(--store-2)')).toBe('var(--store-2)');
  });

  it('PREFERS brandColor even for an UNKNOWN store (no name-key, no fallback)', () => {
    // Without brandColor this store would get FALLBACK_PALETTE[3 % n]; with it,
    // the operator's chosen color wins.
    const withBrand = storeColor('Acme Store', 3, 'var(--store-3)');
    const withoutBrand = storeColor('Acme Store', 3);
    expect(withBrand).toBe('var(--store-3)');
    expect(withBrand).not.toBe(withoutBrand);
  });

  it('falls back to the name-keyed lookup when brandColor is null/undefined/empty', () => {
    // null / undefined / '' / whitespace are all "absent" → name-keyed path.
    expect(storeColor('uzoshop', 0, null)).toBe(STORE_COLORS.uzoshop);
    expect(storeColor('uzoshop', 0, undefined)).toBe(STORE_COLORS.uzoshop);
    expect(storeColor('uzoshop', 0, '')).toBe(STORE_COLORS.uzoshop);
    expect(storeColor('uzoshop', 0, '   ')).toBe(STORE_COLORS.uzoshop);
  });

  it('falls back to FALLBACK_PALETTE for an unknown store when brandColor is absent', () => {
    const color = storeColor('future-store', 3);
    expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it('ZERO-REGRESSION: each of the 3 known stores, when passed THEIR backfilled brandColor, resolves to the EXACT same value as the name-keyed lookup', () => {
    // These brand_color values are the Phase-1 DB backfill
    // (migration 20260606170000) AND the getStores/useStores hardcoded
    // fallback. Preferring brandColor for the 3 must be byte-identical to the
    // name-keyed path — that is the hard zero-regression line.
    const BACKFILL: Record<string, string> = {
      uzoshop: 'var(--store-uzo)',
      'Zol Plus': 'var(--store-3)',
      '360usmile': 'var(--store-usm)',
    };
    for (const store of KNOWN_STORES) {
      expect(storeColor(store, 0, BACKFILL[store])).toBe(storeColor(store, 0));
      expect(storeColor(store, 0, BACKFILL[store])).toBe(STORE_COLORS[store]);
    }
  });
});

describe('storeBadge() — brandColor preference (self-serve Phase 6a)', () => {
  it('fg PREFERS a non-empty brandColor; bg color-mixes that same brandColor', () => {
    const { bg, fg } = storeBadge('Acme Store', 3, 'var(--store-2)');
    expect(fg).toBe('var(--store-2)');
    expect(bg).toContain('color-mix');
    expect(bg).toContain('var(--store-2)');
    expect(bg).toMatch(/16%/);
  });

  it('falls back to the name-keyed badge when brandColor is absent', () => {
    expect(storeBadge('uzoshop', 0, '').fg).toBe(STORE_COLORS.uzoshop);
    expect(storeBadge('uzoshop', 0, null).fg).toBe(STORE_COLORS.uzoshop);
  });

  it('ZERO-REGRESSION: known store + its backfilled brandColor === name-keyed badge', () => {
    expect(storeBadge('uzoshop', 0, 'var(--store-uzo)')).toEqual(
      storeBadge('uzoshop', 0),
    );
  });
});

describe('storeBadge() — bg + fg derived from the same token', () => {
  it('returns an object with `bg` and `fg` keys for every known store', () => {
    for (const store of KNOWN_STORES) {
      const badge = storeBadge(store);
      expect(badge).toHaveProperty('bg');
      expect(badge).toHaveProperty('fg');
      expect(typeof badge.bg).toBe('string');
      expect(typeof badge.fg).toBe('string');
    }
  });

  it('fg matches storeColor() so chart-line and badge-text use the same token', () => {
    for (const store of KNOWN_STORES) {
      expect(storeBadge(store).fg).toBe(storeColor(store));
    }
  });

  it('bg is a color-mix of the fg token at 16% opacity (no second lookup)', () => {
    const { bg, fg } = storeBadge('uzoshop');
    expect(bg).toContain('color-mix');
    expect(bg).toContain(fg);
    expect(bg).toMatch(/16%/);
  });

  it('unknown store gets a deterministic badge from the fallback palette', () => {
    const badge = storeBadge('unknown-future-store', 0);
    expect(badge.fg).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(badge.bg).toContain('color-mix');
  });
});

describe('Task 1.11 — format.ts no longer owns store-color state', () => {
  it('format.ts does NOT export STORE_HUES', () => {
    expect((format as Record<string, unknown>).STORE_HUES).toBeUndefined();
  });

  it('format.ts does NOT export storeBadgeHex', () => {
    expect((format as Record<string, unknown>).storeBadgeHex).toBeUndefined();
  });

  it('format.ts does NOT export storeColor (canonical lives in storeColors.ts)', () => {
    expect((format as Record<string, unknown>).storeColor).toBeUndefined();
  });

  it('format.ts does NOT export storeBg (canonical lives in storeColors.ts)', () => {
    expect((format as Record<string, unknown>).storeBg).toBeUndefined();
  });

  it('format.ts source file no longer contains the deleted identifiers', () => {
    // Source-level check so a future re-introduction (even as a const that
    // isn't re-exported) trips the test.
    const src = readFileSync(
      resolve(__dirname, '../format.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/\bSTORE_HUES\b/);
    expect(src).not.toMatch(/\bSTORE_HEX_LIGHT\b/);
    expect(src).not.toMatch(/\bstoreBadgeHex\b/);
  });
});
