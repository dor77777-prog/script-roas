import { NextResponse } from 'next/server';
import {
  fetchDailyDataFromPostgres,
  fetchDataDailyLastWriteAt,
  fetchAdStateFromPostgres,
  fetchStoreMetaFromPostgres,
} from '@/lib/postgresReaders';
import type { DashboardData } from '@/lib/types';
import { applicablePlatforms, TIKTOK_SHARED_STORES } from '@/lib/adState';
import type { AdPlatform } from '@/lib/adState';
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
      // P1-11 (2026-06-10): hard 3s ceiling. This fetch sits inside the
      // route's Promise.all — without a signal, a hung Frankfurter
      // connection stalls the PRIMARY dashboard route to the platform
      // timeout ceiling. On abort/timeout the catch below returns null and
      // the client renders without the FX-derived extras (graceful, same as
      // any other FX failure).
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { rates?: { CAD?: number } };
    return j.rates?.CAD ?? null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  // API contract note (P1-2, 2026-05-27):
  // ?store= is intentionally NOT parsed here. This route returns ALL stores'
  // rows for the date range; the client (Dashboard.tsx / filters.store) slices
  // by store client-side. This is by design: the "All Stores" aggregate view
  // needs the full dataset to compute cross-store totals accurately.
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
    const [rows, fxIlsToCad, dataLastWriteAt, adStateMap, storeMeta] = await Promise.all([
      fetchDailyDataFromPostgres({ range }),
      fetchTodayFx(),
      // A7-F1 (2026-05-27): the freshness chip ("synced N min ago") must
      // reflect the GLOBAL most-recent write to data_daily, NOT the max
      // within the selected range. Scoping it to `range` meant picking a
      // historical range showed a false-red stale chip even while the live
      // cron was writing today's rows every ~10 min. The data fetch above
      // stays range-scoped; only the freshness signal goes global.
      fetchDataDailyLastWriteAt(),
      fetchAdStateFromPostgres().catch(() => ({})),
      fetchStoreMetaFromPostgres().catch(() => []),
    ]);
    const tiktokStores = new Set<string>(TIKTOK_SHARED_STORES);
    const storeApplicablePlatforms: Record<string, AdPlatform[]> = {};
    for (const s of storeMeta) storeApplicablePlatforms[s.storeId] = applicablePlatforms(s, tiktokStores);
    // P0-1 (2026-06-10): >= not > — paginate() caps at EXACTLY 50,000 rows,
    // so the old `> 50000` guard was mathematically unreachable. At the cap,
    // the response is likely truncated (paginate() also fires its own
    // console.error tripwire with the table label).
    if (rows.length >= 50000) {
      console.warn(`/api/data: response at the paginate() ceiling (${rows.length} rows) — likely truncated (P0-1)`);
    }
    const stores = Array.from(new Set(rows.map(r => r.storeName))).sort();
    const data: DashboardData = {
      rows,
      stores,
      lastUpdated: new Date().toISOString(),
      dataLastWriteAt,
      fxIlsToCad,
      adStateMap,
      storeApplicablePlatforms,
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
        adStateMap: {},
        storeApplicablePlatforms: {},
        error: userFacingError(message),
      } satisfies DashboardData,
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
