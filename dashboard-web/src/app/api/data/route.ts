import { NextResponse } from 'next/server';
import { fetchDailyData } from '@/lib/sheets';
import type { DashboardData } from '@/lib/types';
import { cacheControl } from '@/lib/cacheConfig';

// Revalidate the underlying data every 60 seconds (server-side cache).
// Client SWR will poll us; this prevents hammering the Sheets API.
export const revalidate = 60; // matches CACHE_CONFIG.data.revalidate; literal required by Next.js static analysis
export const dynamic = 'force-dynamic';

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
    console.error('Sheets fetch failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
