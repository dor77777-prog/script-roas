import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * AUDIT regression (Phase 12.3 / 2026-05-24) — API-32:
 * /api/operator/reset sequential per-table delete loop.
 *
 *   Original bug (API-32):
 *     route.ts:123-152 used `for (const table of tables)` with `await
 *     supabase.from(table).delete(...)`. On large datasets (100k+ rows
 *     per table × 7 tables), wall-clock approached 30s — within striking
 *     distance of the Inngest 60s budget AND the operator-UI spinner
 *     timeout. A single slow table would block all the others.
 *
 *   12.3 fix:
 *     Replace the for-loop with `Promise.allSettled(tables.map(...))` so
 *     the 7 deletes fire concurrently. Wall-clock drops from sum(per-table)
 *     to max(per-table). Per-table error isolation preserved.
 *
 * Evidence pack:
 *   .planning/phases/12-codebase-audit-baseline/raw-returns/
 *     api_operator_reset.json (API-32 lines 7-16)
 */

const PER_TABLE_LATENCY_MS = 100;

function makeMockSupabase(failingTable?: string) {
  return {
    from: (table: string) => ({
      delete: (_opts: { count: string }) => ({
        not: (_col: string, _op: string, _val: unknown) =>
          new Promise((resolve) => {
            setTimeout(() => {
              if (failingTable && table === failingTable) {
                resolve({ count: null, error: { message: 'FK constraint violation' } });
                return;
              }
              resolve({ count: 100, error: null });
            }, PER_TABLE_LATENCY_MS);
          }),
      }),
    }),
  };
}

describe('/api/operator/reset parallel deletes (Phase 12.3 / API-32)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Test 1 (perf): 7-table mock with 100ms per-table latency completes in <500ms (vs >700ms sequential)', async () => {
    vi.doMock('@/lib/supabaseAdmin', () => ({
      getSupabaseAdmin: () => makeMockSupabase(),
    }));
    const { POST } = await import('@/app/api/operator/reset/route');
    const req = new Request('http://localhost/api/operator/reset', {
      method: 'POST',
      body: JSON.stringify({ scope: 'all', confirm: 'YES-DELETE-ALL-DATA' }),
    });
    const start = Date.now();
    const res = await POST(req);
    const elapsed = Date.now() - start;
    const body = await res.json();
    expect(res.status).toBe(200);
    // 7 tables × 100 each = 700 total deleted post-fix when all succeed.
    expect(body.total).toBe(700);
    // Pre-fix sequential: 7 × 100ms = 700ms. Post-fix parallel: ~100ms
    // (max of one call). Buffer to 500ms to absorb test-runner overhead.
    expect(elapsed).toBeLessThan(500);
  });

  it('Test 2 (partial-failure isolation): one failing table sets errors[table] + count=-1, others succeed', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    vi.doMock('@/lib/supabaseAdmin', () => ({
      getSupabaseAdmin: () => makeMockSupabase('product_catalog'),
    }));
    const { POST } = await import('@/app/api/operator/reset/route');
    const req = new Request('http://localhost/api/operator/reset', {
      method: 'POST',
      body: JSON.stringify({ scope: 'all', confirm: 'YES-DELETE-ALL-DATA' }),
    });
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.deleted.product_catalog).toBe(-1);
    expect(body.errors?.product_catalog).toBeTruthy();
    // The userFacingError sanitization MUST strip the raw 'FK constraint
    // violation' string — that's a Supabase internal message.
    expect(body.errors.product_catalog).not.toMatch(/FK constraint/);
    // Other 6 tables succeeded at 100 each = 600 total.
    expect(body.total).toBe(600);
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
