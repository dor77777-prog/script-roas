import { NextResponse } from 'next/server';
import type { CampaignRow } from '@/lib/campaigns';
import {
  fetchCampaignsFromPostgres,
  fetchCampaignsDailyLastWriteAt,
} from '@/lib/postgresReaders';
import { cacheControl } from '@/lib/cacheConfig';
import { userFacingError } from '@/lib/apiErrors';
import { parseRangeParams, RangeParamError } from '@/lib/dateRange';
// Phase 05.7: removed `fetchCampaignsData` (Sheets path) + `readFrom`.

// No `force-dynamic` — it would override `revalidate` and the Cache-Control
// header, defeating ISR. (IN-06)
export const revalidate = 60; // matches CACHE_CONFIG.campaigns.revalidate; literal required by Next.js

export type CampaignsResponse = {
  rows: CampaignRow[];
  lastUpdated: string;
  /**
   * Phase 05.7.6 — ISO timestamp of the most-recent campaigns_daily row
   * write across the queried date range. Distinct from `lastUpdated`
   * (server fetch time). Used by the per-tab freshness chip.
   */
  dataLastWriteAt: string | null;
  /** Present only on the degraded-error path (rows: []). Consumers that
   *  surface "synced N min ago" should treat the response as data-less when
   *  this is set, even though rows + lastUpdated still satisfy the type. */
  error?: string;
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
    // Phase 05.7: Postgres-only — readFrom() branch removed.
    const [rows, dataLastWriteAt] = await Promise.all([
      fetchCampaignsFromPostgres({ range }),
      fetchCampaignsDailyLastWriteAt({ range }),
    ]);
    if (rows.length > 50000) {
      console.warn(`/api/campaigns: large response (${rows.length} rows) — consider pagination`);
    }
    const body: CampaignsResponse = {
      rows,
      lastUpdated: new Date().toISOString(),
      dataLastWriteAt,
    };
    return NextResponse.json(body, {
      headers: { 'Cache-Control': cacheControl('campaigns') },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Campaigns fetch failed:', message);
    return NextResponse.json(
      {
        rows: [],
        lastUpdated: new Date().toISOString(),
        dataLastWriteAt: null,
        error: userFacingError(message),
      } satisfies CampaignsResponse,
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
