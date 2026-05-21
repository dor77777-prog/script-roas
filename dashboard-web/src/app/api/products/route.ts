import { NextResponse } from 'next/server';
import type { ProductRow } from '@/lib/products';
import {
  fetchProductsFromPostgres,
  fetchProductsDailyLastWriteAt,
} from '@/lib/postgresReaders';
import { cacheControl } from '@/lib/cacheConfig';
import { userFacingError } from '@/lib/apiErrors';
import { parseRangeParams, RangeParamError } from '@/lib/dateRange';
// Phase 05.7: removed `fetchProductsData` (Sheets path) + `readFrom`.
// `ProductRow` type kept as a re-export contract only.

// No `force-dynamic` — it would override `revalidate` and the Cache-Control
// header, defeating ISR. (IN-06)
export const revalidate = 60; // matches CACHE_CONFIG.products.revalidate; literal required by Next.js

export type ProductsResponse = {
  rows: ProductRow[];
  lastUpdated: string;
  /** Phase 05.7.6 — most-recent products_daily updated_at in the range. */
  dataLastWriteAt: string | null;
  /** Present only on the degraded-error path (rows: []). */
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
    const [rows, dataLastWriteAt] = await Promise.all([
      fetchProductsFromPostgres({ range }),
      fetchProductsDailyLastWriteAt({ range }),
    ]);
    if (rows.length > 50000) {
      console.warn(`/api/products: large response (${rows.length} rows) — consider pagination`);
    }
    const body: ProductsResponse = {
      rows,
      lastUpdated: new Date().toISOString(),
      dataLastWriteAt,
    };
    return NextResponse.json(body, {
      headers: { 'Cache-Control': cacheControl('products') },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Products fetch failed:', message);
    return NextResponse.json(
      {
        rows: [],
        lastUpdated: new Date().toISOString(),
        dataLastWriteAt: null,
        error: userFacingError(message),
      } satisfies ProductsResponse,
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
