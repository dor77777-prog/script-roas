/**
 * Phase 05.5 D-D1 / D-D2 / D-D3 — health endpoint consumed by SyncIndicator.
 * Phase 05.7: Sheets ping removed — the dashboard no longer connects to
 * Sheets at runtime, so a Sheets reachability check is meaningless.
 *
 * The `sheets` field is preserved in the response shape and HARDCODED to
 * 'ok' for backward compatibility with SyncIndicator's amber-state logic
 * (which OR's `health.supabase === 'down'` with cloudSync errors). Removing
 * the field entirely would require a coordinated SyncIndicator change and
 * a brief window where the type union mismatched mid-deploy; keeping it
 * stable-and-always-ok is the safer cut-over for an internal tool.
 *
 * Cache: revalidate=10 (server-side ISR), swr=60 (CDN). The client SWR poll
 * fires every 30s; CDN coalesces requests within the 10s revalidate window.
 */
import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { cacheControl } from '@/lib/cacheConfig';
import { userFacingError } from '@/lib/apiErrors';

// Next.js requires `revalidate` to be a literal number, not a MemberExpression
// (CACHE_CONFIG.health.revalidate would fail Next's static analyzer with
// "Unsupported node type MemberExpression"). Same pattern as
// dashboard-state/route.ts:10 + store-meta/route.ts:10. The literal 10 below
// MUST stay in sync with CACHE_CONFIG.health.revalidate.
export const revalidate = 10;  // matches CACHE_CONFIG.health.revalidate; literal required by Next.js

export type HealthStatus = 'ok' | 'down';
export type HealthResponse = {
  /** Phase 05.7: dashboard no longer connects to Sheets; this field is
   *  preserved for SyncIndicator backward compat and always reports 'ok'. */
  sheets: HealthStatus;
  supabase: HealthStatus;
  lastChecked: string;
  errors?: { sheets?: string; supabase?: string };
};

/**
 * D-D2 ping: SELECT count(*) FROM stores via supabase-js. head:true keeps
 * bandwidth ~zero — only metadata transferred, never row data.
 */
async function pingSupabase(): Promise<void> {
  const { error } = await getSupabase()
    .from('stores')
    .select('id', { count: 'exact', head: true });
  if (error) throw new Error(error.message);
}

export async function GET() {
  // Phase 05.7: only Supabase is checked. The previous pingSheets() call has
  // been removed because the dashboard no longer talks to Sheets at runtime.
  // We unwrap the previous Promise.allSettled([sheets, supabase]) into a
  // direct try/catch on pingSupabase — there's no longer a second ping to
  // coordinate against.
  let supabaseStatus: HealthStatus = 'ok';
  let supabaseError: string | undefined;
  try {
    await pingSupabase();
  } catch (err) {
    supabaseStatus = 'down';
    const message = err instanceof Error ? err.message : String(err);
    supabaseError = userFacingError(message);
  }

  const body: HealthResponse = {
    // Phase 05.7: dashboard no longer connects to Sheets; this field is
    // preserved for SyncIndicator backward compat and always reports 'ok'.
    sheets: 'ok',
    supabase: supabaseStatus,
    lastChecked: new Date().toISOString(),
    ...(supabaseError ? { errors: { supabase: supabaseError } } : {}),
  };

  return NextResponse.json(body, {
    status: 200,  // always 200 — sibling soft-fail convention
    headers: { 'Cache-Control': cacheControl('health') },
  });
}
