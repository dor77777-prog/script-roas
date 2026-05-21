/**
 * Server-only Supabase admin client (service_role).
 *
 * Why service_role and not anon:
 *  - The 20260521075741_add_constraints_and_grants.sql migration grants
 *    SELECT (only) to anon. INSERT / UPDATE / DELETE require an authenticated
 *    role; service_role is the simplest path with the URL-obscurity trust
 *    model (D-D2).
 *  - service_role bypasses RLS — irrelevant here because RLS is disabled
 *    on all 10 tables (10 expected `0013_rls_disabled_in_public` advisor
 *    lints per the User Manual §1.7), but the same key is what enables the
 *    write coverage anon lacks.
 *
 * SECURITY: this file MUST NEVER be imported by a client component.
 *   - All callers are server-side: Inngest functions (src/inngest/functions/*.ts),
 *     API routes (src/app/api/inngest/route.ts, src/app/api/operator/**\/route.ts),
 *     and the one-off importer (scripts/import-manual-overrides.ts).
 *   - There is no NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY and there never should
 *     be — even mentioning that env-var name in code outside of an explanatory
 *     comment is a planning defect (mirrors the supabase.ts T-05.5-03-S3 threat).
 *
 * Pattern: lazy factory matching supabase.ts:30 (BL-01 fix from 05.5-03).
 * The throw happens inside the function so a missing env var manifests as
 * a caught Inngest step error (→ Inngest retries 4 times, then dead-letters
 * → operator sees in jobs table), NOT a module-load-time crash that
 * preempts every other Inngest function.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing — check Vercel env vars',
    );
  }

  cached = createClient(url, key, {
    auth: {
      persistSession: false,    // server-side; no user session
      autoRefreshToken: false,  // service_role doesn't need token refresh
      detectSessionInUrl: false,
    },
  });
  return cached;
}
