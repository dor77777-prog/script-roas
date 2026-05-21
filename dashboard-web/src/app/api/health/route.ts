/**
 * Phase 05.5 D-D1 / D-D2 / D-D3 — health endpoint consumed by SyncIndicator.
 *
 * Pings both Sheets API + Supabase in parallel via Promise.allSettled (one
 * failing doesn't abort the other). Returns shape-compliant JSON with HTTP
 * 200 always — soft-fail per the codebase convention (see
 * dashboard-state/route.ts:37-55 + store-meta/route.ts:28-36).
 *
 * Cache: revalidate=10 (server-side ISR), swr=60 (CDN). The client SWR poll
 * fires every 30s; CDN coalesces requests within the 10s revalidate window.
 */
import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getSupabase } from '@/lib/supabase';
import { getAuth } from '@/lib/sheets';
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
  sheets: HealthStatus;
  supabase: HealthStatus;
  lastChecked: string;
  errors?: { sheets?: string; supabase?: string };
};

/**
 * Cheapest Sheets verification — metadata-only get (~1 read-quota unit per
 * RESEARCH.md Pitfall 7). Uses reader-scope service account.
 */
async function pingSheets(): Promise<void> {
  const auth = getAuth();  // exported from sheets.ts in Task 1
  const spreadsheetId = process.env.SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error('Missing SPREADSHEET_ID env var');
  const sheets = google.sheets({ version: 'v4', auth });
  await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'spreadsheetId',
  });
}

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
  const [sheetsRes, supabaseRes] = await Promise.allSettled([
    pingSheets(),
    pingSupabase(),
  ]);

  const sheetsStatus: HealthStatus = sheetsRes.status === 'fulfilled' ? 'ok' : 'down';
  const supabaseStatus: HealthStatus = supabaseRes.status === 'fulfilled' ? 'ok' : 'down';

  const errors: HealthResponse['errors'] = {};
  if (sheetsRes.status === 'rejected') {
    const message = sheetsRes.reason instanceof Error
      ? sheetsRes.reason.message
      : String(sheetsRes.reason);
    errors.sheets = userFacingError(message);
  }
  if (supabaseRes.status === 'rejected') {
    const message = supabaseRes.reason instanceof Error
      ? supabaseRes.reason.message
      : String(supabaseRes.reason);
    errors.supabase = userFacingError(message);
  }

  const body: HealthResponse = {
    sheets: sheetsStatus,
    supabase: supabaseStatus,
    lastChecked: new Date().toISOString(),
    ...(Object.keys(errors).length > 0 ? { errors } : {}),
  };

  return NextResponse.json(body, {
    status: 200,  // always 200 — sibling soft-fail convention
    headers: { 'Cache-Control': cacheControl('health') },
  });
}
