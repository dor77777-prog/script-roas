// QStash worker route: per-store LIVE refresh (Inngest → Vercel Cron + QStash
// migration, Stage 2 Task 2.1). Replaces the Inngest `cron-live-worker`
// (cron/live.store.requested) function.
//
// Flow: verify the QStash signature → parse { storeId } from the raw body →
// acquireJobLock('live:'+storeId) (skip if another run holds it) → run the
// UNCHANGED handler runLiveForStore(storeId) with an inline step ctx → release
// the lock in `finally`.
//
// Inline step ctx: QStash delivers each job as ONE independent HTTP invocation
// (its own timeout + retry), so there is no durable Inngest `step` runtime here.
// We pass a trivial step runner that simply executes each labelled callback
// inline — the handler's business logic is byte-identical; only the durable-step
// memoization (which we don't need: QStash retries the whole job, and every
// writer is ON CONFLICT idempotent) is dropped.
//
// Lock semantics: the lock only reduces wasted concurrent work; correctness does
// NOT depend on it (idempotent writers + freshness self-heal). We RELEASE the
// lock after the run (unlike the WhatsApp dedup lock) so the next 10-min tick
// always re-acquires.
//
// maxDuration=300: large-day Shopify fetches can take minutes; raise to the
// Vercel Pro ceiling (matches the old Inngest worker's wall-clock budget).
//
// Auth: self-validating via the QStash signature (verifyQstashRequest); covered
// by isDashboardAuthAllowlisted's `/api/worker/*` rule (password gate skips it).

import { NextResponse } from 'next/server';
import { verifyQstashRequest } from '@/lib/jobs/verifyQstash';
import { acquireJobLock, releaseJobLock } from '@/lib/jobs/lock';
import { runLiveForStore } from '@/inngest/functions/cronLive';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Inline step runner — runs each labelled callback immediately. Mirrors the
// `StepRunner` subset runLiveForStore consumes ({ run<T>(label, fn) }).
const inlineStep = {
  run<T>(_label: string, fn: () => Promise<T>): Promise<T> {
    return fn();
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

  const lockKey = `live:${storeId}`;
  if (!(await acquireJobLock(lockKey))) {
    return NextResponse.json({ skipped: 'locked', storeId }, { status: 200 });
  }

  try {
    // Cast narrows the inline runner to the StepRunner subset runLiveForStore
    // consumes (its generic `run<T>` already matches structurally).
    const result = await runLiveForStore(
      storeId as Parameters<typeof runLiveForStore>[0],
      { step: inlineStep },
    );
    return NextResponse.json({ ok: true, storeId, result }, { status: 200 });
  } finally {
    await releaseJobLock(lockKey);
  }
}
