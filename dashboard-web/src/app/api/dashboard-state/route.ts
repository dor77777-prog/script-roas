import { NextResponse } from 'next/server';
import {
  fetchDashboardState,
  isAllowedStateKey,
  upsertDashboardStateKey,
} from '@/lib/sheets';
import { cacheControl } from '@/lib/cacheConfig';

export const revalidate = 10; // matches CACHE_CONFIG.dashboardState.revalidate; literal required by Next.js

// Route handler — dynamic by default (no static generation). We rely on the
// explicit Cache-Control header below for short CDN dedupe within the polling
// window. Removed `force-dynamic` because it conflicted with that header.

/**
 * Translate raw Google API errors into Hebrew messages safe to render in the
 * SyncIndicator popover. Raw messages embed the spreadsheet ID and service
 * account email, neither of which a partner UI user needs to see. The full
 * raw message is still logged server-side via console.error for ops.
 */
function userFacingError(message: string): string {
  if (/permission|forbidden|403/i.test(message)) {
    return 'הסנכרון נכשל: הרשאות אינן מספיקות. ודא ש-Service Account מוגדר כ-Editor על הגיליון.';
  }
  if (/not found|404|Unable to parse range/i.test(message)) {
    return 'הסנכרון נכשל: הגיליון או הטאב לא נמצאו. בדוק את SPREADSHEET_ID.';
  }
  if (/quota|429|rate ?limit/i.test(message)) {
    return 'הסנכרון נכשל: חרגנו ממכסת Google. נסה שוב בעוד דקה.';
  }
  if (/Missing GOOGLE_CLIENT_EMAIL|GOOGLE_PRIVATE_KEY|SPREADSHEET_ID/i.test(message)) {
    return 'הסנכרון נכשל: משתני סביבה של Google חסרים בשרת.';
  }
  if (/ENOTFOUND|ECONNREFUSED|fetch failed|network/i.test(message)) {
    return 'הסנכרון נכשל: שגיאת רשת. בדוק את החיבור לאינטרנט.';
  }
  return 'הסנכרון נכשל: שגיאה לא צפויה. בדוק את הלוגים בצד השרת.';
}

export async function GET() {
  try {
    const data = await fetchDashboardState();
    return NextResponse.json(
      { kv: data.kv, updatedAtByKey: data.updatedAtByKey, lastUpdated: new Date().toISOString() },
      {
        headers: {
          // Short s-maxage so concurrent partners pick up edits quickly. SWR
          // will dedupe in-browser; this just lets the CDN coalesce bursts.
          'Cache-Control': cacheControl('dashboardState'),
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Log the raw message server-side so ops can see spreadsheet ID, service
    // account email, etc. — but don't leak those to the client UI.
    console.error('dashboard-state GET failed:', message);
    return NextResponse.json({ kv: {}, error: userFacingError(message) }, { status: 200 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { key?: unknown; value?: unknown };
    // Validate `key` against an explicit allowlist of dashboard-state keys.
    // Two reasons:
    //   1. Defense in depth against prototype-pollution: a client (legitimate
    //      bug or adversarial) could POST key="__proto__" which, on the next
    //      fetchDashboardState, the previous `kv[key] = parsed` line would
    //      have set Object.prototype properties — affecting every object
    //      created in the Node.js process. fetchDashboardState now also uses
    //      Object.create(null), but rejecting at the boundary stops the bad
    //      row from ever entering the sheet.
    //   2. Type-system parity: the StateKey union in cloudSync.ts already
    //      enumerates the legitimate keys; the API should mirror that
    //      contract rather than accepting any string.
    if (!isAllowedStateKey(body.key)) {
      return NextResponse.json({ error: 'unknown key' }, { status: 400 });
    }
    await upsertDashboardStateKey(body.key, body.value ?? null);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('dashboard-state POST failed:', message);
    return NextResponse.json({ error: userFacingError(message) }, { status: 500 });
  }
}
