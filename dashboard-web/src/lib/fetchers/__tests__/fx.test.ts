// dashboard-web/src/lib/fetchers/__tests__/fx.test.ts
//
// Tests for the FX fetcher (Phase 05.6-06, provider chain added 2026-07-16).
// Mirrors FX.gs:6-25. Per RESEARCH §Pitfall 13, the fetcher accepts whatever
// date Frankfurter returns (weekend/holiday auto-shifts to the prior business
// day are expected — do NOT validate body.date === requestedDate).
//
// 2026-07-16 (fx_rate_failure #55, seen 230×) — Frankfurter has a recurring
// nightly outage window (~03:00 UTC, Cloudflare 522) that collided daily with
// the */10 crons. getFxRate is now a PROVIDER CHAIN:
//   1. Frankfurter (primary, ECB-backed)
//   2. currency-api via jsDelivr CDN   (fawazahmed0/exchange-api)
//   3. currency-api via Cloudflare Pages mirror
// It throws ONLY when all three fail, so the fx_rate_failure alert now means
// "the whole chain is down", not "Frankfurter blinked".

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getFxRate } from '../fx';

const FRANKFURTER_URL = 'https://api.frankfurter.dev/v1/2026-05-19?base=ILS&symbols=CAD';
const JSDELIVR_URL =
  'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@2026-05-19/v1/currencies/ils.json';
const PAGES_URL = 'https://2026-05-19.currency-api.pages.dev/v1/currencies/ils.json';

function frankfurterOk(rate: number, date = '2026-05-19') {
  return new Response(
    JSON.stringify({ amount: 1, base: 'ILS', date, rates: { CAD: rate } }),
    { status: 200 },
  );
}

function currencyApiOk(rate: number, date = '2026-05-19') {
  return new Response(JSON.stringify({ date, ils: { cad: rate } }), { status: 200 });
}

