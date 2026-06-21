// QStash worker route: per-store YESTERDAY refresh (Inngest → Vercel Cron +
// QStash migration, Stage 2 Task 2.3). Replaces the Inngest
// `cron-yesterday-refresh-worker` (cron/yesterday.store.requested) function.
//
// Why this exists (Phase E1.5): yesterday's per-platform spend + cross-day
// refunds keep mutating during the day (late attribution + refunds). This leg
// re-runs the SAME daily handler bound to yesterday on a denser ~2h cadence so a
// refund/attribution shift surfaces within ~2h instead of waiting for 00:05.
//
// Flow: verify the QStash signature → parse { storeId } from the raw body →
// acquireJobLock('yesterday:'+storeId) (skip if another run holds it) → run the
// UNCHANGED handler runDailyForStore(storeId, yesterdayJerusalem()) with an
// inline step ctx → release the lock in `finally`.
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

  const lockKey = `yesterday:${storeId}`;
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
