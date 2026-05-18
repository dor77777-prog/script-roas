import { NextResponse } from 'next/server';
import { fetchProductsData, type ProductRow } from '@/lib/products';
import { cacheControl } from '@/lib/cacheConfig';
import { userFacingError } from '@/lib/apiErrors';

export const revalidate = 60; // matches CACHE_CONFIG.products.revalidate; literal required by Next.js
export const dynamic = 'force-dynamic';

export type ProductsResponse = {
  rows: ProductRow[];
  lastUpdated: string;
  /** Present only on the degraded-error path (rows: []). Consumers that
   *  surface "synced N min ago" should treat the response as data-less when
   *  this is set, even though rows + lastUpdated still satisfy the type. */
  error?: string;
};

export async function GET() {
  try {
    const rows = await fetchProductsData();
    if (rows.length > 50000) {
      console.warn(`/api/products: large response (${rows.length} rows) — consider pagination`);
    }
    const body: ProductsResponse = {
      rows,
      lastUpdated: new Date().toISOString(),
    };
    return NextResponse.json(body, {
      headers: { 'Cache-Control': cacheControl('products') },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Raw message logged server-side for ops; sanitized message returned to client.
    console.error('Products fetch failed:', message);
    // Degrade gracefully with 200 + empty rows — matches /api/ads etc. (WR-06).
    return NextResponse.json(
      {
        rows: [],
        lastUpdated: new Date().toISOString(),
        error: userFacingError(message),
      } satisfies ProductsResponse,
      { status: 200 },
    );
  }
}
