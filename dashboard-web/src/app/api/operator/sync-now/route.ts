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
import { captureRouteError } from '@/lib/sentry/capture';
import { loadActiveStoreIds } from '@/lib/getStores';

export const dynamic = 'force-dynamic';

type Payload =
  | { scope: 'all' }
  | { scope: 'store'; storeId: string };

// Phase E1.5 (2026-05-30) — 3-day rolling window for "Refresh All".
// A manual click now refreshes today + yesterday + day-before so the
// operator catches cross-day Shopify refunds, late attribution, and
// per-platform spend that cron-daily wouldn't process until 00:05.
function rolling3DaysJerusalem(): string[] {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const now = new Date();
  const oneDayMs = 24 * 60 * 60 * 1000;
  return [0, 1, 2].map((d) => fmt.format(new Date(now.getTime() - d * oneDayMs)));
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Payload;

    // Phase 2 (self-serve stores): resolve the active store list from DB
    // (falls back to hardcoded 3 on DB error — zero regression guarantee).
    const activeStoreIds = await loadActiveStoreIds();
    const valid = new Set(activeStoreIds);

    let events: Array<{ name: 'event/sync-now'; data: { storeId: string; dates?: string[] } }>;
    if (body.scope === 'all') {
      // Phase E1.5 — pass a 3-day window so the eventSyncNow handler
      // loops runDailyForStore for [today, yesterday, day-before].
      const dates = rolling3DaysJerusalem();
      events = activeStoreIds.map((s) => ({
        name: 'event/sync-now',
        data: { storeId: s, dates },
      }));
    } else if (
      body.scope === 'store' &&
      typeof body.storeId === 'string' &&
      valid.has(body.storeId)
    ) {
      events = [{ name: 'event/sync-now', data: { storeId: body.storeId } }];
    } else {
      return NextResponse.json(
        {
          error:
            "Invalid payload: scope must be 'all' or 'store' with valid storeId",
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
    captureRouteError('operator/sync-now', err);
    console.error('/api/operator/sync-now POST failed:', message);
    return NextResponse.json(
      { error: userFacingError(message) },
      { status: 500 },
    );
  }
}
