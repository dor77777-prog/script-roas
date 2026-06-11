import { describe, it, expect, vi, beforeEach } from 'vitest';

// Controllable getFxRate: default throws (Frankfurter outage); individual
// tests flip it to a fixed rate for the success-path assertions.
const fxRateMock = vi.hoisted(() =>
  vi.fn(async (_from: string, _to: string, _date: string): Promise<number> => {
    throw new Error('Frankfurter 503');
  }),
);
vi.mock('@/lib/fetchers/fx', () => ({
  getFxRate: fxRateMock,
}));

// Spy on the FX-failure alert so we assert the adapter fires it (DQ-2).
const fxAlertSpy = vi.fn((_i: unknown): Promise<void> => Promise.resolve());
vi.mock('@/lib/notifications/fxFailure', () => ({
  notifyFxFailure: (i: unknown) => fxAlertSpy(i),
}));

import { getFxCadAdapterForStore } from '@/lib/fetchers/metaAccountConfig';
import { getTikTokFxCadAdapterForStore } from '@/lib/fetchers/tiktokAccountConfig';

beforeEach(() => {
  fxAlertSpy.mockClear();
  fxRateMock.mockClear();
  fxRateMock.mockImplementation(async () => {
    throw new Error('Frankfurter 503');
  });
});

