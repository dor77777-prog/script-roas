/**
 * GET /api/active-overrides — DQ-3 active manual-spend overrides summary.
 *
 * Parses ?from=&to=, reads the `manual_overrides` rows in range
 * (`fetchManualOverridesForRange`), and returns the pure
 * `overridesActive(rows, range)` rollup: are any operator-typed spend
 * overrides ACTIVE in the visible range, and which store×platform combos do
 * they cover. Backs the Home data-quality "manual spend" badge; fetched by the
 * authed client behind the password gate (NOT in any external allowlist).
 *
 * Soft-fail mirrors /api/operator/freshness: a malformed ?from/?to is a 400
 * RangeParamError (so a caller knows the request is wrong, matching /api/data);
 * any OTHER throw returns HTTP 200 with `{ anyActive: false,
 * byStorePlatform: {}, error }` so the badge degrades to "nothing flagged"
 * rather than crashing the Home surface.
 */

import { NextResponse } from 'next/server';
import { fetchManualOverridesForRange } from '@/lib/postgresReaders';
import { overridesActive, type OverridesActiveResult } from '@/lib/home/overridesActive';
import { parseRangeParams, RangeParamError } from '@/lib/dateRange';
import { userFacingError } from '@/lib/apiErrors';
import { captureRouteError } from '@/lib/sentry/capture';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface ActiveOverridesResponse extends OverridesActiveResult {
  error?: string;
}

export async function GET(req: Request) {
  let range;
  try {
    range = parseRangeParams(new URL(req.url).searchParams);
  } catch (e) {
    if (e instanceof RangeParamError) {
      return NextResponse.json(
        { error: e.message },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    throw e;
  }

  try {
    const rows = await fetchManualOverridesForRange(range);
    const result = overridesActive(rows, range);
    return NextResponse.json<ActiveOverridesResponse>(result);
  } catch (e) {
    captureRouteError('/api/active-overrides', e);
    const rawMessage = e instanceof Error ? e.message : String(e);
    console.error('/api/active-overrides GET threw:', rawMessage);
    return NextResponse.json<ActiveOverridesResponse>(
      { anyActive: false, byStorePlatform: {}, error: userFacingError(rawMessage) },
      { status: 200 },
    );
  }
}
