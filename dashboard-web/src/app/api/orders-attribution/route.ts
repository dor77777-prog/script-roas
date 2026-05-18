import { NextResponse } from 'next/server';
import { fetchOrdersAttribution, type OrderAttributionRow } from '@/lib/ordersAttribution';

// 5-minute cache. Attribution rows are written daily; refreshing more often
// doesn't help the analysis but does burn Sheets quota.
export const revalidate = 300;

export type OrdersAttributionResponse = {
  rows: OrderAttributionRow[];
  lastUpdated: string;
};

export async function GET() {
  try {
    const rows = await fetchOrdersAttribution();
    return NextResponse.json(
      { rows, lastUpdated: new Date().toISOString() } satisfies OrdersAttributionResponse,
      {
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=900',
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('orders-attribution fetch failed:', message);
    // Degrade gracefully — empty array lets dashboards render without the
    // deterministic-confidence column instead of breaking.
    return NextResponse.json({ rows: [], error: message }, { status: 200 });
  }
}
