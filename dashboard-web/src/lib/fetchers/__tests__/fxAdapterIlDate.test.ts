import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * FIX C (#19) — the worker FX adapter factories looked up the Frankfurter rate
 * for the UTC date (`new Date().toISOString().slice(0,10)`) while the worker
 * writes its rows under the ISRAEL business date (getTodayInIsraelTz(nowIso)).
 * In the 00:00-03:00 IL window UTC date != IL date, so a row stamped with the
 * IL date got converted at the PRIOR day's FX rate (cross-midnight mis-convert).
 *
 * Fix: the factory takes the IL business date as an argument and uses it for the
 * lookup, so the FX lookup date matches the row's IL date. (Google is CAD
 * passthrough → unaffected and not tested here.)
 */

// Mock getFxRate so we can capture the dateStr passed to it (no network).
const getFxRate = vi.fn(async (_from: string, _to: string, _dateStr: string) => 1.4);
vi.mock('@/lib/fetchers/fx', () => ({ getFxRate: (f: string, t: string, d: string) => getFxRate(f, t, d) }));
// Silence the FX-failure alert (never reached on a valid rate, but mock for safety).
vi.mock('@/lib/notifications/fxFailure', () => ({ notifyFxFailure: vi.fn(async () => {}) }));
// Secrets reader is irrelevant to the adapter math but imported by the modules.
vi.mock('@/lib/storeSecretsReader', () => ({
  getStoreSecret: vi.fn(async () => null),
  getGlobalSecret: vi.fn(async () => null),
}));

beforeEach(() => { getFxRate.mockClear(); });

// The chosen instant is just past IL midnight: 22:30 UTC on 2026-06-20 is
// 01:30 IL on 2026-06-21 (IL = UTC+3 in summer). UTC date = 2026-06-20, but
// the IL business date = 2026-06-21 → the bug window.
const NOW_ISO = '2026-06-20T22:30:00Z';
const IL_DATE = '2026-06-21';
const UTC_DATE = '2026-06-20';

describe('Meta getFxCadAdapterForStore — FX lookup uses the IL business date (FIX C #19)', () => {
  it('looks up the rate for the IL date, not the UTC date', async () => {
    const { getFxCadAdapterForStore } = await import('@/lib/fetchers/metaAccountConfig');
    const { getTodayInIsraelTz } = await import('@/lib/dateRange');
    const dateStr = getTodayInIsraelTz(NOW_ISO);
    expect(dateStr).toBe(IL_DATE);

    const convert = await getFxCadAdapterForStore('uzoshop', dateStr);
    await convert(100, 'USD');

    expect(getFxRate).toHaveBeenCalledTimes(1);
    const passedDate = getFxRate.mock.calls[0][2];
    expect(passedDate).toBe(IL_DATE);
    expect(passedDate).not.toBe(UTC_DATE);
  });
});

describe('TikTok getTikTokFxCadAdapterForStore — FX lookup uses the IL business date (FIX C #19)', () => {
  it('looks up the rate for the IL date, not the UTC date', async () => {
    const { getTikTokFxCadAdapterForStore } = await import('@/lib/fetchers/tiktokAccountConfig');
    const { getTodayInIsraelTz } = await import('@/lib/dateRange');
    const dateStr = getTodayInIsraelTz(NOW_ISO);
    expect(dateStr).toBe(IL_DATE);

    const convert = await getTikTokFxCadAdapterForStore('uzoshop', dateStr);
    await convert(100, 'USD');

    expect(getFxRate).toHaveBeenCalledTimes(1);
    const passedDate = getFxRate.mock.calls[0][2];
    expect(passedDate).toBe(IL_DATE);
    expect(passedDate).not.toBe(UTC_DATE);
  });
});
