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
import { buildEvents } from '@/lib/registries/priorityBuilder';
import { insertCronTickSnapshot, tickIdForNow } from '@/lib/registries/snapshots';
import type { StoreId } from '@/lib/registries/types';

const STORES: StoreId[] = ['uzoshop', 'zolplus', 'usmile360'];

type SendEventFn = (events: Array<{ name: string; id: string; data: unknown }>) => Promise<{ ids: string[] }>;
type UpsertSnapshotFn = (row: { tick_id: string; started_at: string; finished_at: string; fan_out_count: number }) => Promise<void>;
type MetaBucState = { pct: number; etaMinutes: number };

export async function runTickOnce(input: {
  nowMs: number;
  sendEvent: SendEventFn;
  upsertSnapshot: UpsertSnapshotFn;
  loadFreshness: typeof getFreshness;
  loadMetaBuc: () => Promise<Partial<Record<StoreId, MetaBucState>>>;
}): Promise<{ tickId: string; fanOutCount: number }> {
  const { nowMs, sendEvent, upsertSnapshot, loadFreshness, loadMetaBuc } = input;
  const tickId = tickIdForNow(nowMs);
  const startedAt = new Date(nowMs).toISOString();

  const [freshness, metaBucStateByStore] = await Promise.all([
    loadFreshness('campaign_status'),
    loadMetaBuc(),
  ]);
  const events = buildEvents({
    stores: STORES,
    freshness,
    metaBucStateByStore,
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
    await step.run('runTickOnce', async () => {
      return runTickOnce({
        nowMs: Date.now(),
        sendEvent: async (events) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (await (step as any).sendEvent('fan-out', events)) as { ids: string[] };
        },
        upsertSnapshot: insertCronTickSnapshot,
        loadFreshness: getFreshness,
        loadMetaBuc: loadMetaBucStateByStore,
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
