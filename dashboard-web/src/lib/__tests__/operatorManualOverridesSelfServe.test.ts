/**
 * Self-serve stores — manual-overrides validation must accept a 4th active
 * store id. validatePost takes an optional validStores set (resolved at request
 * time from the active store list); without it, it falls back to the static
 * VALID_STORES so existing callers/tests stay byte-identical.
 */
import { describe, expect, it } from 'vitest';
import { validatePost, VALID_STORES } from '@/lib/operatorManualOverrides';

const BASE = { date: '2026-05-20', platform: 'tiktok', currency: 'CAD', spend: 100, notes: null };

describe('validatePost — self-serve store id validation', () => {
  it('accepts a 4th active store id when given a validStores set including it', () => {
    const validStores = new Set(['uzoshop', 'zolplus', 'usmile360', 'pdrn-skin']);
    const result = validatePost({ ...BASE, store_id: 'pdrn-skin' }, validStores);
    expect(typeof result).not.toBe('string'); // accepted, not an error
    expect((result as { store_id: string }).store_id).toBe('pdrn-skin');
  });

  it('rejects a store id NOT in the supplied validStores set', () => {
    const validStores = new Set(['uzoshop']);
    const result = validatePost({ ...BASE, store_id: 'ghost' }, validStores);
    expect(typeof result).toBe('string');
    expect(result).toMatch(/unknown store_id/);
  });

  it('falls back to the static VALID_STORES when no set is supplied (byte-identical for the 3)', () => {
    expect(VALID_STORES.has('uzoshop')).toBe(true);
    const ok = validatePost({ ...BASE, store_id: 'uzoshop' });
    expect(typeof ok).not.toBe('string');
    const bad = validatePost({ ...BASE, store_id: 'pdrn-skin' });
    expect(typeof bad).toBe('string'); // not in the static 3 → rejected when no set
  });
});
