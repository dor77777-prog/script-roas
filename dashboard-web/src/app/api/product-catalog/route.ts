import { NextResponse } from 'next/server';
import { fetchProductCatalog, type CatalogProduct } from '@/lib/productCatalog';
import { fetchProductCatalogFromPostgres } from '@/lib/postgresReaders';
import { readFrom } from '@/lib/featureFlags';
import { cacheControl } from '@/lib/cacheConfig';
import { userFacingError } from '@/lib/apiErrors';

// 60 seconds — short enough that after running refreshAllProductCatalogs in
// Apps Script, the user sees fresh data within a minute (instead of waiting
// out a 1-hour CDN cache). The catalog is small (≤1k rows across all stores)
// so the underlying Sheets read is cheap; no real cost to a tighter TTL.
export const revalidate = 60; // matches CACHE_CONFIG.productCatalog.revalidate; literal required by Next.js

export type ProductCatalogResponse = {
  rows: CatalogProduct[];
  lastUpdated: string;
};

export async function GET() {
  try {
    // D-E3 branch: postgres path dormant in 05.6; 05.7 flips READ_FROM=postgres.
    // Both branches return CatalogProduct[].
    const rows = readFrom() === 'postgres'
      ? await fetchProductCatalogFromPostgres()
      : await fetchProductCatalog();
    if (rows.length > 50000) {
      console.warn(`/api/product-catalog: large response (${rows.length} rows) — consider pagination`);
    }
    return NextResponse.json(
      { rows, lastUpdated: new Date().toISOString() } satisfies ProductCatalogResponse,
      {
        headers: {
          // Match the route-level revalidate. 60s CDN cache + 5min stale
          // gives a snappy "refresh after Apps Script run" experience while
          // still de-duping the routes between concurrent partners.
          'Cache-Control': cacheControl('productCatalog'),
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Raw message logged server-side for ops; sanitized message returned to client.
    console.error('product-catalog fetch failed:', message);
    // Degrade gracefully — picker falls back to /api/products list when this
    // route returns empty.
    return NextResponse.json({ rows: [], error: userFacingError(message) }, { status: 200 });
  }
}
