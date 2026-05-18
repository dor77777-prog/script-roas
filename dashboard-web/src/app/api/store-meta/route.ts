import { NextResponse } from 'next/server';
import { fetchStoreMeta } from '@/lib/sheets';
import { cacheControl } from '@/lib/cacheConfig';

// store-meta changes rarely (only when a store's Shopify plan changes), so
// a longer cache is fine. Apps Script refreshes the underlying tab daily.
// Plain ISR via `revalidate` — no `force-dynamic`, which would override the
// cache config and make every request hit Sheets.
export const revalidate = 3600; // matches CACHE_CONFIG.storeMeta.revalidate; literal required by Next.js

function userFacingError(message: string): string {
  if (/permission|forbidden|403/i.test(message)) {
    return 'טעינת store-meta נכשלה: הרשאות אינן מספיקות.';
  }
  if (/not found|404/i.test(message)) {
    return 'טעינת store-meta נכשלה: הגיליון לא נמצא.';
  }
  if (/quota|429/i.test(message)) {
    return 'טעינת store-meta נכשלה: חרגנו ממכסת Google.';
  }
  return 'טעינת store-meta נכשלה: שגיאה לא צפויה.';
}

export async function GET() {
  try {
    const rows = await fetchStoreMeta();
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
