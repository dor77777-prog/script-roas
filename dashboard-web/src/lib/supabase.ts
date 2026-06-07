/**
 * Server-only Supabase client for server-side READS.
 *
 * Phase 5a: getSupabase() now returns a SERVICE-ROLE client so server-side
 * reads bypass RLS (enabled in Phase 5b). Server-only — never imported by a
 * client component (the key is non-NEXT_PUBLIC, so it cannot run client-side).
 * The legacy anon key is unused by reads from here; full env cleanup is Phase 7.
 *
 * Why the cutover:
 *  - Phase 5b will enable RLS on the read tables + revoke `anon` SELECT. Any
 *    read still going through the anon key would then return 0 rows. Routing
 *    every server-side read through service_role (which BYPASSES RLS) makes the
 *    RLS lockdown safe. ZERO behavior change until 5b lands (both keys read the
 *    same rows while grants/RLS are unchanged).
 *  - All ~24 callers are reads (SELECT / maybeSingle / rpc-read); zero writes.
 *    Writers already use getSupabaseAdmin() directly.
 *
 * SECURITY: this MUST NEVER be reachable client-side. There is no
 * NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY and there never should be.
 *
 * Note on env-var names:
 *  - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (server-side only — no
 *    NEXT_PUBLIC_ prefix).
 *
 * Pattern: lazy factory (NOT module-load throw). Mirrors sheets.ts:getAuth —
 * the throw happens inside the function so a missing env var manifests as a
 * caught `pingSupabase` rejection (→ amber SyncIndicator) instead of a route
 * module that fails to load (→ HTTP 500 → indicator stays neutral / never amber,
 * silently violating the soft-fail contract documented in the User Manual §2.1).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing — check Vercel env vars');
  }

  cached = createClient(url, key, {
    auth: { persistSession: false },  // server-side, no user session
  });
  return cached;
}
