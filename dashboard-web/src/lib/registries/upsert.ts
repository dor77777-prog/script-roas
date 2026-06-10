// dashboard-web/src/lib/registries/upsert.ts
//
// Phase B — pure row-build helper + thin Supabase wrappers for batched
// upsert / insert. The Supabase wrappers are kept simple (one call per
// table) so they're easy to mock in worker unit tests.
//
// Conflict handling:
//   - registry tables: ON CONFLICT (PK) DO UPDATE — straightforward upsert.
//   - campaign_status_events: ON CONFLICT (dedupe_key) DO NOTHING — the
//     dedupe_key column is GENERATED ALWAYS AS (stored), so PostgREST
//     `insert` with no `onConflict` succeeds on the first insert and the
//     UNIQUE constraint quietly rejects duplicates. We use the
//     `defaultToNull: true` option to let PostgREST emit the omit-defaulted
//     columns shape, but the DO NOTHING is enforced by the UNIQUE
//     constraint, not by PostgREST options.

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AdsetRegistryRow,
  AdRegistryRow,
  CampaignRegistryRow,
  StatusEventInsert,
} from './types';

export function buildRegistryUpsertRow<T extends CampaignRegistryRow>(input: {
  prior: T | null;
  fresh: T;
  nowIso: string;
}): T {
  const { prior, fresh, nowIso } = input;

  const firstSeenAt = prior?.first_seen_at ?? nowIso;
  const lastSeenAt = nowIso;
  const lastStatusSuccessAt = nowIso;

  const configuredChanged = prior
    ? (prior.configured_status ?? null) !== (fresh.configured_status ?? null)
    : true;
  const effectiveChanged = prior
    ? (prior.effective_status ?? null) !== (fresh.effective_status ?? null)
    : true;
  const statusChangedAt =
    configuredChanged || effectiveChanged ? nowIso : (prior?.status_changed_at ?? null);

  return {
    ...fresh,
    first_seen_at: firstSeenAt,
    last_seen_at: lastSeenAt,
    last_status_success_at: lastStatusSuccessAt,
    status_changed_at: statusChangedAt,
    missed_seen_count: 0,
    is_removed: false,
  };
}

const PK_BY_TABLE: Record<string, string> = {
  campaign_registry: 'store_id,platform,campaign_id',
  adset_registry: 'store_id,platform,adset_id',
  ad_registry: 'store_id,platform,ad_id',
};

export async function upsertRegistryBatch<T extends CampaignRegistryRow | AdsetRegistryRow | AdRegistryRow>(input: {
  admin: SupabaseClient;
  table: 'campaign_registry' | 'adset_registry' | 'ad_registry';
  rows: T[];
}): Promise<void> {
  const { admin, table, rows } = input;
  if (rows.length === 0) return;
  const { error } = await admin.from(table).upsert(rows, { onConflict: PK_BY_TABLE[table] });
  if (error) throw new Error(`upsert ${table}: ${error.message}`);
}

export async function insertStatusEventsBatch(input: {
  admin: SupabaseClient;
  events: StatusEventInsert[];
}): Promise<void> {
  const { admin, events } = input;
  if (events.length === 0) return;
  // P1-32 (2026-06-10): true ON CONFLICT (dedupe_key) DO NOTHING via
  // PostgREST upsert + ignoreDuplicates. The previous plain `.insert()` that
  // treated error 23505 as benign was WRONG for multi-row batches: Postgres
  // aborts the ENTIRE multi-row INSERT on one unique violation, so a mixed
  // dup+new batch silently dropped the NEW transitions feeding the operator
  // panel and the campaign-died/fatigue detectors. With DO NOTHING, dupes are
  // skipped row-by-row and new rows land. (Same pattern as
  // lib/webhooks/store.ts:70.) dedupe_key is a GENERATED STORED column —
  // valid as a conflict target; it is never part of the payload.
  const { error } = await admin
    .from('campaign_status_events')
    .upsert(events, { onConflict: 'dedupe_key', ignoreDuplicates: true });
  if (error) {
    throw new Error(`insert campaign_status_events: ${error.message}`);
  }
}
