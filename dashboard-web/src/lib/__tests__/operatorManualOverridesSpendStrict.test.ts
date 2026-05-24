import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { validatePost } from '@/app/api/operator/manual-overrides/route';

/**
 * AUDIT regression (Phase 12.3 / 2026-05-24) — API-26:
 * /api/operator/manual-overrides lax numeric spend validation.
 *
 *   Original bug (API-26):
 *     route.ts:84 (POST validatePost) and route.ts:209 (PATCH spend branch)
 *     used `parseFloat(String(b.spend))` + `Number.isFinite`. parseFloat
 *     SILENTLY truncates trailing garbage — `parseFloat('1500NIS')` returns
 *     1500, `parseFloat('1.5xyz')` returns 1.5. The operator's typo'd input
 *     would have been INSERTED into manual_overrides with the suffix
 *     discarded — silent data corruption.
 *
 *   12.3 fix:
 *     Replace parseFloat with `parseStrictNumeric` — a helper that does:
 *       1. typeof === 'number' → pass through (backward compat).
 *       2. typeof === 'string' → regex pre-check (/^-?\d+(\.\d+)?$/) +
 *          Number() coercion. Anything that doesn't match the regex
 *          returns NaN and trips the existing `!Number.isFinite` check.
 *     Mirrored in both POST and PATCH paths.
 *
 * Evidence pack:
 *   .planning/phases/12-codebase-audit-baseline/raw-returns/
 *     api_operator_manualOverrides.json (API-26 lines 7-16)
 */

const VALID_BASE = {
  date: '2026-05-20',
  store_id: 'uzoshop',
  platform: 'meta',
  currency: 'CAD',
  notes: 'test',
};

describe('manual-overrides spend strict validation (Phase 12.3 / API-26)', () => {
  describe('POST validatePost — rejects garbage suffixes', () => {
    it("Test 1a: spend='1500NIS' returns error 'spend must be numeric'", () => {
      const result = validatePost({ ...VALID_BASE, spend: '1500NIS' });
      expect(typeof result).toBe('string');
      expect(result).toMatch(/spend must be numeric/);
    });
    it("Test 1b: spend='1.5xyz' returns error 'spend must be numeric'", () => {
      const result = validatePost({ ...VALID_BASE, spend: '1.5xyz' });
      expect(typeof result).toBe('string');
      expect(result).toMatch(/spend must be numeric/);
    });
    it("Test 1c: spend='NaN' returns error 'spend must be numeric'", () => {
      const result = validatePost({ ...VALID_BASE, spend: 'NaN' });
      expect(typeof result).toBe('string');
      expect(result).toMatch(/spend must be numeric/);
    });
  });

  describe('POST validatePost — accepts valid numerics (no regression)', () => {
    it('Test 2a: spend=1500 (number) is accepted', () => {
      const result = validatePost({ ...VALID_BASE, spend: 1500 });
      expect(typeof result).toBe('object');
      expect((result as { spend: number }).spend).toBe(1500);
    });
    it("Test 2b: spend='1500' (numeric string) is accepted", () => {
      const result = validatePost({ ...VALID_BASE, spend: '1500' });
      expect(typeof result).toBe('object');
      expect((result as { spend: number }).spend).toBe(1500);
    });
    it("Test 2c: spend='1500.75' (decimal string) is accepted", () => {
      const result = validatePost({ ...VALID_BASE, spend: '1500.75' });
      expect(typeof result).toBe('object');
      expect((result as { spend: number }).spend).toBe(1500.75);
    });
    it("Test 2d: spend='-50' (negative string, used for refunds) is accepted", () => {
      const result = validatePost({ ...VALID_BASE, spend: '-50' });
      expect(typeof result).toBe('object');
      expect((result as { spend: number }).spend).toBe(-50);
    });
  });

  describe('PATCH path mirror — same strict validation', () => {
    beforeEach(() => {
      vi.resetModules();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("Test 3: PATCH with spend='1500NIS' returns HTTP 400 with 'spend must be numeric'", async () => {
      // Mock supabaseAdmin so PATCH doesn't try to actually call out.
      vi.doMock('@/lib/supabaseAdmin', () => ({
        getSupabaseAdmin: () => ({
          from: () => ({
            update: () => ({
              eq: () => ({
                select: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          }),
        }),
      }));
      const { PATCH } = await import('@/app/api/operator/manual-overrides/route');
      const req = new Request('http://localhost/api/operator/manual-overrides', {
        method: 'PATCH',
        body: JSON.stringify({ id: 5, spend: '1500NIS' }),
      });
      const res = await PATCH(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/spend must be numeric/);
    });
  });
});
