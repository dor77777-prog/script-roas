// dashboard-web/src/lib/operator/registriesReaders.ts
//
// Phase B — server-side readers used by /operator panels.

import type { SupabaseClient } from '@supabase/supabase-js';

export type StatusEventRow = {
  id: number;
  store_id: string;
  platform: string;
  entity_type: 'campaign' | 'adset' | 'ad';
  entity_id: string;
  occurred_at: string;
  from_status: string | null;
  to_status: string;
  change_kind: string;
};

export type CronTickSnapshotRow = {
  tick_id: string;
  started_at: string;
  finished_at: string | null;
  fan_out_count: number | null;
  events_completed_count: number | null;
  events_skipped_count: number | null;
  events_failed_count: number | null;
};

export async function fetchStatusEvents(admin: SupabaseClient): Promise<StatusEventRow[]> {
  const { data } = await admin
    .from('campaign_status_events')
    .select('id, store_id, platform, entity_type, entity_id, occurred_at, from_status, to_status, change_kind')
    .order('occurred_at', { ascending: false })
    .limit(50);
  return (data ?? []) as StatusEventRow[];
}

export async function fetchCronTickSnapshots(admin: SupabaseClient): Promise<CronTickSnapshotRow[]> {
  const { data } = await admin
    .from('cron_tick_snapshots')
    .select('tick_id, started_at, finished_at, fan_out_count, events_completed_count, events_skipped_count, events_failed_count')
    .order('tick_id', { ascending: false })
    .limit(144);
  return (data ?? []) as CronTickSnapshotRow[];
}
