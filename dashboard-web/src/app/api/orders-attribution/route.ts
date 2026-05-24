import { NextResponse } from 'next/server';
import type { OrderAttributionRow } from '@/lib/ordersAttribution';
import { fetchOrdersAttributionFromPostgres } from '@/lib/postgresReaders';
import { cacheControl } from '@/lib/cacheConfig';
import { userFacingError } from '@/lib/apiErrors';
import { parseRangeParams, RangeParamError } from '@/lib/dateRange';
import { captureRouteError } from '@/lib/sentry/capture';

// 5-minute cache. Attribution rows are written daily; refreshing more often
// doesn't help the analysis but does burn Supabase request quota.
export const revalidate = 300; // matches CACHE_CONFIG.ordersAttribution.revalidate; literal required by Next.js

export type OrdersAttributionResponse = {
  rows: OrderAttributionRow[];
  lastUpdated: string;
  /** Present only on the degraded-error path (rows: []). Consumers that
   *  surface "synced N min ago" should treat the response as data-less when
   *  this is set, even though rows + lastUpdated still satisfy the type. */
  error?: string;
};

export async function GET(req: Request) {
  // RangeParamError (malformed ?from=&to=) → 400 with no-store.
  // All other errors (Supabase failures) → 200 + empty rows (degraded path).
  const searchParams = new URL(req.url).searchParams;
  let range;
  try {
    range = parseRangeParams(searchParams);
  } catch (e) {
    if (e instanceof RangeParamError) {
      return NextResponse.json({ error: e.message }, {
        status: 400,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    throw e;
  }

  // Default false — explicit opt-in via ?lineItems=true. Anything else
  // (missing param, 'false', '0', 'yes', etc.) → false to keep the
  // payload light. Only CampaignDrawer.productChannelBreakdown needs
  // lineItems today; all other callers benefit from the smaller body.
  // T-05-03-01: strict === 'true' comparison prevents accidental opt-in
  // via truthy-ish strings or prototype tricks.
  const includeLineItems = searchParams.get('lineItems') === 'true';

  try {
    const rows = await fetchOrdersAttributionFromPostgres({ range, includeLineItems });
    if (rows.length > 50000) {
      console.warn(`/api/orders-attribution: large response (${rows.length} rows) — consider pagination`);
    }
    return NextResponse.json(
      { rows, lastUpdated: new Date().toISOString() } satisfies OrdersAttributionResponse,
      {
        headers: {
          'Cache-Control': cacheControl('ordersAttribution'),
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Raw message logged server-side for ops; sanitized message returned to client.
    captureRouteError('orders-attribution', err);
    console.error('orders-attribution fetch failed:', message);
    // Degrade gracefully — empty array lets dashboards render without the
    // deterministic-confidence column instead of breaking. lastUpdated is
    // included so the response shape satisfies the declared type — a
    // consumer reading `data.lastUpdated` on the error path now gets a
    // valid ISO timestamp instead of `undefined` (which would crash
    // downstream Date()/formatDate).
    // Cache-Control: no-store — without it, the route-level `revalidate = 300`
    // would pin a transient upstream blip in the CDN for 5 minutes. WR-02.
    return NextResponse.json(
      {
        rows: [],
        lastUpdated: new Date().toISOString(),
        error: userFacingError(message),
      } satisfies OrdersAttributionResponse,
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
