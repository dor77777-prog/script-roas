// Vercel Cron scheduler route: YESTERDAY refresh fan-out (Inngest → Vercel Cron
// + QStash migration, Stage 2 Task 2.3). Replaces the Inngest
// `cron-yesterday-refresh-scheduler` (every-2h staggered) function.
//
// Flow: verify the Vercel Cron secret → load the active store list →
// publishJob('/api/worker/yesterday-store', { storeId }) once per store. QStash
// then delivers each as an independent HTTP POST to the worker route (own
// timeout + retry); the worker derives yesterday's IL date and re-runs the
// unchanged runDailyForStore handler.
//
// NO IL-time gate: the every-2h cadence (0 */2 * * * UTC) is DST-agnostic — it
// reconciles yesterday's data ~12×/day regardless of the UTC↔IL offset, so there
// is no dual-fire to gate out. (The old Inngest scheduler staggered the 3 stores
// by 5-min `step.sleep`s to avoid hammering Meta's shared rate limit; with
// per-store QStash jobs each store is an independent invocation and QStash's
// own delivery pacing replaces that stagger — re-running is harmless anyway, the
// handler's writers are ON CONFLICT idempotent.)
//
// Auth: self-validating via CRON_SECRET (verifyCronRequest); covered by
// isDashboardAuthAllowlisted's `/api/cron/*` rule.
//
// Vercel Cron sends GET by default; we also accept POST for manual/ops triggers.

import { NextResponse } from 'next/server';
import { verifyCronRequest } from '@/lib/jobs/verifyCron';
import { publishJob } from '@/lib/jobs/qstash';
import { loadActiveStoreIds } from '@/lib/getStores';

export const dynamic = 'force-dynamic';

async function handle(req: Request): Promise<Response> {
  if (!verifyCronRequest(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const stores = await loadActiveStoreIds();
  for (const storeId of stores) {
    await publishJob('/api/worker/yesterday-store', { storeId });
  }
  return NextResponse.json({ published: stores.length }, { status: 200 });
}

export async function GET(req: Request): Promise<Response> {
  return handle(req);
}

export async function POST(req: Request): Promise<Response> {
  return handle(req);
}
