// Vercel Cron scheduler route: LIVE refresh fan-out (Inngest → Vercel Cron +
// QStash migration, Stage 2 Task 2.1). Replaces the Inngest
// `cron-live-scheduler` (TZ=Asia/Jerusalem */10 * * * *) function.
//
// Flow: verify the Vercel Cron secret → load the active store list →
// publishJob('/api/worker/live-store', { storeId }) once per store. QStash then
// delivers each as an independent HTTP POST to the worker route (own timeout +
// retry).
//
// NO IL-time gate: the */10 cadence is DST-agnostic (it fires every 10 minutes
// regardless of the UTC↔IL offset), so — unlike the daily/yesterday/whatsapp
// crons — there is no dual-fire to gate out. Live carries NO date (the handler's
// rolling 3-day window is internal).
//
// Auth: self-validating via CRON_SECRET (verifyCronRequest); covered by
// isDashboardAuthAllowlisted's `/api/cron/*` rule.
//
// Vercel Cron sends GET by default; we also accept POST for manual/ops triggers.

import { NextResponse } from 'next/server';
import { verifyCronRequest } from '@/lib/jobs/verifyCron';
import { publishJob } from '@/lib/jobs/qstash';
import { loadActiveStoreIds } from '@/lib/getStores';
import { recordHeartbeat } from '@/lib/jobs/heartbeat';

export const dynamic = 'force-dynamic';

async function handle(req: Request): Promise<Response> {
  if (!verifyCronRequest(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const stores = await loadActiveStoreIds();
    for (const storeId of stores) {
      await publishJob('/api/worker/live-store', { storeId });
    }
    // Best-effort observability heartbeat (RunsPanel). Never let it throw.
    await recordHeartbeat('cron_live', 'success').catch(() => {});
    return NextResponse.json({ published: stores.length }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await recordHeartbeat('cron_live', 'transient_error', msg).catch(() => {});
    return NextResponse.json({ error: 'cron-live failed' }, { status: 500 });
  }
}

export async function GET(req: Request): Promise<Response> {
  return handle(req);
}

export async function POST(req: Request): Promise<Response> {
  return handle(req);
}
