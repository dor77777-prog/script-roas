import { NextResponse } from 'next/server';
import type { CatalogProduct } from '@/lib/productCatalog';
import { fetchProductCatalogFromPostgres } from '@/lib/postgresReaders';
import { cacheControl } from '@/lib/cacheConfig';
import { userFacingError } from '@/lib/apiErrors';
import { captureRouteError } from '@/lib/sentry/capture';

// 60 seconds — short enough that after a cronDaily catalog refresh, the
// user sees fresh data within a minute (instead of waiting out a 1-hour
// CDN cache). The catalog is small (≤1k rows across all stores) so the
// underlying Supabase read is cheap; no real cost to a tighter TTL.
export const revalidate = 60; // matches CACHE_CONFIG.productCatalog.revalidate; literal required by Next.js

export type ProductCatalogResponse = {
  rows: CatalogProduct[];
  lastUpdated: string;
};

export async function GET() {
  try {
    const rows = await fetchProductCatalogFromPostgres();
    if (rows.length > 50000) {
      console.warn(`/api/product-catalog: large response (${rows.length} rows) — consider pagination`);
    }
    return NextResponse.json(
      { rows, lastUpdated: new Date().toISOString() } satisfies ProductCatalogResponse,
      {
        headers: {
          // Match the route-level revalidate. 60s CDN cache + 5min stale
          // gives a snappy "refresh after cron run" experience while still
          // de-duping the routes between concurrent partners.
          'Cache-Control': cacheControl('productCatalog'),
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Raw message logged server-side for ops; sanitized message returned to client.
    captureRouteError('product-catalog', err);
    console.error('product-catalog fetch failed:', message);
    // Degrade gracefully — picker falls back to /api/products list when this
    // route returns empty.
    return NextResponse.json({ rows: [], error: userFacingError(message) }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  }
}
