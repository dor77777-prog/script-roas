import { NextResponse } from 'next/server';
import {
  fetchDashboardState,
  isAllowedStateKey,
  upsertDashboardStateKey,
} from '@/lib/sheets';
import { cacheControl } from '@/lib/cacheConfig';
import { userFacingError } from '@/lib/apiErrors';

export const revalidate = 30; // matches CACHE_CONFIG.dashboardState.revalidate; literal required by Next.js

// Route handler — dynamic by default (no static generation). We rely on the
// explicit Cache-Control header below for short CDN dedupe within the polling
// window. Removed `force-dynamic` because it conflicted with that header.
//
// Error sanitisation: uses the shared `userFacingError()` from `@/lib/apiErrors`.
// Previously this file had its own inline copy with sync-specific phrasing
// ("הסנכרון נכשל"). It has been unified with /api/store-meta (which also had
// an inline copy) onto the shared helper that returns generic "הטעינה נכשלה"
// messages. The SyncIndicator popover surfaces these as-is. Raw messages are
// still logged server-side via console.error for ops.

export async function GET() {
  try {
    // dashboard-state is bounded by ALLOWED_STATE_KEYS (8 keys) — no guard needed
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

/**
 * Max serialized size of a single dashboard-state value. ~64KB matches the
 * practical per-cell budget for a Google Sheets text cell write (the hard
 * cap is 50,000 chars per cell but accounting for JSON escape overhead we
 * keep the headroom at 64 KB of stringified bytes). A client posting a
 * larger payload would either fail the cell write (catch path leaks raw
 * Google error) or, worse, succeed but produce a row that pulls
 * fetchDashboardState into a slow read. Reject early. (WR-04)
 */
const VALUE_MAX_BYTES = 64_000;

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
    // Validate value size — see VALUE_MAX_BYTES above. JSON.stringify itself
    // throws on circular refs / BigInt; that lands in the catch below and
    // gets the sanitized "load failed" message instead of leaking internals.
    const serialized = JSON.stringify(body.value ?? null);
    if (serialized.length > VALUE_MAX_BYTES) {
      return NextResponse.json({ error: 'value too large' }, { status: 413 });
    }
    await upsertDashboardStateKey(body.key, body.value ?? null);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('dashboard-state POST failed:', message);
    return NextResponse.json({ error: userFacingError(message) }, { status: 500 });
  }
}
