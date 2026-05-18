import { NextResponse } from 'next/server';
import { fetchProductsData, type ProductRow } from '@/lib/products';
import { cacheControl } from '@/lib/cacheConfig';

export const revalidate = 60; // matches CACHE_CONFIG.products.revalidate; literal required by Next.js
export const dynamic = 'force-dynamic';

export type ProductsResponse = {
  rows: ProductRow[];
  lastUpdated: string;
};

export async function GET() {
  try {
    const rows = await fetchProductsData();
    const body: ProductsResponse = {
      rows,
      lastUpdated: new Date().toISOString(),
    };
    return NextResponse.json(body, {
      headers: { 'Cache-Control': cacheControl('products') },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Products fetch failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
