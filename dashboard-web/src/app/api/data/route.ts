import { NextResponse } from 'next/server';
import {
  fetchDailyDataFromPostgres,
  fetchDataDailyLastWriteAt,
} from '@/lib/postgresReaders';
import type { DashboardData } from '@/lib/types';
import { cacheControl } from '@/lib/cacheConfig';
import { userFacingError } from '@/lib/apiErrors';
import { parseRangeParams, RangeParamError } from '@/lib/dateRange';
import { captureRouteError } from '@/lib/sentry/capture';

// Revalidate the underlying data every 60 seconds (server-side cache).
// Client SWR will poll us; this prevents hammering Supabase on every request.
//
// No `force-dynamic` — it overrides `revalidate` and the explicit
// `Cache-Control` header on the response, defeating the caching this
// route relies on. See IN-06 and the matching comment in /api/dashboard-state.
export const revalidate = 60; // matches CACHE_CONFIG.data.revalidate; literal required by Next.js static analysis

async function fetchTodayFx(): Promise<number | null> {
  try {
    const r = await fetch('https://api.frankfurter.dev/v1/latest?base=ILS&symbols=CAD', {
      next: { revalidate: 3600 }, // FX changes once per business day; 1h cache is fine
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { rates?: { CAD?: number } };
    return j.rates?.CAD ?? null;
  } catch {
    return null;
  }
}

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
    const [rows, fxIlsToCad, dataLastWriteAt] = await Promise.all([
      fetchDailyDataFromPostgres({ range }),
      fetchTodayFx(),
      fetchDataDailyLastWriteAt({ range }),
    ]);
    if (rows.length > 50000) {
      console.warn(`/api/data: large response (${rows.length} rows) — consider pagination`);
    }
    const stores = Array.from(new Set(rows.map(r => r.storeName))).sort();
    const data: DashboardData = {
      rows,
      stores,
      lastUpdated: new Date().toISOString(),
      dataLastWriteAt,
      fxIlsToCad,
    };
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': cacheControl('data'),
      },
    });
  } catch (err) {
    captureRouteError('data', err, { range });
    const message = err instanceof Error ? err.message : String(err);
    // Log the raw message server-side so ops can see Postgres error details
    // (table, column, constraint, etc.) — but don't leak any of that to the
    // client.
    console.error('data fetch failed:', message);
    // Degrade gracefully with status 200 + empty rows — matches /api/ads,
    // /api/orders-attribution, /api/store-meta, /api/product-catalog. The
    // consumer-side fetcher in Dashboard.tsx now checks `data.error` and
    // surfaces it through the same error banner, so the UX still shows
    // "שגיאה בטעינת הנתונים" instead of silently rendering an empty dashboard.
    // (WR-06)
    // Cache-Control: no-store ensures a transient upstream blip does NOT
    // get pinned in the CDN by the route-level `revalidate = 60`. Without
    // this header, ISR semantics treat the 200-degraded-error response
    // as cacheable and every consumer until T+60s sees the same error.
    // WR-02. Mirrors the 400 RangeParamError path above.
    return NextResponse.json(
      {
        rows: [],
        stores: [],
        lastUpdated: new Date().toISOString(),
        dataLastWriteAt: null,
        fxIlsToCad: null,
        error: userFacingError(message),
      } satisfies DashboardData,
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
