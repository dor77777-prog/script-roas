/**
 * storeColors.test.ts — A1-F5 / A6-S2 contract test.
 *
 * Before centralisation, STORE_COLORS was defined three times with conflicting
 * hex values (PerStoreCards used red/green, TodayLive used a darker red/green,
 * RoasChart used amber/teal). This test pins the canonical values so any
 * accidental drift in storeColors.ts is caught immediately.
 */

import { describe, expect, it } from 'vitest';
import { STORE_COLORS, storeColor } from '@/lib/storeColors';

const KNOWN_STORES = ['uzoshop', 'Zol Plus', '360usmile'] as const;

describe('storeColors — canonical single-source palette (A1-F5 / A6-S2)', () => {
  it('all three known stores are keyed in STORE_COLORS', () => {
    for (const store of KNOWN_STORES) {
      expect(STORE_COLORS).toHaveProperty(store);
      expect(typeof STORE_COLORS[store]).toBe('string');
      expect(STORE_COLORS[store]).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('storeColor() returns the same value for a given store regardless of call site', () => {
    for (const store of KNOWN_STORES) {
      // idx=0 is irrelevant for known stores (direct lookup wins)
      expect(storeColor(store, 0)).toBe(STORE_COLORS[store]);
      expect(storeColor(store, 1)).toBe(STORE_COLORS[store]);
      expect(storeColor(store, 99)).toBe(STORE_COLORS[store]);
    }
  });

  it('uzoshop is navy (#1c4587) — the dominant primary store', () => {
    expect(STORE_COLORS.uzoshop).toBe('#1c4587');
  });

  it('Zol Plus is amber (#d97706) — warm hue, distinct from navy', () => {
    expect(STORE_COLORS['Zol Plus']).toBe('#d97706');
  });

  it('360usmile is teal (#0d9488) — cool hue, distinct from navy and amber', () => {
    expect(STORE_COLORS['360usmile']).toBe('#0d9488');
  });

  it('unknown store falls back to a non-empty hex string', () => {
    const color = storeColor('unknown-future-store', 0);
    expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it('fallback cycles by index for unknown stores', () => {
    const color0 = storeColor('future-store-a', 0);
    const color1 = storeColor('future-store-b', 1);
    // Different indices should (generally) produce different colors
    expect(color0).not.toBe(color1);
  });
});
