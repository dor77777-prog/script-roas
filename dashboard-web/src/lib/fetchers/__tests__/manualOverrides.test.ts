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

type MockRow = {
  date: string;
  store_id: string;
  platform: string;
  spend: number | string;
  currency: string;
};

type FxCall = { from: string; to: string; date: string };
type FxResponder = (from: string, to: string, date: string) => number;

type MockState = {
  rows: MockRow[];
  error: null | { message: string };
  fxCalls: FxCall[];
  fxResponder: FxResponder | null;
};

const mockState = vi.hoisted<MockState>(() => ({
  rows: [],
  error: null,
  fxCalls: [],
  fxResponder: null,
}));

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
    expect(result.ttSpendCad).toBe(0);
    expect(result.overridesApplied).toEqual({ meta: false, google: false, tiktok: false });
    // FX should not be invoked at all (inputs are CAD; no override rows)
    expect(mockState.fxCalls).toEqual([]);
  });

  // P1-11 (2026-06-10): the NO-override fetched path null-preserves on FX
  // failure (returns null; persist-batch omits the column) instead of
  // throwing. Meta is always ILS, so the old throw ran on EVERY nightly merge
  // — one Frankfurter outage failed the whole apply-overrides step
  // pre-persist and lost Shopify+Google+TikTok for that (store, day).
  it('P1-11: fetched-path FX throw → fbSpendCad null + totalSpendCad null, does NOT throw; Google CAD passthrough survives', async () => {
    // No override rows; Meta fetched spend is ILS and FX is down.
    mockState.fxResponder = () => {
      throw new Error('Frankfurter 503');
    };

    const result = await mergeOverridesFromSupabase({
      storeId: 'uzoshop',
      date: '2026-05-19',
      metaSpend: { spend: 100, currency: 'ILS' },
      googleSpend: { spend: 25, currency: 'CAD' },
    });

    expect(result.fbSpendCad).toBeNull(); // null → persist-batch omits fb_spend_cad
    expect(result.gaSpendCad).toBe(25); // CAD passthrough unaffected
    expect(result.totalSpendCad).toBeNull(); // no partial sums
    expect(result.overridesApplied).toEqual({ meta: false, google: false, tiktok: false });
  });

  it('P1-11: OVERRIDE path still throws on FX failure (operator value is authoritative)', async () => {
    mockState.rows = [
      { date: '2026-05-19', store_id: 'uzoshop', platform: 'meta', spend: 100, currency: 'ILS' },
    ];
    mockState.fxResponder = () => {
      throw new Error('Frankfurter 503');
    };

    await expect(
      mergeOverridesFromSupabase({
        storeId: 'uzoshop',
        date: '2026-05-19',
        metaSpend: { spend: 50, currency: 'CAD' },
        googleSpend: { spend: 25, currency: 'CAD' },
      }),
    ).rejects.toThrow(/Frankfurter 503/);
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
    expect(result.ttSpendCad).toBe(0);
    expect(result.overridesApplied).toEqual({ meta: true, google: false, tiktok: false });
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
    expect(result.ttSpendCad).toBe(0);
    expect(result.overridesApplied).toEqual({ meta: true, google: true, tiktok: false });
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
    expect(result.ttSpendCad).toBe(0);
    expect(result.overridesApplied).toEqual({ meta: true, google: false, tiktok: false });
    expect(mockState.fxCalls).toEqual([]); // No FX call at all
  });

  it('passes through the fetched tt spend (CAD) when no tiktok override exists', async () => {
    mockState.fxResponder = () => {
      throw new Error('FX should NOT be called — CAD tt passthrough');
    };

    const result = await mergeOverridesFromSupabase({
      storeId: 'uzoshop',
      date: '2026-05-19',
      metaSpend: { spend: 0, currency: 'CAD' },
      googleSpend: { spend: 0, currency: 'CAD' },
      tiktokSpend: { spend: 100, currency: 'CAD' },
    });

    expect(result.ttSpendCad).toBe(100);
    expect(result.totalSpendCad).toBe(100);
    expect(result.overridesApplied.tiktok).toBe(false);
    expect(mockState.fxCalls).toEqual([]);
  });

  it('FX-safety: non-CAD fetched tt (no override) does NOT call external FX — left to cronDaily graceful path (ttSpendCad 0)', async () => {
    // CRIT-5 preservation: a TikTok-FX outage must stay survivable. The merge
    // never FX-converts the NON-override fetched tt on a throwing path — it
    // CAD-passthroughs only and defers non-CAD to cronDaily's graceful
    // persist-batch block. So no getFxRate call here and ttSpendCad is 0.
    mockState.fxResponder = () => {
      throw new Error('FX must NOT be called for non-CAD fetched tt (no override)');
    };

    const result = await mergeOverridesFromSupabase({
      storeId: 'uzoshop',
      date: '2026-05-19',
      metaSpend: { spend: 0, currency: 'CAD' },
      googleSpend: { spend: 0, currency: 'CAD' },
      tiktokSpend: { spend: 999, currency: 'USD' },
    });

    expect(result.ttSpendCad).toBe(0);
    expect(result.overridesApplied.tiktok).toBe(false);
    expect(mockState.fxCalls).toEqual([]);
  });

  it('tiktokSpend is optional — omitting it yields ttSpendCad 0', async () => {
    mockState.fxResponder = () => {
      throw new Error('FX should NOT be called');
    };

    const result = await mergeOverridesFromSupabase({
      storeId: 'zolplus',
      date: '2026-05-20',
      metaSpend: { spend: 10, currency: 'CAD' },
      googleSpend: { spend: 0, currency: 'CAD' },
    });

    expect(result.ttSpendCad).toBe(0);
    expect(result.totalSpendCad).toBe(10);
    expect(result.overridesApplied.tiktok).toBe(false);
  });

  // TikTok unblock (2026-06-02): tiktok is now a SUPPORTED, operator-typed
  // platform. A tiktok override row is APPLIED (REPLACE semantics, keyed by
  // store_id) — NOT skipped — and does NOT emit the defensive warning. This
  // replaces the prior assertion that tiktok rows were discarded; that
  // behavior was the bug the feature fixes.
  it('APPLIES a tiktok override row (REPLACE, keyed by store_id) — no defensive warning', async () => {
    mockState.rows = [
      { date: '2026-05-19', store_id: 'uzoshop', platform: 'tiktok', spend: 200, currency: 'USD' },
    ];
    mockState.fxResponder = (from, to, _date) => {
      if (from === 'USD' && to === 'CAD') return 1.4;
      throw new Error(`unexpected FX request ${from}->${to}`);
    };

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await mergeOverridesFromSupabase({
      storeId: 'uzoshop',
      date: '2026-05-19',
      metaSpend: { spend: 50, currency: 'CAD' },
      googleSpend: { spend: 25, currency: 'CAD' },
      tiktokSpend: { spend: 999, currency: 'USD' }, // ignored — overridden
    });

    // The tiktok override REPLACES the fetched tt spend (200 USD × 1.4 = 280).
    expect(result.fbSpendCad).toBe(50);
    expect(result.gaSpendCad).toBe(25);
    expect(result.ttSpendCad).toBeCloseTo(280, 6);
    expect(result.totalSpendCad).toBeCloseTo(355, 6); // 50 + 25 + 280
    expect(result.overridesApplied).toEqual({ meta: false, google: false, tiktok: true });

    // tiktok is supported now — the defensive unknown-platform warning must NOT fire.
    expect(warnSpy).not.toHaveBeenCalled();
    // Exactly one FX call: the USD→CAD override conversion.
    expect(mockState.fxCalls).toEqual([{ from: 'USD', to: 'CAD', date: '2026-05-19' }]);

    warnSpy.mockRestore();
  });

  it('defensively skips rows with genuinely-unknown platform values (logs warning, does not throw)', async () => {
    // CHECK constraint blocks anything outside meta/google/tiktok at write-time;
    // this is the read-side defensive guard for corruption / constraint bypass.
    mockState.rows = [
      { date: '2026-05-19', store_id: 'uzoshop', platform: 'snapchat', spend: 999, currency: 'CAD' },
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
    expect(result.ttSpendCad).toBe(0);
    expect(result.totalSpendCad).toBe(75);
    expect(result.overridesApplied).toEqual({ meta: false, google: false, tiktok: false });

    // console.warn fired with the storeId/date/platform context
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = String(warnSpy.mock.calls[0]?.[0] ?? '');
    expect(message).toMatch(/snapchat/);
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
