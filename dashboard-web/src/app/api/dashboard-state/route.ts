import { NextResponse } from 'next/server';
import { isAllowedStateKey } from '@/lib/sheets';
import {
  fetchDashboardStateFromPostgres,
  upsertDashboardStateKeyPostgres,
} from '@/lib/postgresReaders';
import { cacheControl } from '@/lib/cacheConfig';
import { userFacingError } from '@/lib/apiErrors';

// Phase 05.7: cut-over to Postgres for BOTH read + write paths.
//
// Before 05.7 (05.6 branch flag):
//   - GET branched on `readFrom()` between fetchDashboardState (Sheets) and
//     fetchDashboardStateFromPostgres.
//   - POST always wrote to Sheets via upsertDashboardStateKey (write-side
//     branching was deferred per 05.6-19 plan).
//
// 05.7 changes both halves to Postgres-only. The Sheets functions
// (fetchDashboardState, upsertDashboardStateKey, the ALLOWED_STATE_KEYS
// allowlist) remain in sheets.ts because `isAllowedStateKey` is still the
// shared validator at the API boundary — moving it to a Sheets-independent
// module is a follow-up cleanup, not a blocker for the cut-over.

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
    // Phase 05.7: Postgres-only. The readFrom() flag was removed because all
    // 8 data routes (this one included) now read exclusively from Supabase.
    const data = await fetchDashboardStateFromPostgres();
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
    // Include lastUpdated + updatedAtByKey so the response shape matches the
    // success path. Without these, a consumer reading `data.lastUpdated`
    // (e.g. SyncIndicator's "synced N min ago") gets `undefined → Invalid Date`
    // and crashes. Mirrors the same fix /api/orders-attribution applied. (IN-08)
    return NextResponse.json(
      {
        kv: {},
        updatedAtByKey: {},
        lastUpdated: new Date().toISOString(),
        error: userFacingError(message),
      },
      { status: 200 },
    );
  }
}

/**
 * Max serialized size of a single dashboard-state value. ~64KB matches the
 * practical per-cell budget that the Sheets writer once had to honour; the
 * Postgres JSONB column has a much higher ceiling (~1 GB per row), but the
 * limit is also a sanity check against malformed clients posting megabytes
 * of state. Reject early. (WR-04)
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
    //      created in the Node.js process. fetchDashboardStateFromPostgres
    //      also uses Object.create(null), but rejecting at the boundary
    //      stops the bad row from ever entering the database.
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
    // Phase 05.7: write to Supabase dashboard_state instead of the
    // dashboard-state Sheets tab. The upsert is atomic on the PRIMARY KEY
    // so the CR2-01 same-key concurrent-append race the Sheets writer had
    // to defend against does not exist here.
    await upsertDashboardStateKeyPostgres(body.key, body.value ?? null);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('dashboard-state POST failed:', message);
    return NextResponse.json({ error: userFacingError(message) }, { status: 500 });
  }
}
