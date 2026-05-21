import { NextResponse } from 'next/server';
import { fetchStoreMeta } from '@/lib/sheets';
import { fetchStoreMetaFromPostgres } from '@/lib/postgresReaders';
import { readFrom } from '@/lib/featureFlags';
import { cacheControl } from '@/lib/cacheConfig';
import { userFacingError } from '@/lib/apiErrors';

// store-meta changes rarely (only when a store's Shopify plan changes), so
// a longer cache is fine. Apps Script refreshes the underlying tab daily.
// Plain ISR via `revalidate` — no `force-dynamic`, which would override the
// cache config and make every request hit Sheets.
export const revalidate = 3600; // matches CACHE_CONFIG.storeMeta.revalidate; literal required by Next.js

export async function GET() {
  try {
    // D-E3 branch: postgres path dormant in 05.6; 05.7 flips READ_FROM=postgres.
    // Both branches return StoreMetaRow[].
    const rows = readFrom() === 'postgres'
      ? await fetchStoreMetaFromPostgres()
      : await fetchStoreMeta();
    if (rows.length > 50000) {
      console.warn(`/api/store-meta: large response (${rows.length} rows) — consider pagination`);
    }
    return NextResponse.json(
      { rows, lastUpdated: new Date().toISOString() },
      {
        headers: {
          'Cache-Control': cacheControl('storeMeta'),
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('store-meta fetch failed:', message);
    // Return empty rows on failure so the dashboard renders without the
    // auto-detect feature instead of breaking BillingSettings entirely.
    // Sanitize the error message before sending — raw Google API messages
    // leak the spreadsheet ID and service account email into the client.
    return NextResponse.json({ rows: [], error: userFacingError(message) }, { status: 200 });
  }
}