// P1-11 (2026-06-10): the adapter contract is null-on-failure. The previous
// `return 0` made every 10-min hot-metrics tick overwrite real intraday spend
// with $0 during an FX outage. Callers now omit the *_cad keys when the
// adapter returns null so ON CONFLICT preserves the last good value. The
// throttled notifyFxFailure alert (DQ-2) is unchanged.
describe('FX adapters — P1-11 null-on-failure contract + DQ-2 alert', () => {
  it('Meta adapter: FX throw → returns null AND fires notifyFxFailure(currency)', async () => {
    const convert = await getFxCadAdapterForStore('uzoshop');
    const out = await convert(100, 'USD');
    expect(out).toBeNull(); // P1-11: null, NOT 0 — caller omits the cad key
    expect(fxAlertSpy).toHaveBeenCalledTimes(1);
    expect((fxAlertSpy.mock.calls[0][0] as { currency: string }).currency).toBe('USD');
  });

  it('Meta adapter: FX success → amount × rate, no alert', async () => {
    fxRateMock.mockImplementation(async () => 0.37);
    const convert = await getFxCadAdapterForStore('uzoshop');
    expect(await convert(100, 'ILS')).toBeCloseTo(37, 9);
    expect(fxAlertSpy).not.toHaveBeenCalled();
  });

  it('Meta adapter: CAD passes through untouched, no alert, no FX call', async () => {
    const convert = await getFxCadAdapterForStore('uzoshop');
    expect(await convert(100, 'CAD')).toBe(100);
    expect(fxAlertSpy).not.toHaveBeenCalled();
    expect(fxRateMock).not.toHaveBeenCalled();
  });

  it('Meta adapter: per-currency result is cached — repeated failures alert once + return consistent null', async () => {
    const convert = await getFxCadAdapterForStore('uzoshop');
    expect(await convert(100, 'ILS')).toBeNull();
    expect(await convert(55, 'ILS')).toBeNull();
    // One Frankfurter hit + one alert despite two conversions — batch rows
    // of the same currency get a CONSISTENT null/number answer (uniform
    // upsert payload keys) and a flapping host isn't hammered per row.
    expect(fxRateMock).toHaveBeenCalledTimes(1);
    expect(fxAlertSpy).toHaveBeenCalledTimes(1);
  });

  it('TikTok adapter: FX throw → returns null AND fires notifyFxFailure(currency)', async () => {
    const convert = await getTikTokFxCadAdapterForStore('uzoshop');
    const out = await convert(50, 'ILS');
    expect(out).toBeNull();
    expect(fxAlertSpy).toHaveBeenCalledTimes(1);
    expect((fxAlertSpy.mock.calls[0][0] as { currency: string }).currency).toBe('ILS');
  });

  it('TikTok adapter: FX success → amount × rate, no alert', async () => {
    fxRateMock.mockImplementation(async () => 1.36);
    const convert = await getTikTokFxCadAdapterForStore('uzoshop');
    expect(await convert(50, 'USD')).toBeCloseTo(68, 9);
    expect(fxAlertSpy).not.toHaveBeenCalled();
  });

  it('TikTok adapter: invalid rate (0 / non-finite) → null + alert (not a 0-CAD write)', async () => {
    fxRateMock.mockImplementation(async () => 0);
    const convert = await getTikTokFxCadAdapterForStore('uzoshop');
    expect(await convert(50, 'USD')).toBeNull();
    expect(fxAlertSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 2026-06-11 (adversarial review, fx-pipeline MEDIUM) — in-flight Promise
// cache. metaHotMetrics builds ALL rows via Promise.all, so the old
// check-then-act VALUE cache (get → await getFxRate → set) let every
// concurrent row miss the empty cache and fire its own Frankfurter call.
// Under a flapping outage some rows got a number and some got null →
// heterogeneous *_cad key sets → PostgREST rejected the ENTIRE bulk upsert
// ('All object keys must match') → whole tick lost. The fix caches the
// IN-FLIGHT Promise per currency: the first caller's resolution is
// authoritative for the whole adapter invocation, so concurrent callers all
// await the SAME promise → ONE getFxRate call + ONE alert per currency and
// identical null-vs-number answers for every row (batch-uniform upsert keys).
//
// The flapping mock below would alternate throw/success per call — if the
// adapter ever regresses to per-row Frankfurter calls, results would be mixed
// null/number and the call-count assertion fails loudly.
// ---------------------------------------------------------------------------
describe('FX adapters — in-flight Promise cache (batch-uniform keys under Promise.all)', () => {
  /** Flapping Frankfurter: 1st call throws, 2nd succeeds, 3rd throws, ... */
  function mockFlappingFx(rate: number, firstCallFails: boolean) {
    let n = 0;
    fxRateMock.mockImplementation(async () => {
      n += 1;
      const fail = firstCallFails ? n % 2 === 1 : n % 2 === 0;
      if (fail) throw new Error('Frankfurter flap 503');
      return rate;
    });
  }

  it('Meta adapter: 6 concurrent calls + flapping FX (1st fails) → ONE getFxRate call, ALL results null, ONE alert', async () => {
    mockFlappingFx(0.37, true);
    const convert = await getFxCadAdapterForStore('uzoshop');
    const results = await Promise.all(
      [100, 55, 10, 200, 1, 42].map((amt) => convert(amt, 'ILS')),
    );
    // First caller's resolution (throw → null) is authoritative for ALL rows.
    expect(fxRateMock).toHaveBeenCalledTimes(1);
    expect(results).toEqual([null, null, null, null, null, null]);
    // Alert fires ONCE despite 6 concurrent conversions (not per row).
    expect(fxAlertSpy).toHaveBeenCalledTimes(1);
  });

  it('Meta adapter: 6 concurrent calls + flapping FX (1st succeeds) → ONE getFxRate call, ALL results amount × SAME rate, no alert', async () => {
    mockFlappingFx(0.37, false);
    const convert = await getFxCadAdapterForStore('uzoshop');
    const amounts = [100, 55, 10, 200, 1, 42];
    const results = await Promise.all(amounts.map((amt) => convert(amt, 'ILS')));
    expect(fxRateMock).toHaveBeenCalledTimes(1);
    results.forEach((r, i) => {
      expect(r).toBeCloseTo(amounts[i] * 0.37, 9);
    });
    expect(fxAlertSpy).not.toHaveBeenCalled();
  });

  it('Meta adapter: mixed currencies concurrently → exactly ONE getFxRate call PER currency, per-currency-uniform results', async () => {
    // USD resolves, ILS throws — a per-currency partial outage.
    fxRateMock.mockImplementation(async (from: string) => {
      if (from === 'USD') return 1.35;
      throw new Error('Frankfurter ILS leg down');
    });
    const convert = await getFxCadAdapterForStore('uzoshop');
    const [usd1, ils1, usd2, ils2, usd3, ils3] = await Promise.all([
      convert(10, 'USD'),
      convert(10, 'ILS'),
      convert(20, 'USD'),
      convert(20, 'ILS'),
      convert(30, 'USD'),
      convert(30, 'ILS'),
    ]);
    expect(fxRateMock).toHaveBeenCalledTimes(2); // one per currency
    expect([usd1, usd2, usd3]).toEqual([13.5, 27, 40.5]);
    expect([ils1, ils2, ils3]).toEqual([null, null, null]);
    expect(fxAlertSpy).toHaveBeenCalledTimes(1); // ILS only, once
    expect((fxAlertSpy.mock.calls[0][0] as { currency: string }).currency).toBe('ILS');
  });

  it('TikTok adapter: 6 concurrent calls + flapping FX (1st fails) → ONE getFxRate call, ALL results null, ONE alert', async () => {
    mockFlappingFx(1.36, true);
    const convert = await getTikTokFxCadAdapterForStore('uzoshop');
    const results = await Promise.all(
      [50, 25, 5, 75, 2, 33].map((amt) => convert(amt, 'USD')),
    );
    expect(fxRateMock).toHaveBeenCalledTimes(1);
    expect(results).toEqual([null, null, null, null, null, null]);
    expect(fxAlertSpy).toHaveBeenCalledTimes(1);
  });

  it('TikTok adapter: 6 concurrent calls + flapping FX (1st succeeds) → ONE getFxRate call, ALL results amount × SAME rate, no alert', async () => {
    mockFlappingFx(1.36, false);
    const convert = await getTikTokFxCadAdapterForStore('uzoshop');
    const amounts = [50, 25, 5, 75, 2, 33];
    const results = await Promise.all(amounts.map((amt) => convert(amt, 'USD')));
    expect(fxRateMock).toHaveBeenCalledTimes(1);
    results.forEach((r, i) => {
      expect(r).toBeCloseTo(amounts[i] * 1.36, 9);
    });
    expect(fxAlertSpy).not.toHaveBeenCalled();
  });
});
