// QStash worker route: per-store TIKTOK platform refresh (Inngest → Vercel Cron
// + QStash migration, Stage 2 Task 2.4). Replaces the Inngest `tiktok-worker`
// (tiktok/job.requested) function.
//
// Flow / payload / lock / maxDuration / auth: identical rationale to the meta
// worker route (see /api/worker/meta/route.ts). The orchestrator emits
// TIKTOK_JOB_REQUESTED events with the same JobRequestedEvent payload; this
// route forwards it verbatim to the UNCHANGED wired handler
// runTikTokWorkerForJob(data).

import { NextResponse } from 'next/server';
import { verifyQstashRequest } from '@/lib/jobs/verifyQstash';
import { acquireJobLock, releaseJobLock } from '@/lib/jobs/lock';
import { runTikTokWorkerForJob } from '@/inngest/functions/tiktokWorker';
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

  const lockKey = `tiktok:${data.store_id}:${data.scope}`;
  if (!(await acquireJobLock(lockKey))) {
    return NextResponse.json({ skipped: 'locked', store_id: data.store_id, scope: data.scope }, { status: 200 });
  }

  try {
    await runTikTokWorkerForJob(data);
    return NextResponse.json({ ok: true, store_id: data.store_id, scope: data.scope }, { status: 200 });
  } finally {
    await releaseJobLock(lockKey);
  }
}
