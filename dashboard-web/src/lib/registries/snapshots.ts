// dashboard-web/src/lib/registries/snapshots.ts
//
// Phase B — tick_id helper + cron_tick_snapshots row writer.
//
// tick_id is "YYYY-MM-DDTHH:MM" floored to the 10-min bucket. Critically,
// flooring uses `Math.floor(ms / TEN_MIN_MS) * TEN_MIN_MS` NOT
// `slice(0, 16)`. The latter gives a 1-minute bucket which would generate a
// DIFFERENT tick_id when Inngest retries a step 90 seconds later, defeating
// the event-id dedup the orchestrator depends on.

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import type { CronTickSnapshotInsert } from './types';

const TEN_MIN_MS = 10 * 60 * 1000;

export function tickIdForNow(epochMs: number = Date.now()): string {
  const floored = Math.floor(epochMs / TEN_MIN_MS) * TEN_MIN_MS;
  return new Date(floored).toISOString().slice(0, 16);
}

export async function insertCronTickSnapshot(row: CronTickSnapshotInsert): Promise<void> {
  try {
    const sb = getSupabaseAdmin();
    await sb.from('cron_tick_snapshots').upsert(row, { onConflict: 'tick_id' });
  } catch (e) {
    console.warn('[insertCronTickSnapshot] write failed:', e);
  }
}
