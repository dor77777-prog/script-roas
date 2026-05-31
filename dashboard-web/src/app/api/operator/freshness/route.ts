/**
 * Task 5.2 (UI/UX overhaul) — HTTP shim for FreshnessPanel.
 *
 * GET /api/operator/freshness
 *   Returns the same FreshnessRow[] that getFreshness() returns server-side.
 *   The FreshnessPanel was originally a server component; Task 5.2 converted
 *   the 4 operator sub-tabs to a unified 15 s SWR refresh paradigm, so each
 *   sub-tab panel now polls a stable endpoint instead of relying on a hard
 *   page reload to re-read Supabase.
 *
 * Soft-fail mirrors /api/operator/token-failures: on any throw we return
 * HTTP 200 with `{ rows: [], error: '…' }` so SWR renders the inline empty
 * state rather than escalating to a hard error banner.
 */

import { NextResponse } from 'next/server';
import { getFreshness, type FreshnessRow } from '@/lib/inngest/freshness';
import { userFacingError } from '@/lib/apiErrors';
import { captureRouteError } from '@/lib/sentry/capture';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface FreshnessResponse {
  rows: FreshnessRow[];
  lastUpdated: string;
  error?: string;
}

export async function GET() {
  const lastUpdated = new Date().toISOString();
  try {
    const rows = await getFreshness();
    return NextResponse.json<FreshnessResponse>({ rows, lastUpdated });
  } catch (e) {
    captureRouteError('/api/operator/freshness', e);
    const rawMessage = e instanceof Error ? e.message : String(e);
    console.error('/api/operator/freshness GET threw:', rawMessage);
    return NextResponse.json<FreshnessResponse>(
      { rows: [], lastUpdated, error: userFacingError(rawMessage) },
      { status: 200 },
    );
  }
}
