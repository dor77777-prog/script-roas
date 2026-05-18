import { NextResponse } from 'next/server';
import { fetchOrdersAttribution, type OrderAttributionRow } from '@/lib/ordersAttribution';
import { cacheControl } from '@/lib/cacheConfig';

// 5-minute cache. Attribution rows are written daily; refreshing more often
// doesn't help the analysis but does burn Sheets quota.
export const revalidate = 300; // matches CACHE_CONFIG.ordersAttribution.revalidate; literal required by Next.js

export type OrdersAttributionResponse = {
  rows: OrderAttributionRow[];
  lastUpdated: string;
  /** Present only on the degraded-error path (rows: []). Consumers that
   *  surface "synced N min ago" should treat the response as data-less when
   *  this is set, even though rows + lastUpdated still satisfy the type. */
  error?: string;
};

export async function GET() {
  try {
    const rows = await fetchOrdersAttribution();
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
    console.error('orders-attribution fetch failed:', message);
    // Degrade gracefully — empty array lets dashboards render without the
    // deterministic-confidence column instead of breaking. lastUpdated is
    // included so the response shape satisfies the declared type — a
    // consumer reading `data.lastUpdated` on the error path now gets a
    // valid ISO timestamp instead of `undefined` (which would crash
    // downstream Date()/formatDate).
    return NextResponse.json(
      {
        rows: [],
        lastUpdated: new Date().toISOString(),
        error: message,
      } satisfies OrdersAttributionResponse,
      { status: 200 },
    );
  }
}
