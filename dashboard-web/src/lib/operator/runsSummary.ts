// dashboard-web/src/lib/operator/runsSummary.ts
//
// Pure aggregator behind the /operator "ריצות אחרונות" (recent runs /
// pipeline health) panel — the QStash/DB-backed replacement for the removed
// Inngest JobsTable + /api/operator/jobs proxy (deleted in the Stage-4
// Inngest decommission).
//
// The old JobsTable read Inngest's per-run event log. Nothing runs on Inngest
// anymore (Vercel Cron + QStash), so there is no per-run log to proxy. Instead
// we roll the DB telemetry the new pipeline DOES write — `data_freshness`
// (per store×platform×scope last_success/last_error/status) and
// `cron_tick_snapshots` (per orchestrator tick fan-out) — into ONE summary row
// per logical job. This is a per-job last-run/health view, which is the gap the
// removed JobsTable left; the sibling StatusEventsFeed + CronTickSnapshotsViewer
// keep the per-entity / per-tick detail.
//
// Pure + deterministic (no I/O, no React, `now` injected) so it is fully unit
// testable in the node suite, mirroring lib/freshness/sourceStatus.ts.

import type { FreshnessRow } from '@/lib/inngest/freshness';
import { isAgeStale } from '@/lib/freshness/sourceStatus';
import type { CronTickSnapshotRow } from '@/lib/operator/registriesReaders';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Canonical job identifiers surfaced in the panel (one row each). */
export type JobId =
  | 'cron-live'
  | 'cron-daily'
  | 'cron-yesterday'
  | 'cron-tick'
  | 'worker-meta'
  | 'worker-google'
  | 'worker-tiktok'
  | 'whatsapp'
  | 'oauth-canary'
  | 'cohort';

/** Health verdict for a job row. */
export type RunStatus = 'success' | 'error' | 'stale' | 'unknown';

export type RunRow = {
  job: JobId;
  /** ISO timestamp of the most recent successful run, or null if never. */
  lastSuccessAt: string | null;
  /** ISO timestamp of the most recent attempt (success or failure), or null. */
  lastAttemptAt: string | null;
  /** Rolled-up health verdict. */
  status: RunStatus;
  /** Last error message+code (if the worst contributing source errored). */
  lastError: { code: string | null; message: string | null } | null;
  /** Source(s) this row was derived from — for the "how do we know" caption. */
  source: 'data_freshness' | 'cron_tick_snapshots' | 'none';
  /** Recent tick snapshots (cron-tick only) for the expandable detail. */
  ticks?: CronTickSnapshotRow[];
};

export type BuildRunsInput = {
  freshness: FreshnessRow[];
  ticks: CronTickSnapshotRow[];
  now: number;
};

// ---------------------------------------------------------------------------
// Platform-keyed worker jobs (worker-meta / worker-google / worker-tiktok)
// ---------------------------------------------------------------------------

const WORKER_BY_PLATFORM: Record<string, JobId> = {
  meta: 'worker-meta',
  google: 'worker-google',
  tiktok: 'worker-tiktok',
};

/**
 * Stable display order for the panel. ALL jobs are always rendered (even with
 * no telemetry) so the operator sees the full roster at a glance — a job that
 * silently vanishes is exactly the blind spot the panel exists to avoid.
 */
const JOB_ORDER: JobId[] = [
  'cron-live',
  'cron-daily',
  'cron-yesterday',
  'cron-tick',
  'worker-meta',
  'worker-google',
  'worker-tiktok',
  'cohort',
  'whatsapp',
  'oauth-canary',
];

// NOTE on sourceless jobs (cron-live / cron-daily / cron-yesterday / whatsapp /
// oauth-canary): these write NO separately-attributable DB run-telemetry, so
// the roster fallback below renders them with an `unknown` verdict + a known
// schedule caption in the UI. Honest by design — the panel never fabricates a
// green light for a job it cannot observe. (cron-live/daily/yesterday write the
// SAME platform scopes the workers do, so they are not distinguishable from the
// worker rows in data_freshness; whatsapp writes nothing; oauth-canary's signal
// is the dedicated TokenFailuresTable in the בריאות tab.)

/** Statuses that count as healthy in data_freshness (mirrors sourceStatus). */
const HEALTHY_STATUSES = new Set<string>(['success', 'budget_skip']);

/**
 * Collapse a set of data_freshness rows (all for ONE job) into a single
 * verdict. A row whose stored status is success/budget_skip but whose
 * last_success_at has aged past its scope SLA is treated as SYNTHETIC stale
 * (the worker stopped firing) — same age-gate the FreshnessPanel + health
 * rollup apply. Any real error row makes the whole job `error`.
 */
