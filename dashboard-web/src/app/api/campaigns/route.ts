import { NextResponse } from 'next/server';
import { fetchCampaignsData, type CampaignRow } from '@/lib/campaigns';

export const revalidate = 60;
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
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Campaigns fetch failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
