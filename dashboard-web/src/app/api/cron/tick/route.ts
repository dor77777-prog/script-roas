// Vercel Cron scheduler route: PLATFORM-WORKER fan-out / tick orchestrator
// (Inngest → Vercel Cron + QStash migration, Stage 2 Task 2.4). Replaces the
// Inngest `cron-tick-orchestrator` (*/10 * * * *) function.
//
// Flow: verify the Vercel Cron secret → call the EXISTING orchestrator planner
// (runTickOnce, cronTickOrchestrator.ts) with the SAME real deps the Inngest
// binding wired (getFreshness / loadMetaBucStateByStore / insertCronTickSnapshot
// / loadActiveStoreIds), but inject a `sendEvent` that maps each planned event to
// a QStash publish: each META/GOOGLE/TIKTOK_JOB_REQUESTED event → publishJob(
// '/api/worker/'+platform, event.data). QStash then delivers each job as an
// independent HTTP POST to the platform worker route (own timeout + retry).
//
// We do NOT reimplement the planning logic — runTickOnce already builds the event
// list from freshness + BUC + the active store list (Layer-1/2/3 skip gates in
// priorityBuilder.buildEvents) and writes the cron_tick snapshot. The ONLY thing
// the route supplies differently from the Inngest binding is the transport
// (QStash publish vs step.sendEvent).
//
// NO IL-time gate: the */10 cadence is DST-agnostic (it fires every 10 minutes
// regardless of the UTC↔IL offset), so — like /api/cron/live — there is no
// dual-fire to gate out.
//
// Auth: self-validating via CRON_SECRET (verifyCronRequest); covered by
// isDashboardAuthAllowlisted's `/api/cron/*` rule.
//
// Vercel Cron sends GET by default; we also accept POST for manual/ops triggers.

import { NextResponse } from 'next/server';
import { verifyCronRequest } from '@/lib/jobs/verifyCron';
import { publishJob } from '@/lib/jobs/qstash';
import { getFreshness } from '@/lib/inngest/freshness';
import { loadActiveStoreIds } from '@/lib/getStores';
import { insertCronTickSnapshot } from '@/lib/registries/snapshots';
import {
  runTickOnce,
  loadMetaBucStateByStore,
} from '@/inngest/functions/cronTickOrchestrator';
import {
  META_JOB_REQUESTED,
  GOOGLE_JOB_REQUESTED,
  TIKTOK_JOB_REQUESTED,
} from '@/lib/registries/eventNames';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Map a planned event NAME (META/GOOGLE/TIKTOK_JOB_REQUESTED) to its QStash
// worker route path. Returns null for any unknown name so the sendEvent below
// can skip it instead of mis-routing (future scopes/platforms fail closed).
export function platformPathForEventName(name: string): string | null {
  switch (name) {
    case META_JOB_REQUESTED:
      return '/api/worker/meta';
    case GOOGLE_JOB_REQUESTED:
      return '/api/worker/google';
    case TIKTOK_JOB_REQUESTED:
      return '/api/worker/tiktok';
    default:
      return null;
  }
}

async function handle(req: Request): Promise<Response> {
  if (!verifyCronRequest(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { tickId, fanOutCount } = await runTickOnce({
    nowMs: Date.now(),
    // QStash-publishing sendEvent: one publish per planned event, routed by name.
    sendEvent: async (events) => {
      for (const e of events) {
        const path = platformPathForEventName(e.name);
        if (!path) continue;
        await publishJob(path, e.data);
      }
      return { ids: events.map((e) => e.id) };
    },
    upsertSnapshot: insertCronTickSnapshot,
    loadFreshness: getFreshness,
    loadMetaBuc: loadMetaBucStateByStore,
    loadStores: loadActiveStoreIds,
  });

  return NextResponse.json({ tickId, published: fanOutCount }, { status: 200 });
}

export async function GET(req: Request): Promise<Response> {
  return handle(req);
}

export async function POST(req: Request): Promise<Response> {
  return handle(req);
}
