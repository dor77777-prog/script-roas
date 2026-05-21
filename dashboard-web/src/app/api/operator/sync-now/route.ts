// dashboard-web/src/app/api/operator/sync-now/route.ts
//
// Phase 05.6 Plan 14 — operator "Sync now" trigger route.
//
// Fires `event/sync-now` for one store (scope: 'store') or all three stores
// (scope: 'all') and returns 202 Accepted immediately. The Inngest worker
// (eventSyncNow.ts, plan 10) picks the event(s) up asynchronously; the
// operator console's JobsTable (plan 13) is where completion is observed.
//
// === Why async (return 202, don't await job completion) ===
//
// Per D-D4 / RESEARCH §Open Question 4: the operator's mental model is
// "click → toast → watch jobs table". Streaming progress would require
// SSE or a long-poll loop, which adds another moving part for a UI that
// only one user (D-D2) hits a few times per day. The 202 contract is the
// minimum-viable shape and matches the same pattern used by /api/operator
// /backfill (sibling route) for symmetry.
//
// === Why force-dynamic, no revalidate ===
//
// CRUD-style POST handler. Per RESEARCH §Pitfall 11 + the precedent set
// by /api/operator/manual-overrides/route.ts (lines 13-39), declaring both
// `force-dynamic` and `revalidate` is a silent conflict where the former
// wins; we pick the correct single declaration. There is no GET response
// to cache here regardless — this route exists solely to enqueue an
// Inngest event.
//
// === Why storeId allowlist ===
//
// Threat T-05.6-14-T3 (Tampering): a misbehaving client could POST
// `{scope: 'store', storeId: 'evil-payload'}` and reach the Inngest
// queue with that string. inngest.send itself accepts any JSON
// payload — the validation lives here. The downstream
// eventSyncNow handler (eventSyncNow.ts:62) types `storeId: StoreId`
// for TS but does NOT runtime-validate the network boundary; that's
// this route's job.
//
// === No INNGEST_EVENT_KEY arg ===
//
// inngest.client.ts (singleton) reads INNGEST_EVENT_KEY from process.env
// automatically. We never reference the env var name here — keeps the
// secret out of grep results and out of any potential bundle leak.

import { NextResponse } from 'next/server';
import { inngest } from '@/inngest/client';
import { userFacingError } from '@/lib/apiErrors';

export const dynamic = 'force-dynamic';

type Payload =
  | { scope: 'all' }
  | { scope: 'store'; storeId: 'uzoshop' | 'zolplus' | 'usmile360' };

// Source of truth for the storeId enum. Must match the eventSyncNow
// handler's StoreId union (cronDaily.ts) and the eventBackfill payload
// type. Keeping the literal here (rather than importing from cronDaily)
// avoids dragging the Inngest function module into the route's bundle.
const ALL_STORES = ['uzoshop', 'zolplus', 'usmile360'] as const;
const VALID_STORES = new Set<string>(ALL_STORES);

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Payload;

    let events: Array<{ name: 'event/sync-now'; data: { storeId: string } }>;
    if (body.scope === 'all') {
      events = ALL_STORES.map((s) => ({
        name: 'event/sync-now',
        data: { storeId: s },
      }));
    } else if (
      body.scope === 'store' &&
      typeof body.storeId === 'string' &&
      VALID_STORES.has(body.storeId)
    ) {
      events = [{ name: 'event/sync-now', data: { storeId: body.storeId } }];
    } else {
      return NextResponse.json(
        {
          error:
            "Invalid payload: scope must be 'all' or 'store' with valid storeId (uzoshop | zolplus | usmile360)",
        },
        { status: 400 },
      );
    }

    // inngest.send accepts a single event OR an array; returns
    // `{ ids: string[] }` where each id is the Inngest-assigned event
    // identifier. We surface those ids back so the client can — in a
    // future plan — correlate the 202 response to specific rows in the
    // JobsTable.
    const result = await inngest.send(events);

    return NextResponse.json(
      { accepted: result.ids.length, eventIds: result.ids },
      { status: 202 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Log raw error server-side (env-var names, internal hostnames, etc.)
    // but never leak it to the client. Threat T-05.6-14-I4 mitigation.
    console.error('/api/operator/sync-now POST failed:', message);
    return NextResponse.json(
      { error: userFacingError(message) },
      { status: 500 },
    );
  }
}
