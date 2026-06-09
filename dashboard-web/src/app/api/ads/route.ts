import { NextResponse } from 'next/server';
import type { AdRow } from '@/lib/ads';
import {
  fetchAdsFromPostgres,
  fetchAdsDailyLastWriteAt,
} from '@/lib/postgresReaders';
import { cacheControl } from '@/lib/cacheConfig';
import { userFacingError } from '@/lib/apiErrors';
import { parseRangeParams, RangeParamError } from '@/lib/dateRange';
import { captureRouteError } from '@/lib/sentry/capture';

export const revalidate = 300; // matches CACHE_CONFIG.ads.revalidate; 5 min — literal required by Next.js

export type AdsResponse = {
  rows: AdRow[];
  lastUpdated: string;
  /** Phase 05.7.6 — most-recent ads_daily updated_at in the range. */
  dataLastWriteAt: string | null;
  /** Present ONLY on the failure path: the route returns HTTP 200 with a
   *  user-facing error string (so the client can show a message). The fetcher
   *  MUST throw on this so a real DB failure doesn't masquerade as "no ads in
   *  range" (Task 2, 2026-06-09). */
  error?: string;
};

export async function GET(req: Request) {
  let range;
  try {
    range = parseRangeParams(new URL(req.url).searchParams);
  } catch (e) {
    if (e instanceof RangeParamError) {
      return NextResponse.json({ error: e.message }, {
        status: 400,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    throw e;
  }

  try {
    const [rows, dataLastWriteAt] = await Promise.all([
      fetchAdsFromPostgres({ range }),
      fetchAdsDailyLastWriteAt({ range }),
    ]);
    if (rows.length > 50000) {
      console.warn(`/api/ads: large response (${rows.length} rows) — consider pagination`);
    }
    return NextResponse.json(
      {
        rows,
        lastUpdated: new Date().toISOString(),
        dataLastWriteAt,
      } satisfies AdsResponse,
      {
        headers: { 'Cache-Control': cacheControl('ads') },
      },
    );
  } catch (err) {
    captureRouteError('ads', err);
    const message = err instanceof Error ? err.message : String(err);
    console.error('ads fetch failed:', message);
    return NextResponse.json(
      {
        rows: [],
        lastUpdated: new Date().toISOString(),
        dataLastWriteAt: null,
        error: userFacingError(message),
      },
      { status: 200 },
    );
  }
}
