// Vercel Cron route: weekly cohort/LTV re-aggregate (Inngest → Vercel Cron
// migration, Stage 1 Task 1.3). Replaces the Inngest `cron-cohort-refresh`
// function.
//
// Flow: verify the Vercel Cron secret → gate on Israel-local Monday 04:00 →
// run the existing cohort refresh work inline (runCohortRefresh).
//
// DST dual-fire: vercel.json schedules this at BOTH 01:00 UTC (04:00 IL summer)
// and 02:00 UTC (04:00 IL winter), each only on Monday (`* * 1`). The
// israelWeekday()===Monday AND israelHour()===4 gate makes exactly one of the
// two fires per week do the work; the off-DST fire (which lands on IL hour 03
// or 05) returns a cheap 200 no-op.
//
// maxDuration: the Shopify Bulk poll can take minutes per store; the inline
// orchestrator sleeps for real (no durable step.sleep), so we raise the cap to
// the Vercel Pro ceiling.
//
// Auth: self-validating via CRON_SECRET (verifyCronRequest); covered by
// isDashboardAuthAllowlisted's `/api/cron/*` rule.

import { NextResponse } from 'next/server';
import { verifyCronRequest } from '@/lib/jobs/verifyCron';
import { israelHour, israelWeekday } from '@/lib/dateRange';
import { runCohortRefresh } from '@/inngest/functions/cronCohortRefresh';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const TARGET_IL_WEEKDAY = 1; // Monday (0=Sunday)
const TARGET_IL_HOUR = 4; // 04:00 IL

async function handle(req: Request): Promise<Response> {
  if (!verifyCronRequest(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (israelWeekday() !== TARGET_IL_WEEKDAY || israelHour() !== TARGET_IL_HOUR) {
    // Off-DST dual-fire / wrong day — not the IL target window. No-op.
    return NextResponse.json({ skipped: 'off-window' }, { status: 200 });
  }
  const result = await runCohortRefresh();
  return NextResponse.json({ ok: true, result }, { status: 200 });
}

export async function GET(req: Request): Promise<Response> {
  return handle(req);
}

export async function POST(req: Request): Promise<Response> {
  return handle(req);
}