describe('fx fetcher (provider chain)', () => {
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

  it('calls Frankfurter v1 with correct URL + timeout signal and returns the rate', async () => {
    fetchMock.mockResolvedValueOnce(frankfurterOk(0.376));
    const rate = await getFxRate('ILS', 'CAD', '2026-05-19');
    expect(rate).toBe(0.376);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      FRANKFURTER_URL,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('accepts weekend shift (body.date differs from requested)', async () => {
    // Saturday 2026-05-23 → Frankfurter returns Friday 2026-05-22's rate.
    // Per RESEARCH §Pitfall 13, accept the rate; do NOT validate body.date.
    fetchMock.mockResolvedValueOnce(frankfurterOk(0.38, '2026-05-22'));
    const rate = await getFxRate('ILS', 'CAD', '2026-05-23');
    expect(rate).toBe(0.38);
  });

  it('falls back to jsDelivr currency-api when Frankfurter returns 522', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('<html>522 origin down</html>', { status: 522 }))
      .mockResolvedValueOnce(currencyApiOk(0.4685));
    const rate = await getFxRate('ILS', 'CAD', '2026-05-19');
    expect(rate).toBe(0.4685);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(JSDELIVR_URL);
  });

  it('falls back when the Frankfurter fetch itself rejects (network / timeout)', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('fetch failed: ETIMEDOUT'))
      .mockResolvedValueOnce(currencyApiOk(0.47));
    const rate = await getFxRate('ILS', 'CAD', '2026-05-19');
    expect(rate).toBe(0.47);
  });

  it('falls back when Frankfurter responds 200 but without a usable rate', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ amount: 1, base: 'ILS', date: '2026-05-19', rates: {} }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(currencyApiOk(0.47));
    const rate = await getFxRate('ILS', 'CAD', '2026-05-19');
    expect(rate).toBe(0.47);
  });

  it('falls back to the pages.dev mirror when Frankfurter AND jsDelivr fail', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('522', { status: 522 }))
      .mockRejectedValueOnce(new Error('jsDelivr down'))
      .mockResolvedValueOnce(currencyApiOk(0.469));
    const rate = await getFxRate('ILS', 'CAD', '2026-05-19');
    expect(rate).toBe(0.469);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][0]).toBe(PAGES_URL);
  });

  it('treats a non-finite / zero fallback rate as a failure and moves on', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('522', { status: 522 }))
      .mockResolvedValueOnce(currencyApiOk(0)) // invalid → keep going
      .mockResolvedValueOnce(currencyApiOk(0.469));
    const rate = await getFxRate('ILS', 'CAD', '2026-05-19');
    expect(rate).toBe(0.469);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('throws with all provider errors + from/to/dateStr when the WHOLE chain fails', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('bad', { status: 500 }))
      .mockResolvedValueOnce(new Response('cdn err', { status: 503 }))
      .mockRejectedValueOnce(new Error('pages down'));
    const err = await getFxRate('ILS', 'CAD', '2026-05-19').catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    // Keeps the historic "FX fetch failed (FROM->TO on DATE" prefix that the
    // fx_rate_failure alert copy + operator console rely on.
    expect((err as Error).message).toMatch(/^FX fetch failed \(ILS->CAD on 2026-05-19\)/);
    expect((err as Error).message).toMatch(/frankfurter.*500/);
    expect((err as Error).message).toMatch(/jsdelivr.*503/i);
    expect((err as Error).message).toMatch(/pages.*pages down/i);
  });

  it('legacy shape: non-OK everywhere still matches /ILS->CAD.*DATE.*500/', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('bad', { status: 500 }))
      .mockRejectedValueOnce(new Error('x'))
      .mockRejectedValueOnce(new Error('y'));
    await expect(getFxRate('ILS', 'CAD', '2026-05-19')).rejects.toThrow(
      /ILS->CAD.*2026-05-19.*500/,
    );
  });

  it('retries a RECENT date as @latest when currency-api 404s (date not yet published)', async () => {
    // "Today" in Asia/Jerusalem can be ahead of the currency-api daily
    // publish; the dated file 404s. The chain must clamp to `latest`,
    // mirroring Frankfurter's own unpublished-date behavior.
    const today = new Date().toISOString().slice(0, 10);
    fetchMock
      .mockResolvedValueOnce(new Response('522', { status: 522 })) // frankfurter
      .mockResolvedValueOnce(new Response('not found', { status: 404 })) // jsdelivr dated
      .mockResolvedValueOnce(currencyApiOk(0.471, today)); // jsdelivr @latest
    const rate = await getFxRate('ILS', 'CAD', today);
    expect(rate).toBe(0.471);
    expect(fetchMock.mock.calls[1][0]).toBe(
      `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${today}/v1/currencies/ils.json`,
    );
    expect(fetchMock.mock.calls[2][0]).toBe(
      'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/ils.json',
    );
  });

  it('does NOT clamp an OLD date to @latest on 404 (stale rate would be wrong)', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('522', { status: 522 })) // frankfurter
      .mockResolvedValueOnce(new Response('not found', { status: 404 })) // jsdelivr dated
      .mockResolvedValueOnce(new Response('not found', { status: 404 })); // pages dated
    const err = await getFxRate('ILS', 'CAD', '2024-01-15').catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    // 3 calls only — no @latest retries for a 2024 backfill date.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][0]).toBe(
      'https://2024-01-15.currency-api.pages.dev/v1/currencies/ils.json',
    );
  });

  it('does NOT clamp a FAR-FUTURE date to @latest on 404 (bogus date must fail loudly)', async () => {
    // A typo'd future year (e.g. unbounded operator backfill "to" date) must
    // NOT silently take the current rate — only the ±3-day window around now
    // (Asia/Jerusalem "today" ahead of the UTC publish) may clamp.
    fetchMock
      .mockResolvedValueOnce(new Response('404', { status: 404 })) // frankfurter
      .mockResolvedValueOnce(new Response('not found', { status: 404 })) // jsdelivr dated
      .mockResolvedValueOnce(new Response('not found', { status: 404 })); // pages dated
    const err = await getFxRate('ILS', 'CAD', '2030-01-01').catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    // 3 calls only — no @latest retries for a far-future date.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('uses lowercase currency keys for the currency-api response shape', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ date: '2026-05-19', usd: { cad: 1.37 } }), { status: 200 }),
      );
    const rate = await getFxRate('USD', 'CAD', '2026-05-19');
    expect(rate).toBe(1.37);
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@2026-05-19/v1/currencies/usd.json',
    );
  });
});
