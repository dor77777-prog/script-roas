/**
 * supabase.test.ts — Phase 5a guard.
 *
 * getSupabase() returns the SHARED server-side read client. As of the Phase 5a
 * reader cutover it MUST be configured with SUPABASE_SERVICE_ROLE_KEY (which
 * bypasses RLS) and NOT SUPABASE_ANON_KEY. After Phase 5b enables RLS + revokes
 * `anon` SELECT, any regression that reverts this to the anon key would silently
 * return 0 rows for every reader — so we pin the key source here.
 *
 * Strategy: mock @supabase/supabase-js so createClient records the (url, key)
 * it is called with, then assert getSupabase() passed the service-role key.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ args: [] as Array<{ url: string; key: string }> }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: (url: string, key: string) => {
    calls.args.push({ url, key });
    return { __mockClient: true } as unknown;
  },
}));

beforeEach(() => {
  calls.args.length = 0;
  vi.resetModules();
  vi.unstubAllEnvs();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getSupabase — Phase 5a service-role cutover', () => {
  it('is configured with the SERVICE_ROLE key (not the anon key)', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key-value');
    vi.stubEnv('SUPABASE_ANON_KEY', 'anon-key-value');

    const { getSupabase } = await import('@/lib/supabase');
    getSupabase();

    expect(calls.args).toHaveLength(1);
    expect(calls.args[0].url).toBe('https://example.supabase.co');
    // Regression guard: must use service-role, never the anon key.
    expect(calls.args[0].key).toBe('service-role-key-value');
    expect(calls.args[0].key).not.toBe('anon-key-value');
  });

  it('throws (lazy, not at module load) when SERVICE_ROLE key is missing', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');

    const { getSupabase } = await import('@/lib/supabase');
    expect(() => getSupabase()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });
});
