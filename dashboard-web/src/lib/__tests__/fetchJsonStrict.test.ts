// dashboard-web/src/lib/__tests__/fetchJsonStrict.test.ts
//
// P1-2/3/4 (2026-06-10 state-honesty sweep) — the shared STRICT fetcher.
//
// fetchJsonStrict = fetchJson (throws on !res.ok with the body's error
// message) + throwOnErrorBody (throws on the 200-with-error degraded bodies
// several routes return so SWR consumers stay consistent). It is the one
// fetcher every error-surfacing SWR consumer adopts; this pins its contract.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { fetchJsonStrict, fetchJsonOrNull } from '@/lib/fetchJson';

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('fetchJsonStrict', () => {
  it('resolves the parsed body on a clean 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ rows: [1, 2], lastUpdated: 'x' })));
    await expect(fetchJsonStrict('/api/x')).resolves.toEqual({ rows: [1, 2], lastUpdated: 'x' });
  });

  it('throws Error(body.error) on a 200-with-error degraded body (the P1-2/4 mask)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ rows: [], error: 'DB down' })));
    await expect(fetchJsonStrict('/api/x')).rejects.toThrow('DB down');
  });

  it('throws on !res.ok with the body error message when present', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'boom' }, 500)));
    await expect(fetchJsonStrict('/api/x')).rejects.toThrow('boom');
  });

  it('throws a generic status message on !res.ok with no error body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ({ ok: false, status: 503, json: async () => { throw new Error('not json'); } }) as unknown as Response,
      ),
    );
    await expect(fetchJsonStrict('/api/x')).rejects.toThrow('Failed to load (503)');
  });

  it('does NOT throw on a falsy/absent error field (rows-with-no-error is success)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ rows: [], error: undefined })));
    await expect(fetchJsonStrict('/api/x')).resolves.toEqual({ rows: [], error: undefined });
  });

  it('back-compat: fetchJsonOrNull keeps its soft contract (null on !ok, body on 200-with-error)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ x: 1 }, 500)));
    await expect(fetchJsonOrNull('/api/x')).resolves.toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ rows: [], error: 'soft' })));
    // The soft sibling intentionally does NOT inspect the body — callers that
    // still use it accept the degraded body as-is.
    await expect(fetchJsonOrNull('/api/x')).resolves.toEqual({ rows: [], error: 'soft' });
  });
});
