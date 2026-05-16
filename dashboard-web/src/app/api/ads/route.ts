import { NextResponse } from 'next/server';
import { fetchAdsData, type AdRow } from '@/lib/ads';

export const revalidate = 300; // 5 min — ads data refreshes daily, no need for tight cache

export type AdsResponse = {
  rows: AdRow[];
  lastUpdated: string;
};

export async function GET() {
  try {
    const rows = await fetchAdsData();
    return NextResponse.json(
      { rows, lastUpdated: new Date().toISOString() } satisfies AdsResponse,
      {
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=900',
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('ads fetch failed:', message);
    // Degrade gracefully — empty array lets the AdsDrawer show an "no data"
    // state instead of crashing the campaigns surface.
    return NextResponse.json({ rows: [], error: message }, { status: 200 });
  }
}
