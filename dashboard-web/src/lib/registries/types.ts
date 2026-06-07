// dashboard-web/src/lib/registries/types.ts
//
// Phase B — TypeScript shapes for the 3 registries, status_events, and
// the orchestrator event payload. These mirror the columns in the
// 20260530230000_phase_b_registries.sql migration.

import type { WorkerScope } from './eventNames';

// widened for self-serve stores (Phase 2); runtime identity comes from getStores()
export type StoreId = string;
export type Platform = 'meta' | 'google' | 'tiktok' | 'shopify';
export type EntityType = 'campaign' | 'adset' | 'ad';
export type ChangeKind =
  | 'first_seen'
  | 'paused'
  | 'enabled'
  | 'archived'
  | 'removed'
  | 'effective_only'
  | 'delivery_only';

export type CampaignRegistryRow = {
  store_id: StoreId;
  platform: Platform;
  campaign_id: string;
  name: string | null;
  configured_status: string | null;
  effective_status: string | null;
  delivery_status: string | null;
  is_enabled: boolean | null;
  is_serving: boolean | null;
  first_seen_at: string;
  last_seen_at: string;
  platform_updated_at: string | null;
  status_changed_at: string | null;
  last_metrics_success_at: string | null;
  last_status_success_at: string | null;
  raw_status_payload: unknown;
  missed_seen_count: number;
  is_removed: boolean;
};

export type AdsetRegistryRow = CampaignRegistryRow & {
  adset_id: string;
  daily_budget_cad: number | null;
  lifetime_budget_cad: number | null;
};

export type AdRegistryRow = CampaignRegistryRow & {
  adset_id: string;
  ad_id: string;
};

export type StatusEventInsert = {
  store_id: StoreId;
  platform: Platform;
  entity_type: EntityType;
  entity_id: string;
  occurred_at: string;
  from_status: string | null;
  to_status: string;
  change_kind: ChangeKind;
  raw_event: unknown;
};

export type CronTickSnapshotInsert = {
  tick_id: string;
  started_at: string;
  finished_at?: string;
  fan_out_count?: number;
  events_completed_count?: number;
  events_skipped_count?: number;
  events_failed_count?: number;
};

/**
 * Payload of the `meta/job.requested` (and future `google/...`, `tiktok/...`)
 * Inngest events emitted by `cron-tick-orchestrator`. The worker reads these
 * fields to know which store + scope to refresh and to log the priority signals
 * the orchestrator used to decide the fan-out.
 *
 * Fields:
 *   - `staleness_seconds` — how long since the last successful refresh of this
 *     (store, scope) pair. Used for observability / debugging; the worker
 *     itself doesn't act on it.
 *   - `budget_pct_estimate` — last-known max BUC pct snapshot from
 *     `meta_buc_usage` at orchestrator emission time. The worker re-probes
 *     in case the value drifted in the seconds between orchestrator and
 *     consumer; this field is mainly for log/event auditing.
 */
export type JobRequestedEvent = {
  store_id: StoreId;
  scope: WorkerScope;
  tick_id: string;
  staleness_seconds: number;
  budget_pct_estimate: number;
};
