/**
 * GET /api/operator/tiktok-coverage — DQ-7 TikTok account-vs-per-campaign feed.
 *
 * Returns the raw inputs the pure `tiktokCoverage()` helper needs:
 * `{ accountTotalCad, campaigns }` over the window. The PANEL computes the
 * coverage verdict client-side (it owns the campaign-store-map). Backs the
 * operator data-quality "TikTok coverage" panel; fetched by the authed client
 * behind the password gate (NOT in any external allowlist).
 *
 * Window: ?from=&to= when both are present and valid; otherwise DEFAULT to
 * today + yesterday (IL TZ). Per DQ-7 this route must NOT throw RangeParamError
 * to the client on missing/malformed params — it defaults the window instead,
 * so a paramless poll from the panel still returns the live two-day picture.
 *
 * Soft-fail mirrors /api/operator/freshness: on any throw we return HTTP 200
 * with `{ accountTotalCad: 0, campaigns: [], error }` so the panel degrades to
 * "nothing to flag" rather than escalating to a hard banner.
 */

import { NextResponse } from 'next/server';
import { fetchTikTokCoverageInputs } from '@/lib/postgresReaders';
import { parseRangeParams, type DateRange } from '@/lib/dateRange';
import { userFacingError } from '@/lib/apiErrors';
import { captureRouteError } from '@/lib/sentry/capture';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface TikTokCoverageResponse {
  accountTotalCad: number;
  campaigns: Array<{ campaignId: string; advertiserId: string; spendCad: number }>;
  error?: string;
}

/** Format a UTC-epoch instant as 'YYYY-MM-DD' in Asia/Jerusalem. */
function ilDate(epochMs: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(epochMs));
}

/** Default window: yesterday → today (IL TZ), DST-safe via UTC-ms anchoring. */
function defaultTwoDayWindow(): DateRange {
  const today = ilDate(Date.now());
  const todayMs = Date.UTC(
    Number(today.slice(0, 4)),
    Number(today.slice(5, 7)) - 1,
    Number(today.slice(8, 10)),
  );
  return { from: ilDate(todayMs - 1 * 86_400_000), to: today };
}

export async function GET(req: Request) {
  // Per DQ-7: do NOT surface RangeParamError to the client. Parse when both
  // params are valid; on any RangeParamError (missing/malformed) default the
  // window to today+yesterday instead of returning 400.
  let range: DateRange;
  try {
    range = parseRangeParams(new URL(req.url).searchParams);
  } catch {
    range = defaultTwoDayWindow();
  }

  try {
    const result = await fetchTikTokCoverageInputs(range);
    return NextResponse.json<TikTokCoverageResponse>(result);
  } catch (e) {
    captureRouteError('/api/operator/tiktok-coverage', e);
    const rawMessage = e instanceof Error ? e.message : String(e);
    console.error('/api/operator/tiktok-coverage GET threw:', rawMessage);
    return NextResponse.json<TikTokCoverageResponse>(
      { accountTotalCad: 0, campaigns: [], error: userFacingError(rawMessage) },
      { status: 200 },
    );
  }
}
