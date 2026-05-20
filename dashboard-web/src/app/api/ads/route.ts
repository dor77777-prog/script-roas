import { NextResponse } from 'next/server';
import { fetchAdsData, type AdRow } from '@/lib/ads';
import { cacheControl } from '@/lib/cacheConfig';
import { userFacingError } from '@/lib/apiErrors';
import { parseRangeParams, RangeParamError } from '@/lib/dateRange';

export const revalidate = 300; // matches CACHE_CONFIG.ads.revalidate; 5 min — literal required by Next.js

export type AdsResponse = {
  rows: AdRow[];
  lastUpdated: string;
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
    const rows = await fetchAdsData({ range });
    if (rows.length > 50000) {
      console.warn(`/api/ads: large response (${rows.length} rows) — consider pagination`);
    }
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
    // Raw message logged server-side for ops; sanitized message returned to client.
    console.error('ads fetch failed:', message);
    // Degrade gracefully — empty array lets the AdsDrawer show an "no data"
    // state instead of crashing the campaigns surface.
    return NextResponse.json({ rows: [], error: userFacingError(message) }, { status: 200 });
  }
}
