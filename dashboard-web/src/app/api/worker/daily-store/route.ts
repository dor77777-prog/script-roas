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
// in the event payload. We derive it in the worker so the published job stays a
// plain { storeId } and the handler's date input is byte-identical.
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
  try {
    const body = JSON.parse(v.raw) as { storeId?: unknown };
    if (typeof body.storeId === 'string' && body.storeId) storeId = body.storeId;
  } catch {
    // fall through to the 400 below
  }
  if (!storeId) {
    return NextResponse.json({ error: 'missing storeId' }, { status: 400 });
  }

  const lockKey = `daily:${storeId}`;
  if (!(await acquireJobLock(lockKey))) {
    return NextResponse.json({ skipped: 'locked', storeId }, { status: 200 });
  }

  try {
    const date = yesterdayJerusalem();
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
