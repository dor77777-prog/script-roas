/**
 * Server-only Supabase client. Uses the anon key — Phase 05.5 only does
 * SELECT count(*) FROM stores (D-D2), which is allowed even with RLS off.
 *
 * Why anon and not service_role:
 *  - Lower blast-radius if the key ever leaks (anon can SELECT/INSERT/UPDATE/
 *    DELETE but is rate-limited by Supabase; service_role bypasses RLS entirely)
 *  - D-D2 locks the ping as `SELECT count(*) FROM stores` — read-only — so anon
 *    is sufficient
 *  - Phase 05.6 will introduce a SECOND client using service_role for the
 *    Inngest writer; that's the right place to add the elevated client
 *
 * Note on env-var names:
 *  - `SUPABASE_URL` and `SUPABASE_ANON_KEY` (server-side only — no NEXT_PUBLIC_
 *    prefix) are sufficient for Phase 05.5. If we later need browser-side
 *    queries (e.g., realtime), promote them to `NEXT_PUBLIC_SUPABASE_URL` and
 *    `NEXT_PUBLIC_SUPABASE_ANON_KEY` — but defer that to 05.6 when the read-
 *    path actually flips to Postgres.
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
  const key = process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error('SUPABASE_URL or SUPABASE_ANON_KEY missing — check Vercel env vars');
  }

  cached = createClient(url, key, {
    auth: { persistSession: false },  // server-side, no user session
  });
  return cached;
}
