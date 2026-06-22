// Vercel Cron route: daily OAuth token canary (Inngest → Vercel Cron
// migration, Stage 1 Task 1.2). Replaces the Inngest `cron-oauth-canary`
// function.
//
// Flow: verify the Vercel Cron secret → gate on Israel local hour 00 → run the
// existing canary work inline (runOauthCanary).
//
// DST dual-fire: vercel.json schedules this at BOTH 21:00 UTC (00:00 IL summer)
// and 22:00 UTC (00:00 IL winter). The israelHour() gate makes exactly one of
// the two fires per day do the work; the off-DST fire returns a cheap 200
// no-op (`skipped:'off-hour'`).
//
// Auth: self-validating via CRON_SECRET (verifyCronRequest), so the route is in
// isDashboardAuthAllowlisted's `/api/cron/*` rule (the password gate skips it).
//
// Vercel Cron sends GET by default; we also accept POST so manual/ops triggers
// and any future POST scheduling both work.

import { NextResponse } from 'next/server';
import { verifyCronRequest } from '@/lib/jobs/verifyCron';
import { israelHour } from '@/lib/dateRange';
import { runOauthCanary } from '@/inngest/functions/cronOauthCanary';
import { recordHeartbeat } from '@/lib/jobs/heartbeat';

export const dynamic = 'force-dynamic';

const TARGET_IL_HOUR = 0; // 00:00 IL

async function handle(req: Request): Promise<Response> {
  if (!verifyCronRequest(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (israelHour() !== TARGET_IL_HOUR) {
    // Off-DST dual-fire — not the IL target hour. No-op so we never double-run.
    // No heartbeat: this fire did NO real work; the IL-hour-0 fire owns it.
    return NextResponse.json({ skipped: 'off-hour' }, { status: 200 });
  }
  try {
    const result = await runOauthCanary();
    // A 'partial' result means a token check actually FAILED — surface it as a
    // transient_error heartbeat so the RunsPanel oauth-canary row goes red
    // (the dedicated TokenFailuresTable already alerts; this mirrors it for the
    // runs view). 'ok' = all checks passed → success heartbeat.
    if (result.status === 'ok') {
      await recordHeartbeat('oauth_canary', 'success').catch(() => {});
    } else {
      await recordHeartbeat(
        'oauth_canary',
        'transient_error',
        `canary failed: ${result.failed.join(', ')}`,
      ).catch(() => {});
    }
    return NextResponse.json({ ok: true, result }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await recordHeartbeat('oauth_canary', 'transient_error', msg).catch(() => {});
    return NextResponse.json({ error: 'oauth-canary failed' }, { status: 500 });
  }
}

export async function GET(req: Request): Promise<Response> {
  return handle(req);
}

export async function POST(req: Request): Promise<Response> {
  return handle(req);
}
