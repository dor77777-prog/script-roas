import { NextResponse } from 'next/server';
import { fetchStoreMetaFromPostgres } from '@/lib/postgresReaders';
import { cacheControl } from '@/lib/cacheConfig';
import { userFacingError } from '@/lib/apiErrors';
import { captureRouteError } from '@/lib/sentry/capture';

// store-meta changes rarely (only when a store's Shopify plan changes), so
// a longer cache is fine. cronDaily refreshes the underlying `stores` table
// once per day. Plain ISR via `revalidate` — no `force-dynamic`, which would
// override the cache config and make every request hit Supabase.
export const revalidate = 3600; // matches CACHE_CONFIG.storeMeta.revalidate; literal required by Next.js

export async function GET() {
  try {
    const rawRows = await fetchStoreMetaFromPostgres();
    if (rawRows.length > 50000) {
      console.warn(`/api/store-meta: large response (${rawRows.length} rows) — consider pagination`);
    }
    // Phase A.5 — enrich each row with tiktokAdvertiserId from env var
    // (the value isn't persisted in the stores table). The drawer's
    // campaign↔store mapping needs this to build the localStorage key.
    const rows = rawRows.map((row) => ({
      ...row,
      tiktokAdvertiserId:
        process.env[`${row.storeId.toUpperCase()}_TIKTOK_ADVERTISER_ID`]?.trim() || null,
    }));
    return NextResponse.json(
      { rows, lastUpdated: new Date().toISOString() },
      {
        headers: {
          'Cache-Control': cacheControl('storeMeta'),
        },
      },
    );
  } catch (err) {
    captureRouteError('store-meta', err);
    const message = err instanceof Error ? err.message : String(err);
    console.error('store-meta fetch failed:', message);
    // Return empty rows on failure so the dashboard renders without the
    // auto-detect feature instead of breaking BillingSettings entirely.
    // Sanitize the error message before sending — raw Supabase errors can
    // leak schema/table internals into the client.
    return NextResponse.json({ rows: [], error: userFacingError(message) }, { status: 200 });
  }
}
