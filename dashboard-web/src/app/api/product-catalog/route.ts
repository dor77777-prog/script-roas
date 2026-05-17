import { NextResponse } from 'next/server';
import { fetchProductCatalog, type CatalogProduct } from '@/lib/productCatalog';

// 60 seconds — short enough that after running refreshAllProductCatalogs in
// Apps Script, the user sees fresh data within a minute (instead of waiting
// out a 1-hour CDN cache). The catalog is small (≤1k rows across all stores)
// so the underlying Sheets read is cheap; no real cost to a tighter TTL.
export const revalidate = 60;

export type ProductCatalogResponse = {
  rows: CatalogProduct[];
  lastUpdated: string;
};

export async function GET() {
  try {
    const rows = await fetchProductCatalog();
    return NextResponse.json(
      { rows, lastUpdated: new Date().toISOString() } satisfies ProductCatalogResponse,
      {
        headers: {
          // Match the route-level revalidate. 60s CDN cache + 5min stale
          // gives a snappy "refresh after Apps Script run" experience while
          // still de-duping the routes between concurrent partners.
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('product-catalog fetch failed:', message);
    // Degrade gracefully — picker falls back to /api/products list when this
    // route returns empty.
    return NextResponse.json({ rows: [], error: message }, { status: 200 });
  }
}
