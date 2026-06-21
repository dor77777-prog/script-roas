// dashboard-web/src/app/api/operator/sync-now/route.ts
//
// Phase 05.6 Plan 14 — operator "Sync now" trigger route.
//
// Inngest → Vercel Cron + QStash migration (Stage 3 Task 3.1): this route now
// publishes one QStash job per (store, date) to /api/worker/daily-store instead
// of firing `inngest.send('event/sync-now')`. QStash delivers each as an
// independent HTTP POST to the daily-store worker (own timeout + retry), which
// runs the SAME runDailyForStore handler the old eventSyncNow function looped
// over. The exact set of work is preserved:
//   - scope:'all'   → today + yesterday + day-before, per store (3-day window,
//                     the Phase E1.5 "Refresh All" semantics);
//   - scope:'store' → today only (the eventSyncNow single-store default).
// Returns 202 Accepted immediately; the operator console's JobsTable is where
// completion is observed.
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
// to cache here regardless — this route exists solely to enqueue jobs.
//
// === Why storeId allowlist ===
//
// Threat T-05.6-14-T3 (Tampering): a misbehaving client could POST
// `{scope: 'store', storeId: 'evil-payload'}` and reach the job queue with
// that string. publishJob itself accepts any JSON payload — the validation
// lives here. The downstream daily-store worker types `storeId` for TS but
// the network-boundary runtime validation is this route's job.

import { NextResponse } from 'next/server';
import { publishJob } from '@/lib/jobs/qstash';
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

    // Build the (store, date) job list. Each entry becomes one QStash job to the
    // daily-store worker, which runs runDailyForStore(storeId, date) — exactly
    // what the old eventSyncNow handler looped over per store.
    let jobs: Array<{ storeId: string; date: string }>;
    if (body.scope === 'all') {
      // Phase E1.5 — 3-day window so "Refresh All" catches cross-day refunds +
      // attribution shifts: [today, yesterday, day-before] per store.
      const dates = rolling3DaysJerusalem();
      jobs = activeStoreIds.flatMap((s) =>
        dates.map((date) => ({ storeId: s, date })),
      );
    } else if (
      body.scope === 'store' &&
      typeof body.storeId === 'string' &&
      valid.has(body.storeId)
    ) {
      // Single-store "Sync now" refreshes TODAY only (the eventSyncNow default).
      jobs = [{ storeId: body.storeId, date: rolling3DaysJerusalem()[0] }];
    } else {
      return NextResponse.json(
        {
          error:
            "Invalid payload: scope must be 'all' or 'store' with valid storeId",
        },
        { status: 400 },
      );
    }

    // Publish one QStash job per (store, date). QStash delivers each as an
    // independent HTTP POST to the daily-store worker (own timeout + retry).
    for (const job of jobs) {
      await publishJob('/api/worker/daily-store', job);
    }

    return NextResponse.json(
      { accepted: jobs.length, jobs },
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
