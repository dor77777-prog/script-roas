// dashboard-web/src/lib/fetchers/__tests__/manualOverrides.test.ts
//
// Tests for `mergeOverridesFromSupabase` — the canonical merge step that
// applies operator-typed manual_overrides AFTER Meta/Google fetchers return
// spend values but BEFORE the persist step (plans 08-09 wire it into the
// daily/live Inngest crons).
//
// Mock strategy:
//   - `@/lib/supabaseAdmin`        → `getSupabaseAdmin` returns a stub whose
//                                    `.from('manual_overrides').select(...).eq(...).eq(...)`
//                                    chain awaits to `{ data, error }`.
//   - `@/lib/fetchers/fx`          → `getFxRate` stubbed per test with vi.fn().
//
// Source-of-truth merge semantics: ManualOverrides.gs:71-99 (REPLACE, not add).

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- module-scoped mock state, exposed via hoisted vars ---------------------

const mockState = vi.hoisted(() => {
  return {
    rows: [] as Array<{
      date: string;
      store_id: string;
      platform: string;
      spend: number | string;
      currency: string;
    }>,
    error: null as null | { message: string },
    fxCalls: [] as Array<{ from: string; to: string; date: string }>,
    fxResponder: ((from: string, to: string, date: string) => number) | null,
  };
});

vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col1: string, _val1: string) => ({
          eq: (_col2: string, _val2: string) =>
            Promise.resolve({ data: mockState.rows, error: mockState.error }),
        }),
      }),
    }),
  }),
}));

vi.mock('@/lib/fetchers/fx', () => ({
  getFxRate: vi.fn(async (from: string, to: string, date: string) => {
    mockState.fxCalls.push({ from, to, date });
    if (!mockState.fxResponder) {
      throw new Error(
        `unmocked getFxRate call: ${from}->${to} on ${date} — set mockState.fxResponder in the test`,
      );
    }
    return mockState.fxResponder(from, to, date);
  }),
}));

import { mergeOverridesFromSupabase } from '../manualOverrides';

