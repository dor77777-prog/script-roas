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
