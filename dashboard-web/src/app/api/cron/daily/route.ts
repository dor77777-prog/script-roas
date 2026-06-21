// Vercel Cron scheduler route: DAILY refresh fan-out (Inngest → Vercel Cron +
// QStash migration, Stage 2 Task 2.2). Replaces the Inngest
// `cron-daily-scheduler` (TZ=Asia/Jerusalem 5 0 * * *) function.
//
// Flow: verify the Vercel Cron secret → gate on Israel local hour 0 (00:05 IL)
// → load the active store list → publishJob('/api/worker/daily-store',
// { storeId }) once per store. QStash then delivers each as an independent HTTP
// POST to the worker route (own timeout + retry); the worker derives yesterday's
// IL date and runs the unchanged runDailyForStore handler.
//
// DST dual-fire: vercel.json schedules this at BOTH 21:05 UTC (00:05 IL summer)
// and 22:05 UTC (00:05 IL winter). The israelHour()===0 gate makes exactly one
// of the two fires per day fan out; the off-DST fire returns a cheap 200 no-op
// (`skipped:'off-hour'`) — no jobs published. Re-running is harmless anyway (the
// handler's writers are ON CONFLICT idempotent).
//
// Auth: self-validating via CRON_SECRET (verifyCronRequest); covered by
// isDashboardAuthAllowlisted's `/api/cron/*` rule.
//
// Vercel Cron sends GET by default; we also accept POST for manual/ops triggers.

import { NextResponse } from 'next/server';
import { verifyCronRequest } from '@/lib/jobs/verifyCron';
import { israelHour } from '@/lib/dateRange';
import { publishJob } from '@/lib/jobs/qstash';
import { loadActiveStoreIds } from '@/lib/getStores';

export const dynamic = 'force-dynamic';

const TARGET_IL_HOUR = 0; // 00:05 IL — gate on IL hour 0

async function handle(req: Request): Promise<Response> {
  if (!verifyCronRequest(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (israelHour() !== TARGET_IL_HOUR) {
    // Off-DST dual-fire — not the IL target hour. No-op (no jobs published).
    return NextResponse.json({ skipped: 'off-hour' }, { status: 200 });
  }
  const stores = await loadActiveStoreIds();
  for (const storeId of stores) {
    await publishJob('/api/worker/daily-store', { storeId });
  }
  return NextResponse.json({ published: stores.length }, { status: 200 });
}

export async function GET(req: Request): Promise<Response> {
  return handle(req);
}

export async function POST(req: Request): Promise<Response> {
  return handle(req);
}
