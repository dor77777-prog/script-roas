import { NextResponse } from 'next/server';
import { fetchProductCatalog, type CatalogProduct } from '@/lib/productCatalog';

// Catalog changes rarely (a new product launch a few times a month at most),
// so a 1-hour ISR cache is plenty.
export const revalidate = 3600;

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
          'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
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
