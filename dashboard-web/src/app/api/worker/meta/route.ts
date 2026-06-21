// QStash worker route: per-store META platform refresh (Inngest → Vercel Cron +
// QStash migration, Stage 2 Task 2.4). Replaces the Inngest `meta-worker`
// (meta/job.requested) function.
//
// Flow: verify the QStash signature → parse { store_id, scope, ... } from the
// raw body → acquireJobLock('meta:'+store_id+':'+scope) (skip if another run
// holds it) → run the UNCHANGED wired handler runMetaWorkerForJob(data) →
// release the lock in `finally`.
//
// Payload shape: the cron-tick orchestrator emits META_JOB_REQUESTED events with
// data = JobRequestedEvent ({ store_id, scope, tick_id, staleness_seconds,
// budget_pct_estimate }). The same object is published to QStash and forwarded
// here verbatim — runMetaWorkerForJob reads store_id + scope and ignores the
// rest, exactly as the Inngest binding did.
//
// runMetaWorkerForJob = the wiring the Inngest binding built inside step.run,
// hoisted to a plain async fn (metaWorker.ts). QStash delivers each job as ONE
// independent HTTP invocation (own timeout + retry); there is no durable Inngest
// `step` runtime, so the runner does NOT wrap its work in step.run — the
// business logic (the pure `runMetaWorkerJob`) is byte-identical and every
// writer is ON CONFLICT idempotent, so QStash retrying the whole job is safe.
//
// Lock semantics: the lock only reduces wasted concurrent work; correctness does
// NOT depend on it. We RELEASE it after the run so the next orchestrator tick
// always re-acquires.
//
// maxDuration=300: a status + hot_metrics fetch + diff + upsert can take a
// while; raise to the Vercel Pro ceiling (matches the old Inngest worker budget).
//
// Auth: self-validating via the QStash signature (verifyQstashRequest); covered
// by isDashboardAuthAllowlisted's `/api/worker/*` rule.

import { NextResponse } from 'next/server';
import { verifyQstashRequest } from '@/lib/jobs/verifyQstash';
import { acquireJobLock, releaseJobLock } from '@/lib/jobs/lock';
import { runMetaWorkerForJob } from '@/inngest/functions/metaWorker';
import type { JobRequestedEvent } from '@/lib/registries/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: Request): Promise<Response> {
  const v = await verifyQstashRequest(req);
  if (!v.ok) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let data: JobRequestedEvent | undefined;
  try {
    const body = JSON.parse(v.raw) as Partial<JobRequestedEvent>;
    if (typeof body.store_id === 'string' && body.store_id) {
      data = body as JobRequestedEvent;
    }
  } catch {
    // fall through to the 400 below
  }
  if (!data) {
    return NextResponse.json({ error: 'missing store_id' }, { status: 400 });
  }

  const lockKey = `meta:${data.store_id}:${data.scope}`;
  if (!(await acquireJobLock(lockKey))) {
    return NextResponse.json({ skipped: 'locked', store_id: data.store_id, scope: data.scope }, { status: 200 });
  }

  try {
    await runMetaWorkerForJob(data);
    return NextResponse.json({ ok: true, store_id: data.store_id, scope: data.scope }, { status: 200 });
  } finally {
    await releaseJobLock(lockKey);
  }
}
