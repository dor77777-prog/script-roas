import { NextResponse } from 'next/server';
import type { CohortMonthlyRow } from '@/lib/postgresReaders';
import { fetchCohortMonthlyFromPostgres } from '@/lib/postgresReaders';
import { cacheControl } from '@/lib/cacheConfig';
import { userFacingError } from '@/lib/apiErrors';
import { captureRouteError } from '@/lib/sentry/capture';

// 5-minute cache. customer_cohort_monthly is a weekly full-replace
// (cron-cohort-refresh) of slow-moving strategic data, so refreshing more
// often than the server ISR window doesn't help the customer-value analysis
// but does burn Supabase request quota.
export const revalidate = 300; // matches CACHE_CONFIG.cohorts.revalidate; literal required by Next.js

export type CohortsResponse = {
  rows: CohortMonthlyRow[];
  lastUpdated: string;
  /** Present only on the degraded-error path (rows: []). Consumers that
   *  surface "synced N min ago" should treat the response as data-less when
   *  this is set, even though rows + lastUpdated still satisfy the type. */
  error?: string;
};

export async function GET() {
  // API contract note (Wave 2, 2026-06-03):
  // No ?store= param is parsed here. This route returns ALL stores' cohort
  // rows; the client (CustomerValueTab) slices by store after receiving the
  // full dataset — the same contract as /api/orders-attribution. Cohort/LTV
  // analysis is per-store + business (selector), so the client needs the
  // full set in hand to switch scope without a refetch.
  try {
    const rows = await fetchCohortMonthlyFromPostgres();
    return NextResponse.json(
      { rows, lastUpdated: new Date().toISOString() } satisfies CohortsResponse,
      {
        headers: {
          'Cache-Control': cacheControl('cohorts'),
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Raw message logged server-side for ops; sanitized message returned to client.
    captureRouteError('cohorts', err);
    console.error('cohorts fetch failed:', message);
    // Degrade gracefully — empty array lets the customer-value tab render its
    // empty/low-data state instead of breaking. lastUpdated is included so the
    // response shape satisfies the declared type — a consumer reading
    // `data.lastUpdated` on the error path gets a valid ISO timestamp instead
    // of `undefined` (which would crash downstream Date()/formatDate).
    // Cache-Control: no-store — without it, the route-level `revalidate = 300`
    // would pin a transient upstream blip in the CDN for 5 minutes.
    return NextResponse.json(
      {
        rows: [],
        lastUpdated: new Date().toISOString(),
        error: userFacingError(message),
      } satisfies CohortsResponse,
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
