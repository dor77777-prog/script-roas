// dashboard-web/src/lib/fetchers/__tests__/fx.test.ts
//
// Tests for the Frankfurter FX fetcher (Phase 05.6-06).
// Mirrors FX.gs:6-25. Per RESEARCH §Pitfall 13, the fetcher accepts whatever
// date Frankfurter returns (weekend/holiday auto-shifts to the prior business
// day are expected — do NOT validate body.date === requestedDate).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getFxRate } from '../fx';

describe('fx fetcher (Frankfurter port)', () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns 1 for same currency without calling fetch', async () => {
    const rate = await getFxRate('ILS', 'ILS', '2026-05-19');
    expect(rate).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls Frankfurter v1 with correct URL and returns the rate', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          amount: 1,
          base: 'ILS',
          date: '2026-05-19',
          rates: { CAD: 0.376 },
        }),
        { status: 200 },
      ),
    );
    const rate = await getFxRate('ILS', 'CAD', '2026-05-19');
    expect(rate).toBe(0.376);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.frankfurter.dev/v1/2026-05-19?base=ILS&symbols=CAD',
    );
  });

  it('accepts weekend shift (body.date differs from requested)', async () => {
    // Saturday 2026-05-23 → Frankfurter returns Friday 2026-05-22's rate.
    // Per RESEARCH §Pitfall 13, accept the rate; do NOT validate body.date.
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          amount: 1,
          base: 'ILS',
          date: '2026-05-22',
          rates: { CAD: 0.38 },
        }),
        { status: 200 },
      ),
    );
    const rate = await getFxRate('ILS', 'CAD', '2026-05-23');
    expect(rate).toBe(0.38);
  });

  it('throws on non-OK response with from/to/dateStr in the message', async () => {
    fetchMock.mockResolvedValueOnce(new Response('bad', { status: 500 }));
    await expect(getFxRate('ILS', 'CAD', '2026-05-19')).rejects.toThrow(
      /ILS->CAD.*2026-05-19.*500/,
    );
  });

  it('throws when rates[to] is missing', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          amount: 1,
          base: 'ILS',
          date: '2026-05-19',
          rates: {},
        }),
        { status: 200 },
      ),
    );
    await expect(getFxRate('ILS', 'CAD', '2026-05-19')).rejects.toThrow(/No FX rate/);
  });
});
