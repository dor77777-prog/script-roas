import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchJson, fetchJsonOrNull } from '@/lib/fetchJson';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchJson', () => {
  it("requests with cache: 'no-store' so the browser never serves a stale response", async () => {
    const spy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ hello: 'world' }),
    })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', spy);

    await fetchJson('/api/data');

    expect(spy).toHaveBeenCalledWith('/api/data', { cache: 'no-store' });
  });

  it('returns the parsed JSON body on a 2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ value: 42 }) })),
    );

    const result = await fetchJson<{ value: number }>('/api/data');

    expect(result).toEqual({ value: 42 });
  });

  it('throws the server-provided error message on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({ error: 'boom' }),
      })),
    );

    await expect(fetchJson('/api/data')).rejects.toThrow('boom');
  });

  it('throws a generic "Failed to load (status)" when the error body has no message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => {
          throw new Error('not json');
        },
      })),
    );

    await expect(fetchJson('/api/data')).rejects.toThrow('Failed to load (503)');
  });
});

describe('fetchJsonOrNull', () => {
  it("requests with cache: 'no-store'", async () => {
    const spy = vi.fn(async () => ({ ok: true, json: async () => ({ a: 1 }) }));
    vi.stubGlobal('fetch', spy);
    await fetchJsonOrNull('/api/data');
    expect(spy).toHaveBeenCalledWith('/api/data', { cache: 'no-store' });
  });

  it('returns the parsed JSON on a 2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ v: 42 }) })));
    const result = await fetchJsonOrNull<{ v: number }>('/api/data');
    expect(result).toEqual({ v: 42 });
  });

  it('returns null on a non-ok response (never throws)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    const result = await fetchJsonOrNull('/api/data');
    expect(result).toBeNull();
  });

  it('returns null when fetch itself rejects (network failure)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const result = await fetchJsonOrNull('/api/data');
    expect(result).toBeNull();
  });
});
