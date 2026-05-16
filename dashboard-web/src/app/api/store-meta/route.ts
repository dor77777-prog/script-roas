import { NextResponse } from 'next/server';
import { fetchStoreMeta } from '@/lib/sheets';

// store-meta changes rarely (only when a store's Shopify plan changes), so
// a longer cache is fine. Apps Script refreshes the underlying tab daily.
export const revalidate = 3600;
export const dynamic = 'force-dynamic';

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
    return NextResponse.json(
      { rows, lastUpdated: new Date().toISOString() },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
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
