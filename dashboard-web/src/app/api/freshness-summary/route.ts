/**
 * GET /api/freshness-summary — DQ-5 source-health rollup.
 *
 * Reads all `data_freshness` rows (`getFreshness()`) and collapses them into a
 * per-(store, platform) health verdict via the pure `sourceStatusRollup()`:
 * `{ anyUnhealthy, unhealthy[] }`. Backs the Home data-quality "sources
 * healthy?" badge; fetched by the authed client behind the password gate (NOT
 * in any external allowlist).
 *
 * Soft-fail mirrors /api/operator/freshness: on any throw we return HTTP 200
 * with `{ anyUnhealthy: false, unhealthy: [], error }` so the badge degrades to
 * "all healthy" rather than escalating to a hard banner.
 */

import { NextResponse } from 'next/server';
import { getFreshness } from '@/lib/inngest/freshness';
import { sourceStatusRollup, type SourceStatusRollup } from '@/lib/freshness/sourceStatus';
import { userFacingError } from '@/lib/apiErrors';
import { captureRouteError } from '@/lib/sentry/capture';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface FreshnessSummaryResponse extends SourceStatusRollup {
  error?: string;
}

export async function GET() {
  try {
    const rows = await getFreshness();
    const rollup = sourceStatusRollup(rows);
    return NextResponse.json<FreshnessSummaryResponse>(rollup);
  } catch (e) {
    captureRouteError('/api/freshness-summary', e);
    const rawMessage = e instanceof Error ? e.message : String(e);
    console.error('/api/freshness-summary GET threw:', rawMessage);
    return NextResponse.json<FreshnessSummaryResponse>(
      { anyUnhealthy: false, unhealthy: [], error: userFacingError(rawMessage) },
      { status: 200 },
    );
  }
}
