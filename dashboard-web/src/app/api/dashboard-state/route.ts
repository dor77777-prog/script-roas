import { NextResponse } from 'next/server';
import {
  fetchDashboardState,
  isAllowedStateKey,
  upsertDashboardStateKey,
} from '@/lib/sheets';
import { fetchDashboardStateFromPostgres } from '@/lib/postgresReaders';
import { readFrom } from '@/lib/featureFlags';
import { cacheControl } from '@/lib/cacheConfig';
import { userFacingError } from '@/lib/apiErrors';

// TODO (Phase 05.7): The POST handler below still writes to Sheets via
// upsertDashboardStateKey regardless of READ_FROM. The write-side branch was
// deliberately deferred to 05.7 per 05.6-19-PLAN <output> note: cut-over to
// Postgres writes requires the supabaseAdmin (service_role) wiring, which is
// out of scope for 05.6 (read-path-only feature flag). When 05.7 ships:
//   1. Add upsertDashboardStateKeyPostgres in postgresReaders.ts (currently
//      intentionally NOT exported per the module-level comment in
//      postgresReaders.ts:28-31).
//   2. Branch the POST handler below symmetrically to the GET handler.

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
    // D-E3 branch (READ side only; POST write-side branching deferred to 05.7).
    // Both branches return { kv, updatedAtByKey } with identical semantics.
    const data = readFrom() === 'postgres'
      ? await fetchDashboardStateFromPostgres()
      : await fetchDashboardState();
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
