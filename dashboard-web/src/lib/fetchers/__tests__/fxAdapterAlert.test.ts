import { describe, it, expect, vi, beforeEach } from 'vitest';

// getFxRate throws (Frankfurter outage) for every non-CAD lookup.
vi.mock('@/lib/fetchers/fx', () => ({
  getFxRate: vi.fn(async () => { throw new Error('Frankfurter 503'); }),
}));

// Spy on the FX-failure alert so we assert the adapter fires it (DQ-2).
const fxAlertSpy = vi.fn((_i: unknown): Promise<void> => Promise.resolve());
vi.mock('@/lib/notifications/fxFailure', () => ({
  notifyFxFailure: (i: unknown) => fxAlertSpy(i),
}));

import { getFxCadAdapterForStore } from '@/lib/fetchers/metaAccountConfig';
import { getTikTokFxCadAdapterForStore } from '@/lib/fetchers/tiktokAccountConfig';

beforeEach(() => { fxAlertSpy.mockClear(); });

describe('FX adapter alerts on failure instead of silently returning 0 (DQ-2)', () => {
  it('Meta adapter: FX throw → returns 0 AND fires notifyFxFailure(currency)', async () => {
    const convert = await getFxCadAdapterForStore('uzoshop');
    const out = await convert(100, 'USD');
    expect(out).toBe(0); // behavior preserved
    expect(fxAlertSpy).toHaveBeenCalledTimes(1);
    expect((fxAlertSpy.mock.calls[0][0] as { currency: string }).currency).toBe('USD');
  });

  it('Meta adapter: CAD passes through untouched, no alert', async () => {
    const convert = await getFxCadAdapterForStore('uzoshop');
    expect(await convert(100, 'CAD')).toBe(100);
    expect(fxAlertSpy).not.toHaveBeenCalled();
  });

  it('TikTok adapter: FX throw → returns 0 AND fires notifyFxFailure(currency)', async () => {
    const convert = await getTikTokFxCadAdapterForStore('uzoshop');
    const out = await convert(50, 'ILS');
    expect(out).toBe(0);
    expect(fxAlertSpy).toHaveBeenCalledTimes(1);
    expect((fxAlertSpy.mock.calls[0][0] as { currency: string }).currency).toBe('ILS');
  });
});
