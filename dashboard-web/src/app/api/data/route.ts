import { NextResponse } from 'next/server';
import { fetchDailyData } from '@/lib/sheets';
import type { DashboardData } from '@/lib/types';
import { cacheControl } from '@/lib/cacheConfig';
import { userFacingError } from '@/lib/apiErrors';

// Revalidate the underlying data every 60 seconds (server-side cache).
// Client SWR will poll us; this prevents hammering the Sheets API.
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

export async function GET() {
  try {
    const [rows, fxIlsToCad] = await Promise.all([fetchDailyData(), fetchTodayFx()]);
    if (rows.length > 50000) {
      console.warn(`/api/data: large response (${rows.length} rows) — consider pagination`);
    }
    const stores = Array.from(new Set(rows.map(r => r.storeName))).sort();
    const data: DashboardData = {
      rows,
      stores,
      lastUpdated: new Date().toISOString(),
      fxIlsToCad,
    };
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': cacheControl('data'),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Log the raw message server-side so ops can see spreadsheet ID / service
    // account email / stack details — but don't leak any of that to the client.
    console.error('Sheets fetch failed:', message);
    // Degrade gracefully with status 200 + empty rows — matches /api/ads,
    // /api/orders-attribution, /api/store-meta, /api/product-catalog. The
    // consumer-side fetcher in Dashboard.tsx now checks `data.error` and
    // surfaces it through the same error banner, so the UX still shows
    // "שגיאה בטעינת הנתונים" instead of silently rendering an empty dashboard.
    // (WR-06)
    return NextResponse.json(
      {
        rows: [],
        stores: [],
        lastUpdated: new Date().toISOString(),
        fxIlsToCad: null,
        error: userFacingError(message),
      } satisfies DashboardData,
      { status: 200 },
    );
  }
}
