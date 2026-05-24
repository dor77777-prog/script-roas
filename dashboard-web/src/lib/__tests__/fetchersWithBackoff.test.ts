// dashboard-web/src/lib/__tests__/fetchersWithBackoff.test.ts
// Phase 13.4 — unit tests for the 429 / Retry-After wrapper.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithBackoff } from '@/lib/fetchers/withBackoff';

const originalFetch = global.fetch;
const fetchMock = vi.fn();

beforeEach(() => {
  global.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockReset();
  vi.useFakeTimers({ shouldAdvanceTime: false });
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.useRealTimers();
});

describe('fetchWithBackoff', () => {
  it('passes through a 200 response on first attempt', async () => {
    fetchMock.mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const r = await fetchWithBackoff('https://x', {}, { provider: 'meta' });
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('passes through a non-429 4xx without retrying', async () => {
    fetchMock.mockResolvedValueOnce(new Response('forbidden', { status: 403 }));
    const r = await fetchWithBackoff('https://x', {}, { provider: 'meta' });
    expect(r.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 with Retry-After numeric seconds, then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('rate', { status: 429, headers: { 'Retry-After': '2' } }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const p = fetchWithBackoff('https://x', {}, { provider: 'google' });
    await vi.advanceTimersByTimeAsync(2000);
    const r = await p;
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries on 429 with Retry-After HTTP-date, then succeeds', async () => {
    const future = new Date(Date.now() + 3000).toUTCString();
    fetchMock
      .mockResolvedValueOnce(new Response('rate', { status: 429, headers: { 'Retry-After': future } }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const p = fetchWithBackoff('https://x', {}, { provider: 'tiktok' });
    await vi.advanceTimersByTimeAsync(3500);
    const r = await p;
    expect(r.status).toBe(200);
  });

  it('uses 1s exponential start when Retry-After absent', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('rate', { status: 429 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const p = fetchWithBackoff('https://x', {}, { provider: 'shopify' });
    await vi.advanceTimersByTimeAsync(1000);
    const r = await p;
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('caps Retry-After at 60 seconds', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('rate', { status: 429, headers: { 'Retry-After': '999999' } }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const p = fetchWithBackoff('https://x', {}, { provider: 'meta' });
    await vi.advanceTimersByTimeAsync(60_001);
    const r = await p;
    expect(r.status).toBe(200);
  });

  it('returns the final 429 after maxRetries exhausted', async () => {
    fetchMock.mockResolvedValue(new Response('rate', { status: 429 }));
    const p = fetchWithBackoff('https://x', {}, { provider: 'meta', maxRetries: 2 });
    await vi.advanceTimersByTimeAsync(10_000);
    const r = await p;
    expect(r.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('respects custom maxRetries=0 (no retry)', async () => {
    fetchMock.mockResolvedValueOnce(new Response('rate', { status: 429 }));
    const r = await fetchWithBackoff('https://x', {}, { provider: 'meta', maxRetries: 0 });
    expect(r.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
