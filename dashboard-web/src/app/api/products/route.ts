import { NextResponse } from 'next/server';
import { fetchProductsData, type ProductRow } from '@/lib/products';
import { fetchProductsFromPostgres } from '@/lib/postgresReaders';
import { readFrom } from '@/lib/featureFlags';
import { cacheControl } from '@/lib/cacheConfig';
import { userFacingError } from '@/lib/apiErrors';
import { parseRangeParams, RangeParamError } from '@/lib/dateRange';

// No `force-dynamic` — it would override `revalidate` and the Cache-Control
// header, defeating ISR. (IN-06)
export const revalidate = 60; // matches CACHE_CONFIG.products.revalidate; literal required by Next.js

export type ProductsResponse = {
  rows: ProductRow[];
  lastUpdated: string;
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
    // D-E3 branch: postgres path dormant in 05.6; 05.7 flips READ_FROM=postgres.
    // Both branches return ProductRow[].
    const rows = readFrom() === 'postgres'
      ? await fetchProductsFromPostgres({ range })
      : await fetchProductsData({ range });
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
    // Cache-Control: no-store — see WR-02 comment in /api/data/route.ts.
    return NextResponse.json(
      {
        rows: [],
        lastUpdated: new Date().toISOString(),
        error: userFacingError(message),
      } satisfies ProductsResponse,
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
