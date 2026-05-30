// dashboard-web/src/lib/registries/tiktokStatusSets.ts
//
// TikTok ad-group status sets used by Phase D's classifier.
//
// TIKTOK_ACTIVE_ENOUGH is re-exported from `@/lib/platformConfig`, which is
// the canonical single source of truth for "TikTok statuses we treat as ON"
// (see AUDIT U-01 2026-05-23 — both the writer cronLive and the readers
// already import from there). Re-exporting from here keeps Phase D
// consumers' import paths consistent without forking the set.
//
// TIKTOK_OFF_STATUSES is unique to this module — currently only the
// statusClassification.ts off-classifier consumes it.

export { TIKTOK_ACTIVE_ENOUGH } from '@/lib/platformConfig';

export const TIKTOK_OFF_STATUSES = new Set([
  'ADGROUP_STATUS_DISABLE',
  'ADGROUP_STATUS_TIMEDOUT',
  'ADGROUP_STATUS_FROZEN',
  'ADGROUP_STATUS_ARCHIVED',
  'ADGROUP_STATUS_DELETE',
  'ADGROUP_STATUS_CAMPAIGN_DISABLE',
  'ADGROUP_STATUS_ADVERTISER_AUDIT_DENY',
  'ADGROUP_STATUS_ADVERTISER_FROZEN',
  'ADGROUP_STATUS_ADVERTISER_BUDGET_EXCEED',
  'ADGROUP_STATUS_BALANCE_EXCEED',
  'ADGROUP_STATUS_AUDIT_DENY',
]);
