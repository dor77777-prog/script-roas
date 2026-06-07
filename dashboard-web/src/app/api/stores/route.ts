// dashboard-web/src/app/api/stores/route.ts
// Self-serve stores Phase 2 — the client store list (active stores, DB-backed
// with hardcoded fallback inside getStores). Cached like other config routes.
import { NextResponse } from 'next/server';
import { getStores } from '@/lib/getStores';
import { cacheControl } from '@/lib/cacheConfig';

export const runtime = 'nodejs';
export const revalidate = 60; // matches CACHE_CONFIG.stores.revalidate; literal required by Next.js

export async function GET(): Promise<NextResponse> {
  const stores = await getStores(); // never throws — internal fallback to the hardcoded 3
  return NextResponse.json({ stores }, { headers: { 'Cache-Control': cacheControl('stores') } });
}
