import { NextResponse } from 'next/server';
import { fetchDailyData } from '@/lib/sheets';
import type { DashboardData } from '@/lib/types';

// Revalidate the underlying data every 60 seconds (server-side cache).
// Client SWR will poll us; this prevents hammering the Sheets API.
export const revalidate = 60;
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rows = await fetchDailyData();
    const stores = Array.from(new Set(rows.map(r => r.storeName))).sort();
    const data: DashboardData = {
      rows,
      stores,
      lastUpdated: new Date().toISOString(),
    };
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Sheets fetch failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
