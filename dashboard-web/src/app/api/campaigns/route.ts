import { NextResponse } from 'next/server';
import type { CampaignRow } from '@/lib/campaigns';
import {
  fetchCampaignsFromPostgres,
  fetchCampaignsDailyLastWriteAt,
  fetchCurrentCampaignStatuses,
  fetchLastKnownBudgetTypes,
  type CurrentEffectiveStatusEntry,
  type LastKnownBudgetTypeEntry,
} from '@/lib/postgresReaders';
import { cacheControl } from '@/lib/cacheConfig';
import { userFacingError } from '@/lib/apiErrors';
import { captureRouteError } from '@/lib/sentry/capture';
import { parseRangeParams, RangeParamError } from '@/lib/dateRange';

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
  /**
   * Phase 12.5.x (2026-05-24) — current platform-native status per
   * (store, platform, campaign, ad_set) key. Map key shape:
   *   `${storeId}::${Platform}::${campaignId}::${adSetId}`
   * "Current" = the row with the most-recent `updated_at` in
   * campaigns_daily across the last 60 days, REGARDLESS of the operator's
   * selected range. The aggregator uses this to override the stale
   * in-range status when a campaign was active in-range but is now off.
   * Each entry carries `updatedAt` so the aggregator can pick the freshest
   * status across a campaign's ad-sets (resume-detection robustness:
   * partial cron-live failure leaves one ad-set's status stale; latest
   * `updatedAt` wins). Empty object on the soft-fail path.
   */
  currentEffectiveStatus: Record<string, CurrentEffectiveStatusEntry>;
  /**
   * Bug fix (2026-06-04) — last-known CBO/ABO budget type per
   * (store, platform, campaign, ad_set) key. Map key shape:
   *   `${storeId}::${Platform}::${campaignId}::${adSetId}`
   * "Last-known" = the most-recent NON-EMPTY `budget_type` row in
   * campaigns_daily DB-wide (Meta-only), REGARDLESS of the operator's
   * selected range. `budget_type` is derived from Meta's 0/0 budgets for
   * paused / lifetime / budget-off campaigns, so TODAY's rows are often
   * empty; the aggregator uses this to backfill the CBO/ABO chip on
   * single-day / "today" views. Empty object on the soft-fail path.
   */
  lastKnownBudgetTypes: Record<string, LastKnownBudgetTypeEntry>;
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
    // Phase 12.5.x (2026-05-24) + Phase D (2026-05-30): fan out 3 parallel reads.
    // `fetchCurrentCampaignStatuses` is independent of `range` — it reads
    // campaign_registry (Phase D — was: 60-day campaigns_daily scan) and then
    // broadcasts each campaign's status to its ad_sets via a distinct-tuples
    // lookup on campaigns_daily — so it runs alongside the in-range reads
    // without blocking them.
    const [rows, dataLastWriteAt, currentEffectiveStatus, lastKnownBudgetTypes] = await Promise.all([
      fetchCampaignsFromPostgres({ range }),
      fetchCampaignsDailyLastWriteAt({ range }),
      fetchCurrentCampaignStatuses(),
      fetchLastKnownBudgetTypes(),
    ]);
    if (rows.length > 50000) {
      console.warn(`/api/campaigns: large response (${rows.length} rows) — consider pagination`);
    }
    const body: CampaignsResponse = {
      rows,
      lastUpdated: new Date().toISOString(),
      dataLastWriteAt,
      currentEffectiveStatus,
      lastKnownBudgetTypes,
    };
    return NextResponse.json(body, {
      headers: { 'Cache-Control': cacheControl('campaigns') },
    });
  } catch (err) {
    captureRouteError('campaigns', err);
    const message = err instanceof Error ? err.message : String(err);
    console.error('Campaigns fetch failed:', message);
    return NextResponse.json(
      {
        rows: [],
        lastUpdated: new Date().toISOString(),
        dataLastWriteAt: null,
        currentEffectiveStatus: {},
        lastKnownBudgetTypes: {},
        error: userFacingError(message),
      } satisfies CampaignsResponse,
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
