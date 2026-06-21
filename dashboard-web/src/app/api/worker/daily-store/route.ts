// QStash worker route: per-store DAILY refresh (Inngest → Vercel Cron + QStash
// migration, Stage 2 Task 2.2). Replaces the Inngest `cron-daily-worker`
// (cron/daily.store.requested) function.
//
// Flow: verify the QStash signature → parse { storeId } from the raw body →
// acquireJobLock('daily:'+storeId) (skip if another run holds it) → run the
// UNCHANGED handler runDailyForStore(storeId, yesterdayJerusalem()) with an
// inline step ctx → release the lock in `finally`.
//
// DATE: the daily job processes the day that just ended (yesterday in IL) — the
// same date the old Inngest scheduler computed (yesterdayJerusalem()) and passed
// in the event payload. We derive it in the worker when the body omits `date`,
// so the cron fan-out can keep publishing a plain { storeId }.
//
// OPTIONAL `date` (Stage 3 Task 3.1): the operator "Sync now" button needs to
// refresh a SPECIFIC date (today / yesterday / day-before for "Refresh All",
// today for a single store) — the same set the old eventSyncNow handler ran via
// its `dates` loop. So this worker honors an optional `date` in the body; when
// present (a valid YYYY-MM-DD) it processes that date, else it falls back to
// yesterdayJerusalem(). The cron-daily fan-out (which publishes only { storeId })
// is unchanged — it still gets yesterday.
//
// Inline step ctx / lock semantics / maxDuration / auth: identical rationale to
// the live-store worker (see /api/worker/live-store/route.ts).

import { NextResponse } from 'next/server';
import { verifyQstashRequest } from '@/lib/jobs/verifyQstash';
import { acquireJobLock, releaseJobLock } from '@/lib/jobs/lock';
import {
  runDailyForStore,
  yesterdayJerusalem,
  type RunDailyStep,
} from '@/inngest/functions/cronDaily';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Inline step runner — runs each labelled callback immediately. Mirrors the
// `RunDailyStep` shape runDailyForStore consumes ({ run(id, cb) }).
const inlineStep: RunDailyStep = {
  run(_id: string, callback: () => Promise<unknown>): Promise<unknown> {
    return callback();
  },
};

export async function POST(req: Request): Promise<Response> {
  const v = await verifyQstashRequest(req);
  if (!v.ok) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let storeId: string | undefined;
  let bodyDate: string | undefined;
  try {
    const body = JSON.parse(v.raw) as { storeId?: unknown; date?: unknown };
    if (typeof body.storeId === 'string' && body.storeId) storeId = body.storeId;
    // YYYY-MM-DD shape check — anything else falls back to yesterday below.
    if (typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      bodyDate = body.date;
    }
  } catch {
    // fall through to the 400 below
  }
  if (!storeId) {
    return NextResponse.json({ error: 'missing storeId' }, { status: 400 });
  }

  // Lock per store (NOT per date): the old eventSyncNow handler serialized its
  // [today, yesterday, day-before] loop within ONE per-store invocation (Inngest
  // concurrency:{key:storeId, limit:1}). A per-store lock preserves that
  // serialization — released in finally then re-acquired, so all dates still
  // complete — and keeps the cron-daily fan-out's lock key byte-identical.
  const lockKey = `daily:${storeId}`;
  if (!(await acquireJobLock(lockKey))) {
    return NextResponse.json({ skipped: 'locked', storeId }, { status: 200 });
  }

  const date = bodyDate ?? yesterdayJerusalem();
  try {
    const result = await runDailyForStore(
      storeId as Parameters<typeof runDailyForStore>[0],
      date,
      { step: inlineStep },
    );
    return NextResponse.json({ ok: true, storeId, date, result }, { status: 200 });
  } finally {
    await releaseJobLock(lockKey);
  }
}
