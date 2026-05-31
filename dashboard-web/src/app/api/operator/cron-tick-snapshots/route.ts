/**
 * Task 5.2 (UI/UX overhaul) — HTTP shim for CronTickSnapshotsViewer.
 *
 * GET /api/operator/cron-tick-snapshots
 *   Returns the most recent N cron_tick_snapshots rows (capped at 144 = 24h
 *   × 6 ticks/h) so the viewer can render as a client component with the
 *   unified 15 s SWR refresh.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { fetchCronTickSnapshots, type CronTickSnapshotRow } from '@/lib/operator/registriesReaders';
import { userFacingError } from '@/lib/apiErrors';
import { captureRouteError } from '@/lib/sentry/capture';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface CronTickSnapshotsResponse {
  rows: CronTickSnapshotRow[];
  lastUpdated: string;
  error?: string;
}

export async function GET() {
  const lastUpdated = new Date().toISOString();
  try {
    const rows = await fetchCronTickSnapshots(getSupabaseAdmin());
    return NextResponse.json<CronTickSnapshotsResponse>({ rows, lastUpdated });
  } catch (e) {
    captureRouteError('/api/operator/cron-tick-snapshots', e);
    const rawMessage = e instanceof Error ? e.message : String(e);
    console.error('/api/operator/cron-tick-snapshots GET threw:', rawMessage);
    return NextResponse.json<CronTickSnapshotsResponse>(
      { rows: [], lastUpdated, error: userFacingError(rawMessage) },
      { status: 200 },
    );
  }
}
