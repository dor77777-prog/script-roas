/**
 * Task 5.2 (UI/UX overhaul) — HTTP shim for MetaBucPanel.
 *
 * GET /api/operator/meta-buc-usage
 *   Returns the meta_buc_usage rows (per-(store, ad_account_id) BUC bands)
 *   so MetaBucPanel can render as a client component with the unified 15 s
 *   SWR refresh. Mirrors the pattern used by FreshnessPanel + StatusPill.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { userFacingError } from '@/lib/apiErrors';
import { captureRouteError } from '@/lib/sentry/capture';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface BucRow {
  store_id: string;
  ad_account_id: string;
  ads_insights_call_pct: number;
  ads_insights_cputime_pct: number;
  ads_insights_time_pct: number;
  ads_insights_eta_minutes: number;
  ads_management_call_pct: number;
  ads_management_cputime_pct: number;
  ads_management_time_pct: number;
  ads_management_eta_minutes: number;
  last_url: string | null;
  last_updated_at: string;
}

export interface MetaBucUsageResponse {
  rows: BucRow[];
  lastUpdated: string;
  error?: string;
}

export async function GET() {
  const lastUpdated = new Date().toISOString();
  try {
    const sb = getSupabaseAdmin();
    const { data } = await sb
      .from('meta_buc_usage')
      .select('*')
      .order('store_id', { ascending: true })
      .order('ad_account_id', { ascending: true });
    const rows = (data ?? []) as BucRow[];
    return NextResponse.json<MetaBucUsageResponse>({ rows, lastUpdated });
  } catch (e) {
    captureRouteError('/api/operator/meta-buc-usage', e);
    const rawMessage = e instanceof Error ? e.message : String(e);
    console.error('/api/operator/meta-buc-usage GET threw:', rawMessage);
    return NextResponse.json<MetaBucUsageResponse>(
      { rows: [], lastUpdated, error: userFacingError(rawMessage) },
      { status: 200 },
    );
  }
}
