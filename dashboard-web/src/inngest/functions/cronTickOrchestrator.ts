// dashboard-web/src/inngest/functions/cronTickOrchestrator.ts
//
// Phase B — every 10 minutes, fan out Meta status discovery events
// based on data_freshness + meta_buc_usage.
//
// Pure orchestrator logic is extracted to `runTickOnce` so the test suite
// can exercise it with mocked dependencies instead of stubbing the whole
// Inngest runtime.

import { inngest } from '@/inngest/client';
import { getFreshness } from '@/lib/inngest/freshness';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { loadActiveStoreIds } from '@/lib/getStores';
import { buildEvents } from '@/lib/registries/priorityBuilder';
import { insertCronTickSnapshot, tickIdForNow } from '@/lib/registries/snapshots';
import type { StoreId } from '@/lib/registries/types';

type SendEventFn = (events: Array<{ name: string; id: string; data: unknown }>) => Promise<{ ids: string[] }>;
type UpsertSnapshotFn = (row: { tick_id: string; started_at: string; finished_at: string; fan_out_count: number }) => Promise<void>;
type MetaBucState = { pct: number; etaMinutes: number };

export async function runTickOnce(input: {
  nowMs: number;
  sendEvent: SendEventFn;
  upsertSnapshot: UpsertSnapshotFn;
  loadFreshness: typeof getFreshness;
  loadMetaBuc: () => Promise<Partial<Record<StoreId, MetaBucState>>>;
  // Self-serve stores (Phase 4a) — the active store list is enumerated from
  // the DB (loadActiveStoreIds) so a store added later flows into the fan-out
  // with no deploy. Injectable for tests; defaults to the live DB→hardcoded-3
  // loader so the unchanged callers keep their behavior.
  loadStores?: () => Promise<string[]>;
}): Promise<{ tickId: string; fanOutCount: number }> {
  const { nowMs, sendEvent, upsertSnapshot, loadFreshness, loadMetaBuc, loadStores = loadActiveStoreIds } = input;
  const tickId = tickIdForNow(nowMs);
  const startedAt = new Date(nowMs).toISOString();

  const [statusFreshness, metricsFreshness, metaBucStateByStore, stores] = await Promise.all([
    loadFreshness('campaign_status'),
    loadFreshness('campaign_metrics'),
    loadMetaBuc(),
    loadStores(),
  ]);
  const freshness = [...statusFreshness, ...metricsFreshness];
  const events = buildEvents({
    stores,
    freshness,
    metaBucStateByStore,
    googleBucStateByStore: {},   // Phase C MVP — workers self-throttle
    tiktokBucStateByStore: {},
    tickId,
    nowMs,
  });

  if (events.length > 0) {
    await sendEvent(events);
  }
  await upsertSnapshot({
    tick_id: tickId,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    fan_out_count: events.length,
  });

  return { tickId, fanOutCount: events.length };
}

export const cronTickOrchestrator = inngest.createFunction(
  {
    id: 'cron-tick-orchestrator',
    triggers: [{ cron: '*/10 * * * *' }],
  },
  async ({ step }) => {
    const nowMs = Date.now();
    const startedAt = new Date(nowMs).toISOString();

    // Compute fan-out events inside step.run — idempotent + retryable.
    const { tickId, events } = await step.run('compute-events', async () => {
      const tickIdInner = tickIdForNow(nowMs);
      const [statusFreshness, metricsFreshness, metaBucStateByStore, stores] = await Promise.all([
        getFreshness('campaign_status'),
        getFreshness('campaign_metrics'),
        loadMetaBucStateByStore(),
        loadActiveStoreIds(),
      ]);
      const freshness = [...statusFreshness, ...metricsFreshness];
      const eventsInner = buildEvents({
        stores,
        freshness,
        metaBucStateByStore,
        googleBucStateByStore: {},   // Phase C MVP — workers self-throttle
        tiktokBucStateByStore: {},
        tickId: tickIdInner,
        nowMs,
      });
      return { tickId: tickIdInner, events: eventsInner };
    });

    // step.sendEvent MUST be at the outer function level, NOT inside step.run.
    // Inngest rejects nested step calls — that was the source of the 60s
    // Vercel timeout the orchestrator hit in production on 2026-05-29 night.
    if (events.length > 0) {
      await step.sendEvent('fan-out', events.map(e => ({ name: e.name, id: e.id, data: e.data })));
    }

    // Snapshot is its own idempotent step.run.
    await step.run('snapshot', async () => {
      await insertCronTickSnapshot({
        tick_id: tickId,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        fan_out_count: events.length,
      });
    });
  },
);

async function loadMetaBucStateByStore(): Promise<Partial<Record<StoreId, { pct: number; etaMinutes: number }>>> {
  const sb = getSupabaseAdmin();
  const { data } = await sb
    .from('meta_buc_usage')
    .select('store_id, ads_insights_call_pct, ads_insights_cputime_pct, ads_insights_time_pct, ads_insights_eta_minutes, ads_management_call_pct, ads_management_cputime_pct, ads_management_time_pct, ads_management_eta_minutes');
  const out: Partial<Record<StoreId, { pct: number; etaMinutes: number }>> = {};
  for (const row of data ?? []) {
    const r = row as Record<string, number | string | undefined>;
    const pct = Math.max(
      Number(r.ads_insights_call_pct ?? 0),
      Number(r.ads_insights_cputime_pct ?? 0),
      Number(r.ads_insights_time_pct ?? 0),
      Number(r.ads_management_call_pct ?? 0),
      Number(r.ads_management_cputime_pct ?? 0),
      Number(r.ads_management_time_pct ?? 0),
    );
    const etaMinutes = Math.max(
      Number(r.ads_insights_eta_minutes ?? 0),
      Number(r.ads_management_eta_minutes ?? 0),
    );
    const sid = r.store_id as StoreId;
    const prior = out[sid];
    out[sid] = {
      pct: Math.max(prior?.pct ?? 0, pct),
      etaMinutes: Math.max(prior?.etaMinutes ?? 0, etaMinutes),
    };
  }
  return out;
}