function rollupFreshness(rows: FreshnessRow[], now: number): {
  status: RunStatus;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: { code: string | null; message: string | null } | null;
} {
  let lastSuccessAt: string | null = null;
  let lastAttemptAt: string | null = null;
  let anyError = false;
  let anyStale = false;
  let lastError: { code: string | null; message: string | null } | null = null;

  for (const r of rows) {
    // Newest last_success_at across the job's scopes.
    if (r.last_success_at && (!lastSuccessAt || r.last_success_at > lastSuccessAt)) {
      lastSuccessAt = r.last_success_at;
    }
    if (r.last_attempt_at && (!lastAttemptAt || r.last_attempt_at > lastAttemptAt)) {
      lastAttemptAt = r.last_attempt_at;
    }

    if (!HEALTHY_STATUSES.has(r.status)) {
      anyError = true;
      // Keep the most recent error's detail.
      if (r.error_message || r.error_code) {
        lastError = { code: r.error_code, message: r.error_message };
      }
    } else if (isAgeStale(r.last_success_at, r.scope, now)) {
      anyStale = true;
    }
  }

  const status: RunStatus = anyError ? 'error' : anyStale ? 'stale' : 'success';

  return { status, lastSuccessAt, lastAttemptAt, lastError };
}

// ---------------------------------------------------------------------------
// buildRunsSummary
// ---------------------------------------------------------------------------

/** Number of recent ticks to attach to the cron-tick row for the detail. */
const RECENT_TICKS = 12;

/**
 * Roll the latest cron_tick_snapshots row into the cron-tick verdict. The
 * orchestrator tick is its own job (the every-10-min fan-out planner) — its telemetry
 * is cron_tick_snapshots, NOT data_freshness. The latest tick's failed-event
 * count drives the verdict; finished_at is the last "success" time.
 */
function rollupTick(ticks: CronTickSnapshotRow[]): RunRow {
  // fetchCronTickSnapshots already orders tick_id DESC, so ticks[0] is newest.
  const latest = ticks[0];
  const status: RunStatus = (latest.events_failed_count ?? 0) > 0 ? 'error' : 'success';
  return {
    job: 'cron-tick',
    lastSuccessAt: latest.finished_at,
    lastAttemptAt: latest.started_at,
    status,
    lastError: null,
    source: 'cron_tick_snapshots',
    ticks: ticks.slice(0, RECENT_TICKS),
  };
}

/** Build a data_freshness-derived RunRow for a job from its owned rows. */
function freshnessRow(job: JobId, owned: FreshnessRow[], now: number): RunRow {
  const v = rollupFreshness(owned, now);
  return {
    job,
    lastSuccessAt: v.lastSuccessAt,
    lastAttemptAt: v.lastAttemptAt,
    status: v.status,
    lastError: v.lastError,
    source: 'data_freshness',
  };
}

/** Placeholder row for a job with no dedicated DB run-telemetry source. */
function unknownRow(job: JobId): RunRow {
  return {
    job,
    lastSuccessAt: null,
    lastAttemptAt: null,
    status: 'unknown',
    lastError: null,
    source: 'none',
  };
}

export function buildRunsSummary(input: BuildRunsInput): RunRow[] {
  const { freshness, ticks, now } = input;
  const derived = new Map<JobId, RunRow>();

  // cron-tick orchestrator: derived from cron_tick_snapshots (its own source).
  if (ticks.length > 0) {
    derived.set('cron-tick', rollupTick(ticks));
  }

  // Platform-keyed worker jobs: derive from each platform's STATUS/METRIC
  // freshness rows. cohort_monthly is excluded — it is its own job, not part of
  // a platform worker's status/metric scope set.
  for (const [platform, job] of Object.entries(WORKER_BY_PLATFORM)) {
    const owned = freshness.filter(
      (r) => r.platform === platform && r.scope !== 'cohort_monthly',
    );
    if (owned.length > 0) derived.set(job, freshnessRow(job, owned, now));
  }

  // cohort: cohort_monthly scope (platform shopify), with its 7-day SLA.
  const cohortRows = freshness.filter((r) => r.scope === 'cohort_monthly');
  if (cohortRows.length > 0) derived.set('cohort', freshnessRow('cohort', cohortRows, now));

  // Emit the FULL roster in stable order. A job with no derived row falls back
  // to an unknown placeholder so the operator always sees every job (no silent
  // disappearance) — sourceless jobs are always unknown.
  return JOB_ORDER.map(
    (job) => derived.get(job) ?? unknownRow(job),
  );
}
