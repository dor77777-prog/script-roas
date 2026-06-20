/**
 * Task 5.1 (UI/UX overhaul) — operator health-summary endpoint.
 *
 * GET /api/operator/health-summary
 *   Returns a single rolled-up "is everything green?" signal that powers the
 *   <StatusPill> in the /operator page header. The StatusPill is the
 *   highest-level operator UX surface — at a glance the operator should be
 *   able to tell whether the dashboard pipelines are healthy without having
 *   to scan the freshness lag matrix row by row.
 *
 * Inputs aggregated:
 *   - data_freshness                 → freshness_pct = success_rows / total_rows
 *   - token_failures (unresolved)    → token_failures_count
 *   - campaign_status_events failed  → out-of-scope (status_events surfaces
 *                                       worker successes/failures separately;
 *                                       the audit asked specifically for the
 *                                       "errors_1h" rolling window which we
 *                                       proxy with unresolved token failures
 *                                       — every failed worker writes one).
 *
 * Status thresholds (per Wave 5 spec):
 *   - GREEN  → freshness_pct ≥ 0.95 AND errors_1h === 0
 *   - YELLOW → freshness_pct ∈ [0.80, 0.95) OR errors_1h ∈ [1, 3]
 *   - RED    → freshness_pct < 0.80 OR errors_1h > 3
 *
 * Soft-fail mirrors /api/operator/token-failures: on any throw we return
 * HTTP 200 with `{ status: 'unknown', error: '…' }` so the StatusPill renders
 * a neutral chip instead of breaking the page header.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getFreshness } from '@/lib/inngest/freshness';
import { isAgeStale } from '@/lib/freshness/sourceStatus';
import { userFacingError } from '@/lib/apiErrors';
import { captureRouteError } from '@/lib/sentry/capture';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export type HealthStatus = 'green' | 'yellow' | 'red' | 'unknown';

export interface HealthSummaryResponse {
  /** Overall pill colour — drives the StatusPill in the operator header. */
  status: HealthStatus;
  /** Fraction in [0, 1] of data_freshness rows whose status === 'success'. */
  freshness_pct: number;
  /** Count of unresolved token_failures rows (proxy for "errors in the last hour"). */
  errors_1h: number;
  /** Snapshot timestamp (server now). */
  lastUpdated: string;
  /** Present only when a sub-fetch failed; UI shows a neutral chip. */
  error?: string;
}

const GREEN_FRESHNESS_MIN = 0.95;
const YELLOW_FRESHNESS_MIN = 0.8;
const YELLOW_ERRORS_MAX = 3;

function deriveStatus(freshnessPct: number, errors1h: number): HealthStatus {
  if (freshnessPct >= GREEN_FRESHNESS_MIN && errors1h === 0) return 'green';
  if (freshnessPct < YELLOW_FRESHNESS_MIN || errors1h > YELLOW_ERRORS_MAX) {
    return 'red';
  }
  return 'yellow';
}

export async function GET() {
  const lastUpdated = new Date().toISOString();
  try {
    const sb = getSupabaseAdmin();

    // freshness: same reader the FreshnessPanel uses.
    const rows = await getFreshness();
    const total = rows.length;
    // FIX #5: a row counts as "fresh" only if its status is 'success' AND its
    // last_success_at is within the per-scope SLA. A dead worker keeps writing
    // 'success' status forever (status = "last write SUCCEEDED", not "data is
    // CURRENTLY fresh"); the age gate is what stops a stopped pipeline from
    // masking the outage as GREEN.
    const now = Date.now();
    const success = rows.filter(
      (r) => r.status === 'success' && !isAgeStale(r.last_success_at, r.scope, now),
    ).length;
    // When data_freshness is empty (cold start) we treat the pipeline as
    // GREEN — there is nothing wrong yet, just nothing to compare against.
    const freshnessPct = total === 0 ? 1 : success / total;

    // errors_1h proxy: unresolved token_failures. Every worker that hits
    // an auth/API error records a row; resolution clears it. This is the
    // closest signal the dashboard already maintains to "what is currently
    // broken right now".
    type CountResp = { count: number | null; error: { message: string } | null };
    const { count, error: tfErr } = (await sb
      .from('token_failures')
      .select('provider', { count: 'exact', head: true })
      .is('resolved_at', null)) as CountResp;
    if (tfErr) {
      console.error('[health-summary] token_failures count error:', tfErr.message);
    }
    const errors1h = count ?? 0;

    const status = deriveStatus(freshnessPct, errors1h);
    return NextResponse.json<HealthSummaryResponse>({
      status,
      freshness_pct: freshnessPct,
      errors_1h: errors1h,
      lastUpdated,
    });
  } catch (e) {
    captureRouteError('/api/operator/health-summary', e);
    const rawMessage = e instanceof Error ? e.message : String(e);
    console.error('/api/operator/health-summary GET threw:', rawMessage);
    return NextResponse.json<HealthSummaryResponse>(
      {
        status: 'unknown',
        freshness_pct: 0,
        errors_1h: 0,
        lastUpdated,
        error: userFacingError(rawMessage),
      },
      { status: 200 },
    );
  }
}
