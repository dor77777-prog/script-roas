import { NextResponse } from 'next/server';
import { fetchAdsData, type AdRow } from '@/lib/ads';
import { cacheControl } from '@/lib/cacheConfig';

export const revalidate = 300; // matches CACHE_CONFIG.ads.revalidate; 5 min — literal required by Next.js

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
          'Cache-Control': cacheControl('ads'),
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
