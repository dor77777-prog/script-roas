import { NextResponse } from 'next/server';
import { fetchCampaignsData, type CampaignRow } from '@/lib/campaigns';
import { cacheControl } from '@/lib/cacheConfig';

export const revalidate = 60; // matches CACHE_CONFIG.campaigns.revalidate; literal required by Next.js
export const dynamic = 'force-dynamic';

export type CampaignsResponse = {
  rows: CampaignRow[];
  lastUpdated: string;
};

export async function GET() {
  try {
    const rows = await fetchCampaignsData();
    const body: CampaignsResponse = {
      rows,
      lastUpdated: new Date().toISOString(),
    };
    return NextResponse.json(body, {
      headers: { 'Cache-Control': cacheControl('campaigns') },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Campaigns fetch failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
