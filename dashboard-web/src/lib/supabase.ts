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
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;

if (!url || !key) {
  // Fail fast at module load if env vars are missing — same pattern as
  // dashboard-web/src/lib/sheets.ts which requires GOOGLE_PRIVATE_KEY at boot.
  throw new Error('SUPABASE_URL or SUPABASE_ANON_KEY missing — check Vercel env vars');
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false },  // server-side, no user session
});
