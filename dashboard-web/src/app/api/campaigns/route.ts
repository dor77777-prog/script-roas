import { NextResponse } from 'next/server';
import { fetchCampaignsData, type CampaignRow } from '@/lib/campaigns';
import { cacheControl } from '@/lib/cacheConfig';
import { userFacingError } from '@/lib/apiErrors';

// No `force-dynamic` — it would override `revalidate` and the Cache-Control
// header, defeating ISR. (IN-06)
export const revalidate = 60; // matches CACHE_CONFIG.campaigns.revalidate; literal required by Next.js

export type CampaignsResponse = {
  rows: CampaignRow[];
  lastUpdated: string;
  /** Present only on the degraded-error path (rows: []). Consumers that
   *  surface "synced N min ago" should treat the response as data-less when
   *  this is set, even though rows + lastUpdated still satisfy the type. */
  error?: string;
};

export async function GET() {
  try {
    const rows = await fetchCampaignsData();
    if (rows.length > 50000) {
      console.warn(`/api/campaigns: large response (${rows.length} rows) — consider pagination`);
    }
    const body: CampaignsResponse = {
      rows,
      lastUpdated: new Date().toISOString(),
    };
    return NextResponse.json(body, {
      headers: { 'Cache-Control': cacheControl('campaigns') },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Raw message logged server-side for ops; sanitized message returned to client.
    console.error('Campaigns fetch failed:', message);
    // Degrade gracefully with 200 + empty rows — matches /api/ads etc. (WR-06).
    return NextResponse.json(
      {
        rows: [],
        lastUpdated: new Date().toISOString(),
        error: userFacingError(message),
      } satisfies CampaignsResponse,
      { status: 200 },
    );
  }
}
