import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * AUDIT regression (Phase 12.3 / 2026-05-24) — API-37 + API-38 (composite):
 * /api/operator/token-failures raw Supabase error.message leaks.
 *
 *   Original bug (API-37):
 *     route.ts:95 emitted Supabase `error.message` verbatim in the GET
 *     success-path response body (e.g. "RLS denied for table
 *     token_failures"). Under URL-obscurity this is forward-looking
 *     defense — if/when auth is added, RLS hints and table names are
 *     unauthenticated information disclosure.
 *
 *   Original bug (API-38):
 *     route.ts:119 + 172 emitted thrown `Error.message` from the GET
 *     and POST catch handlers (e.g. "missing SUPABASE_URL /
 *     SUPABASE_SERVICE_ROLE_KEY" from the local admin() helper, or
 *     resolveTokenFailure throws with raw Supabase strings).
 *
 *   12.3 composite fix (per CONTEXT D-04: API-37 + API-38 share a file
 *   and the same fix shape — single composite commit):
 *     Wrap all 3 leak sites with `userFacingError(rawMessage)`. Raw
 *     message still logs to console.error for server-side ops triage.
 *
 * Evidence pack:
 *   .planning/phases/12-codebase-audit-baseline/raw-returns/
 *     api_operator_tokenFailures.json (API-37 lines 7-15, API-38 lines 17-25)
 */

const ORIGINAL_URL = process.env.SUPABASE_URL;
const ORIGINAL_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe('/api/operator/token-failures error redaction (Phase 12.3 / API-37 + API-38)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (ORIGINAL_URL === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = ORIGINAL_URL;
    if (ORIGINAL_KEY === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_KEY;
  });

  it('Test 1 (GET error path — API-37): response body does NOT contain raw `RLS denied` substring', async () => {
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_test_key';

    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    // Mock @supabase/supabase-js createClient so the GET path's query
    // chain resolves to { data: null, error: { message: 'RLS denied for table token_failures' } }.
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => ({
        from: () => ({
          select: () => ({
            or: () => ({
              order: () => ({
                order: () =>
                  Promise.resolve({
                    data: null,
                    error: { message: 'RLS denied for table token_failures' },
                  }),
              }),
            }),
          }),
        }),
      }),
    }));

    const { GET } = await import('@/app/api/operator/token-failures/route');
    const res = await GET();
    const body = await res.json();
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toMatch(/RLS denied/);
    expect(body.rows).toEqual([]);
    // The sanitized fallback Hebrew string should be present.
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
    // Raw message logged server-side for ops triage.
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('Test 2 (GET threw path — API-38): missing env vars do NOT leak SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY substrings', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    // Don't mock supabase — the local admin() helper will throw with
    // the literal env-missing message BEFORE createClient is reached.
    const { GET } = await import('@/app/api/operator/token-failures/route');
    const res = await GET();
    const body = await res.json();
    const bodyStr = JSON.stringify(body);
    expect(res.status).toBe(500);
    expect(bodyStr).not.toMatch(/SUPABASE_URL/);
    expect(bodyStr).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('Test 3 (POST threw path — API-38): resolveTokenFailure thrown errors do NOT leak SUPABASE_SERVICE_ROLE_KEY or jwt substrings', async () => {
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_test_key';

    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    vi.doMock('@/lib/notifications/tokenFailures', () => ({
      resolveTokenFailure: vi.fn(async () => {
        throw new Error(
          'SUPABASE_SERVICE_ROLE_KEY: invalid jwt: foo.bar.baz',
        );
      }),
    }));

    const { POST } = await import('@/app/api/operator/token-failures/route');
    const req = new Request('http://localhost/api/operator/token-failures', {
      method: 'POST',
      body: JSON.stringify({
        action: 'resolve',
        provider: 'meta',
        store_id: 'uzoshop',
        operation: 'fetchMetaSpend',
      }),
    });
    const res = await POST(req);
    const body = await res.json();
    const bodyStr = JSON.stringify(body);
    expect(res.status).toBe(500);
    expect(bodyStr).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(bodyStr).not.toMatch(/\bjwt\b/);
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