describe('manualOverrides — mergeOverridesFromSupabase', () => {
  beforeEach(() => {
    mockState.rows = [];
    mockState.error = null;
    mockState.fxCalls = [];
    mockState.fxResponder = null;
  });

  it('returns original input spend unchanged when no override rows exist', async () => {
    // empty manual_overrides table — pass-through path
    mockState.fxResponder = () => {
      throw new Error('FX should NOT be called when both inputs are already CAD');
    };

    const result = await mergeOverridesFromSupabase({
      storeId: 'uzoshop',
      date: '2026-05-19',
      metaSpend: { spend: 12.5, currency: 'CAD' },
      googleSpend: { spend: 7.5, currency: 'CAD' },
    });

    expect(result.fbSpendCad).toBe(12.5);
    expect(result.gaSpendCad).toBe(7.5);
    expect(result.totalSpendCad).toBeCloseTo(20.0, 6);
    expect(result.overridesApplied).toEqual({ meta: false, google: false });
    // FX should not be invoked at all (inputs are CAD; no override rows)
    expect(mockState.fxCalls).toEqual([]);
  });

  it('replaces Meta spend with FX-converted override row (ILS→CAD); leaves Google untouched', async () => {
    mockState.rows = [
      { date: '2026-05-19', store_id: 'uzoshop', platform: 'meta', spend: 100, currency: 'ILS' },
    ];
    mockState.fxResponder = (from, to, _date) => {
      if (from === 'ILS' && to === 'CAD') return 0.376;
      throw new Error(`unexpected FX request ${from}->${to}`);
    };

    const result = await mergeOverridesFromSupabase({
      storeId: 'uzoshop',
      date: '2026-05-19',
      metaSpend: { spend: 50, currency: 'ILS' }, // would convert to 18.8 — but override replaces it
      googleSpend: { spend: 25, currency: 'CAD' },
    });

    expect(result.fbSpendCad).toBeCloseTo(100 * 0.376, 6); // 37.6 — from override row
    expect(result.gaSpendCad).toBe(25); // CAD passthrough
    expect(result.totalSpendCad).toBeCloseTo(37.6 + 25, 6); // 62.6
    expect(result.overridesApplied).toEqual({ meta: true, google: false });
    // FX called once (for the override row); the CAD googleSpend short-circuits
    expect(mockState.fxCalls).toEqual([{ from: 'ILS', to: 'CAD', date: '2026-05-19' }]);
  });

  it('replaces both Meta and Google when both override rows exist', async () => {
    mockState.rows = [
      { date: '2026-05-19', store_id: 'uzoshop', platform: 'meta', spend: 100, currency: 'ILS' },
      { date: '2026-05-19', store_id: 'uzoshop', platform: 'google', spend: 40, currency: 'CAD' },
    ];
    mockState.fxResponder = (from, to, _date) => {
      if (from === 'ILS' && to === 'CAD') return 0.376;
      throw new Error(`unexpected FX request ${from}->${to}`);
    };

    const result = await mergeOverridesFromSupabase({
      storeId: 'uzoshop',
      date: '2026-05-19',
      metaSpend: { spend: 50, currency: 'ILS' },
      googleSpend: { spend: 25, currency: 'CAD' },
    });

    expect(result.fbSpendCad).toBeCloseTo(37.6, 6); // 100 ILS × 0.376
    expect(result.gaSpendCad).toBe(40); // CAD passthrough (no FX call)
    expect(result.totalSpendCad).toBeCloseTo(77.6, 6);
    expect(result.overridesApplied).toEqual({ meta: true, google: true });
    expect(mockState.fxCalls).toEqual([{ from: 'ILS', to: 'CAD', date: '2026-05-19' }]);
  });

  it('does NOT call FX when override row currency is already CAD', async () => {
    mockState.rows = [
      { date: '2026-05-19', store_id: 'uzoshop', platform: 'meta', spend: 42, currency: 'CAD' },
    ];
    // Set FX responder to throw — proves it's not called
    mockState.fxResponder = () => {
      throw new Error('FX should NOT be called for CAD override');
    };

    const result = await mergeOverridesFromSupabase({
      storeId: 'uzoshop',
      date: '2026-05-19',
      metaSpend: { spend: 50, currency: 'CAD' },
      googleSpend: { spend: 0, currency: 'CAD' },
    });

    expect(result.fbSpendCad).toBe(42);
    expect(result.gaSpendCad).toBe(0);
    expect(result.totalSpendCad).toBe(42);
    expect(result.overridesApplied).toEqual({ meta: true, google: false });
    expect(mockState.fxCalls).toEqual([]); // No FX call at all
  });

  it('defensively skips rows with unexpected platform values (logs warning, does not throw)', async () => {
    // CHECK constraint blocks this at write-time; defensive read-side guard.
    mockState.rows = [
      { date: '2026-05-19', store_id: 'uzoshop', platform: 'tiktok', spend: 999, currency: 'CAD' },
    ];
    mockState.fxResponder = () => {
      throw new Error('FX should NOT be called — no valid override matched');
    };

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await mergeOverridesFromSupabase({
      storeId: 'uzoshop',
      date: '2026-05-19',
      metaSpend: { spend: 50, currency: 'CAD' },
      googleSpend: { spend: 25, currency: 'CAD' },
    });

    // Unknown platform row is ignored; original inputs flow through unchanged
    expect(result.fbSpendCad).toBe(50);
    expect(result.gaSpendCad).toBe(25);
    expect(result.totalSpendCad).toBe(75);
    expect(result.overridesApplied).toEqual({ meta: false, google: false });

    // console.warn fired with the storeId/date/platform context
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = String(warnSpy.mock.calls[0]?.[0] ?? '');
    expect(message).toMatch(/tiktok/);
    expect(message).toMatch(/uzoshop/);
    expect(message).toMatch(/2026-05-19/);

    warnSpy.mockRestore();
  });

  it('throws with storeId + date context when Supabase returns an error', async () => {
    mockState.error = { message: 'service_role JWT invalid' };

    await expect(
      mergeOverridesFromSupabase({
        storeId: 'zolplus',
        date: '2026-05-20',
        metaSpend: { spend: 10, currency: 'CAD' },
        googleSpend: { spend: 0, currency: 'CAD' },
      }),
    ).rejects.toThrow(/zolplus.*2026-05-20.*service_role JWT invalid/);
  });
});
