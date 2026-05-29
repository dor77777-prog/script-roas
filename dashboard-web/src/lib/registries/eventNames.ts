// dashboard-web/src/lib/registries/eventNames.ts
//
// Phase B — Inngest event name constants for the orchestrator → worker
// fan-out. Centralised here so renames stay local to one file and the
// orchestrator + worker can never drift on the event-name string.

export const META_JOB_REQUESTED = 'meta/job.requested' as const;
export const META_BUDGET_EXCEEDED = 'meta/budget.exceeded' as const;

// Phase C will add:
//   GOOGLE_JOB_REQUESTED  = 'google/job.requested'
//   TIKTOK_JOB_REQUESTED  = 'tiktok/job.requested'
// Phase D will add:
//   SHOPIFY_JOB_REQUESTED = 'shopify/job.requested'

/**
 * Scopes a worker can be asked to refresh. Phase B uses `'status'` only;
 * Phase C adds `'hot_metrics'`, Phase D adds `'kpi'` (cron-live KPI
 * decommission) and `'products_live'`.
 */
export type WorkerScope = 'status' | 'hot_metrics' | 'kpi' | 'products_live';
