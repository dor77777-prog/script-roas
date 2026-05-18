import { NextResponse } from 'next/server';
import { fetchCampaignsData, type CampaignRow } from '@/lib/campaigns';
import { cacheControl } from '@/lib/cacheConfig';
import { userFacingError } from '@/lib/apiErrors';

export const revalidate = 60; // matches CACHE_CONFIG.campaigns.revalidate; literal required by Next.js
export const dynamic = 'force-dynamic';

export type CampaignsResponse = {
  rows: CampaignRow[];
  lastUpdated: string;
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
    return NextResponse.json({ error: userFacingError(message) }, { status: 500 });
  }
}
