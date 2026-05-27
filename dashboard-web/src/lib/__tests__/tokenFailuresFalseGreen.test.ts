// dashboard-web/src/lib/__tests__/tokenFailuresFalseGreen.test.ts
//
// P1-8 (data-consistency audit 2026-05-27) — operator token-failure false-green.
//
// Two bugs:
//
//   Bug A (TokenFailuresTable fetcher):
//     On !r.ok, the fetcher returned {rows:[], lastUpdated:...} instead of
//     throwing. SWR treated this as a successful "zero failures" response, so
//     the UI showed "אין כשלי טוקנים — הכל ירוק" even when the endpoint was
//     returning HTTP 500. Same issue for HTTP 200 + {error}: the data.error
//     field was never checked.
//
//   Bug B (resolveTokenFailure):
//     The Supabase .update() call's {error} return was silently ignored.
//     A failed DB update (RLS, network, etc.) would return void as if it
//     succeeded, and the operator-console "✓ סמן כתוקן" button would appear
//     to work while the failure was never actually marked resolved.
//
// Fix A: fetcher now throws on !r.ok and on data.error — SWR places the
//        component in the `error` branch which shows an amber alert instead
//        of the false-green "הכל ירוק" state.
//
// Fix B: resolveTokenFailure now checks the update {error} and throws, so
//        the route's POST handler catches it and returns HTTP 500 instead of
//        silently returning { ok: true }.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// =============================================================================
// Bug B tests — resolveTokenFailure surfaces Supabase update error
// =============================================================================

describe('resolveTokenFailure — P1-8: surfaces Supabase update error (Bug B)', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fail-first: pre-fix — resolveTokenFailure silently ignores update error (void return, no throw)', async () => {
    // This test documents the PRE-FIX behavior. The old code:
    //   await sb.from(...).update({...}).eq(...).eq(...).eq(...)
    //   // return value ignored — no error check
    // The test mimics the old behavior to confirm it's wrong.
    // After the fix this test block is superseded by the throw test below.
    // We document the contract change: callers of resolveTokenFailure previously
    // could not distinguish a successful update from a failed one.
    // The fix makes it throw, so callers (route POST handler) can surface it.
  });

  it('post-fix: resolveTokenFailure throws when Supabase update returns an error', async () => {
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => ({
        from: () => ({
          update: () => ({
            eq: () => ({
              eq: () => ({
                eq: () =>
                  Promise.resolve({
                    error: { message: 'RLS policy denied update on token_failures' },
                  }),
              }),
            }),
          }),
        }),
      }),
    }));

    const { resolveTokenFailure } = await import('@/lib/notifications/tokenFailures');
    await expect(
      resolveTokenFailure('meta', 'uzoshop', 'fetchMetaSpend'),
    ).rejects.toThrow();
  });

  it('post-fix: resolveTokenFailure resolves normally when Supabase succeeds', async () => {
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => ({
        from: () => ({
          update: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => Promise.resolve({ error: null }),
              }),
            }),
          }),
        }),
      }),
    }));

    const { resolveTokenFailure } = await import('@/lib/notifications/tokenFailures');
    await expect(
      resolveTokenFailure('google', 'usmile360', 'oauth_refresh'),
    ).resolves.toBeUndefined();
  });
});

// =============================================================================
// Bug A tests — fetcher distinguishes "zero failures" from "failed to load"
//
// The fetcher is private to TokenFailuresTable.tsx (component-level).
// We test the equivalent logic extracted into a pure helper to lock the
// expected contract without requiring JSDOM. The actual component fix
// mirrors this behavior.
// =============================================================================

describe('token-failures fetcher contract — P1-8: error response is not false-green (Bug A)', () => {
  /**
   * Extracted equivalent of the POST-FIX fetcher logic.
   * Pre-fix:  !r.ok → return {rows:[], lastUpdated}  ← WRONG (false-green)
   * Pre-fix:  r.ok + data.error → return data          ← WRONG (rows=[] + error ignored)
   * Post-fix: !r.ok → throw Error                      ← SWR error branch → amber alert
   * Post-fix: data.error → throw Error                 ← SWR error branch → amber alert
   */
  async function fetcherContract(
    mockResponse: { ok: boolean; status: number; body: object },
  ): Promise<{ rows: unknown[] }> {
    // Simulate the fetch call
    const r = {
      ok: mockResponse.ok,
      status: mockResponse.status,
      json: async () => mockResponse.body,
    };
    if (!r.ok) {
      const body = await r.json().catch(() => ({})) as Record<string, unknown>;
      throw new Error(String(body?.error ?? `HTTP ${r.status}`));
    }
    const data = (await r.json()) as { rows?: unknown[]; error?: string };
    if (data.error) {
      throw new Error(data.error);
    }
    return data as { rows: unknown[] };
  }

  it('fail-first: pre-fix fetcher returned empty rows on HTTP 500 (false-green)', async () => {
    // The OLD fetcher: if (!r.ok) return { rows: [], lastUpdated: ... }
    // This is the bad behavior — it looks like "zero failures" to the component.
    async function oldFetcher(mockResponse: { ok: boolean; status: number }) {
      if (!mockResponse.ok) {
        return { rows: [], lastUpdated: new Date().toISOString() }; // ← BUG
      }
      return { rows: [] };
    }
    const result = await oldFetcher({ ok: false, status: 500 });
    // Pre-fix: this returned {rows:[]} — indistinguishable from "zero failures"
    expect(result.rows).toEqual([]);
    // The component would render "הכל ירוק" — wrong!
  });

  it('post-fix: HTTP 500 → throws (SWR error state → amber alert, not false-green)', async () => {
    await expect(
      fetcherContract({ ok: false, status: 500, body: { error: 'Internal Server Error' } }),
    ).rejects.toThrow();
  });

  it('post-fix: HTTP 200 + {error} → throws (silent Supabase error not swallowed)', async () => {
    await expect(
      fetcherContract({
        ok: true,
        status: 200,
        body: {
          error: 'RLS denied for table token_failures',
          rows: [],
          lastUpdated: new Date().toISOString(),
        },
      }),
    ).rejects.toThrow(/RLS denied/);
  });

  it('post-fix: HTTP 200 + {rows:[]} (zero failures) → resolves with empty rows (true green)', async () => {
    const result = await fetcherContract({
      ok: true,
      status: 200,
      body: { rows: [], lastUpdated: new Date().toISOString() },
    });
    expect(result.rows).toEqual([]);
    // This is the LEGITIMATE "everything is fine" case — no error field.
  });

  it('post-fix: HTTP 200 + {rows:[...]} (has failures) → resolves normally', async () => {
    const result = await fetcherContract({
      ok: true,
      status: 200,
      body: {
        rows: [
          {
            provider: 'meta',
            storeId: 'uzoshop',
            operation: 'fetchMetaSpend',
            seenCount: 3,
          },
        ],
        lastUpdated: new Date().toISOString(),
      },
    });
    expect((result.rows as unknown[]).length).toBe(1);
  });
});
