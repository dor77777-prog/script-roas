/**
 * GET /api/operator/runs
 *
 * QStash/DB-backed replacement for the removed Inngest /api/operator/jobs
 * proxy. The old route forwarded to Inngest's REST run-log; nothing runs on
 * Inngest anymore (Vercel Cron + QStash), so there is no run-log to proxy.
 * Instead this route rolls the DB telemetry the new pipeline DOES write into a
 * per-job last-run / health summary:
 *   - data_freshness        → per platform×scope last_success / last_error /
 *                             status (drives worker-meta/google/tiktok + cohort)
 *   - cron_tick_snapshots   → per orchestrator tick fan-out (drives cron-tick)
 *
 * The aggregation is the pure, unit-tested `buildRunsSummary` deep module; this
 * route is the thin server I/O shell around it.
 *
 * SECURITY (no admin in the client): supabaseAdmin / getFreshness stay server-
 * side. The component (RunsPanel) only ever talks to this JSON endpoint.
 *
 * SOFT-FAIL (mirrors the old proxy + /api/operator/freshness): on ANY throw we
 * return HTTP 200 with `{ rows: [], error: '…' }` (sanitized via
 * userFacingError) so the panel renders a calm inline amber banner instead of
 * escalating to a hard SWR error state. The raw error is logged + sent to
 * Sentry server-side for ops triage.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getFreshness } from '@/lib/inngest/freshness';
import { fetchCronTickSnapshots } from '@/lib/operator/registriesReaders';
import { buildRunsSummary, type RunRow } from '@/lib/operator/runsSummary';
import { userFacingError } from '@/lib/apiErrors';
import { captureRouteError } from '@/lib/sentry/capture';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface RunsResponse {
  rows: RunRow[];
  lastUpdated: string;
  error?: string;
}

export async function GET() {
  const lastUpdated = new Date().toISOString();
  try {
    const [freshness, ticks] = await Promise.all([
      getFreshness(),
      fetchCronTickSnapshots(getSupabaseAdmin()),
    ]);
    const rows = buildRunsSummary({ freshness, ticks, now: Date.now() });
    return NextResponse.json<RunsResponse>({ rows, lastUpdated });
  } catch (e) {
    captureRouteError('/api/operator/runs', e);
    const rawMessage = e instanceof Error ? e.message : String(e);
    console.error('/api/operator/runs GET threw:', rawMessage);
    return NextResponse.json<RunsResponse>(
      { rows: [], lastUpdated, error: userFacingError(rawMessage) },
      { status: 200 },
    );
  }
}
