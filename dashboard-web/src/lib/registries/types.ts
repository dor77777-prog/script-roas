// dashboard-web/src/lib/registries/types.ts
//
// Phase B — TypeScript shapes for the 3 registries, status_events, and
// the orchestrator event payload. These mirror the columns in the
// 20260530230000_phase_b_registries.sql migration.

import type { WorkerScope } from './eventNames';

export type StoreId = 'uzoshop' | 'zolplus' | 'usmile360';
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

export type JobRequestedEvent = {
  store_id: StoreId;
  scope: WorkerScope;
  tick_id: string;
  staleness_seconds: number;
  budget_pct_estimate: number;
};
