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
 * ACTIVE worker-scope allowlist — the EXACT set of `data_freshness` scopes the
 * current platform workers (metaWorker / googleWorker / tiktokWorker) write,
 * and the ONLY scopes that count toward a worker-* job's verdict.
 *
 *   - status branch  → campaign_status, adset_status, ad_status
 *   - hot_metrics    → campaign_metrics, ad_metrics
 *
 * WHY an allowlist (the false-alarm fix): `data_freshness` is keyed by
 * (store, platform, scope, table) and is APPEND/UPSERT-only — a scope a worker
 * stops writing is never deleted, so a stale/errored ORPHAN row lingers under
 * the same platform forever. Concretely `kpi_daily` + `adset_metrics` are
 * written by CRON-DAILY (on `data_daily` / the adsets table), NOT by the
 * per-10-min worker; a dead `meta/kpi_daily` transient_error from cron-daily
 * was being lumped into worker-meta and dragging an otherwise-fresh+success
 * worker to "error". Filtering to the worker's OWN scopes makes the verdict
 * robust to legacy/orphaned/foreign-job scopes by construction (no tuning, no
 * threshold) — the freshest live scopes alone decide the verdict, and the
 * existing age-gate still surfaces a genuine all-scopes-stale outage as
 * `stale`. Any scope OUTSIDE this set is ignored for the worker verdict; if a
 * worker has NO live-scope rows at all, it degrades to the honest `unknown`
 * placeholder rather than borrowing another job's green light.
 */
const ACTIVE_WORKER_SCOPES = new Set<string>([
  'campaign_status',
  'adset_status',
  'ad_status',
  'campaign_metrics',
  'ad_metrics',
]);

// ---------------------------------------------------------------------------
// Heartbeat-derived schedule-cadence jobs (cron-live / cron-daily /
// cron-yesterday / whatsapp / oauth-canary)
// ---------------------------------------------------------------------------

/**
 * Map a 'system'-platform heartbeat scope (written by recordHeartbeat at the
 * successful end of each schedule-cadence cron) → its panel job id. These crons
 * have NO per-store/platform run-telemetry; the heartbeat is their ONLY signal,
 * so each scope maps 1:1 to a job. A job with no heartbeat yet still falls
 * through to the honest `unknown` roster placeholder below.
 */
const JOB_BY_HEARTBEAT_SCOPE: Record<string, JobId> = {
  cron_live: 'cron-live',
  cron_daily: 'cron-daily',
  cron_yesterday: 'cron-yesterday',
  whatsapp: 'whatsapp',
  oauth_canary: 'oauth-canary',
};

/**
 * Per-job heartbeat staleness SLA, in MINUTES — the age past which a
 * success-but-not-beating job is SYNTHETIC stale (the cron stopped firing). Set
 * from the REAL cadence in vercel.json, each loose enough to absorb a missed
 * cycle + clock/DST skew without false-alarming:
 *
 *   - cron-live      every ~10 min      → 30 min   (3× cadence; one missed tick)
 *   - cron-yesterday every 2 h          → 300 min  (5 h; ~2 missed cycles)
 *   - cron-daily     once/day (00:05 IL)→ 1500 min (25 h; one missed day + skew)
 *   - oauth-canary   once/day (00:00 IL)→ 1500 min (25 h; one missed day + skew)
 *   - whatsapp       3×/day             → 840 min  (14 h; clears the ~11.5 h
 *                                          eod→next-noon overnight gap)
 *
 * NOTE: cron-yesterday is the every-2h reconcile cron in vercel.json
 * (the "0 every-2h" UTC schedule). The observability brief grouped it loosely
 * under "~daily", but we age-gate on the REAL every-2h cadence so a genuinely
 * dead yesterday-cron surfaces within hours, not a full day.
 */
const HEARTBEAT_SLA_MINUTES: Partial<Record<JobId, number>> = {
  'cron-live': 30,
  'cron-yesterday': 300,
  'cron-daily': 1500,
  'oauth-canary': 1500,
  'whatsapp': 840,
};

/** Fallback SLA for any heartbeat job not in the map (defensive; ~10-min job). */
const DEFAULT_HEARTBEAT_SLA_MINUTES = 30;

/**
 * True when a heartbeat job's last_success_at is older than its per-job SLA (or
 * is null/unparseable — never-beat is never fresh). `now` injected for purity,
 * mirroring isAgeStale / isTickStale.
 */
function isHeartbeatStale(job: JobId, lastSuccessAt: string | null, now: number): boolean {
  if (lastSuccessAt == null) return true;
  const parsed = Date.parse(lastSuccessAt);
  if (Number.isNaN(parsed)) return true;
  const sla = HEARTBEAT_SLA_MINUTES[job] ?? DEFAULT_HEARTBEAT_SLA_MINUTES;
  return (now - parsed) / 60_000 > sla;
}

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

// NOTE on schedule-cadence jobs (cron-live / cron-daily / cron-yesterday /
// whatsapp / oauth-canary): these have no per-store/platform run-telemetry, but
// each now writes a lightweight 'system'-platform HEARTBEAT row at the
// successful end of its work (recordHeartbeat → data_freshness). The
// heartbeat-derivation below maps each heartbeat scope → its job with a per-job
// cadence SLA, so the panel lights it up success / stale / error + last-run. A
// job that has NEVER beat (no heartbeat row yet) still falls through to the
// honest `unknown` roster placeholder — the panel never fabricates a green
// light for a job it cannot observe.

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
  // Attempt time of the error row currently surfaced in lastError, so we can
  // keep the genuinely MOST-RECENT error rather than whichever errored row the
  // DB happened to return last (row-order-independent / deterministic).
  let lastErrorAttemptAt: string | null = null;

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
      // Surface the detail of the most recent error BY last_attempt_at (not
      // merely the last row iterated), so which error the operator sees is
      // deterministic and independent of the DB query's row ordering. A row
      // with a newer attempt (or the first error seen, when attempts are null)
      // wins.
      if (r.error_message || r.error_code) {
        const isNewer =
          lastError == null ||
          (r.last_attempt_at != null &&
            (lastErrorAttemptAt == null || r.last_attempt_at > lastErrorAttemptAt));
        if (isNewer) {
          lastError = { code: r.error_code, message: r.error_message };
          lastErrorAttemptAt = r.last_attempt_at ?? lastErrorAttemptAt;
        }
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
 * Staleness SLA for the cron-tick orchestrator, in MINUTES. The tick fires
 * every 10 min (vercel.json cron "every 10 minutes"); a latest tick older than
 * ~3x that cadence means the orchestrator job ITSELF has stopped firing — not a per-event
 * failure but a dead job. 30 min absorbs one missed cycle + clock skew before
 * we flag, mirroring the worker age-gate philosophy in rollupFreshness (a
 * success-but-aged row is SYNTHETIC stale, never a forever-green dead job).
 */
const TICK_SLA_MINUTES = 30;

/**
 * True when the latest tick's finished_at is older than the tick SLA (or is
 * null/unparseable — never-finished is never fresh). `now` injected for purity.
 */
function isTickStale(finishedAt: string | null, now: number): boolean {
  if (finishedAt == null) return true;
  const parsed = Date.parse(finishedAt);
  if (Number.isNaN(parsed)) return true;
  return (now - parsed) / 60_000 > TICK_SLA_MINUTES;
}

/**
 * Roll the latest cron_tick_snapshots row into the cron-tick verdict. The
 * orchestrator tick is its own job (the every-10-min fan-out planner) — its telemetry
 * is cron_tick_snapshots, NOT data_freshness. The latest tick's failed-event
 * count drives the `error` verdict; finished_at is the last "success" time.
 *
 * AGE-GATE (the case-3 fix for the tick row): a tick row carries
 * `events_failed_count` from when it RAN, but says NOTHING about whether the
 * orchestrator is STILL firing. If the every-10-min cron stops entirely, the
 * latest tick is just the last (clean) tick from hours ago and would stay
 * `success` = green forever — the exact dead-job-stays-green hole the worker
 * fix closes for data_freshness. So a clean-but-aged latest tick (finished_at
 * older than TICK_SLA_MINUTES) is treated as SYNTHETIC `stale`, not `success`.
 * A real failed-event count still wins as `error` (we surface failures, not
 * mute them) — error takes precedence over stale, same ordering as the worker
 * rollup.
 */
function rollupTick(ticks: CronTickSnapshotRow[], now: number): RunRow {
  // fetchCronTickSnapshots already orders tick_id DESC, so ticks[0] is newest.
  const latest = ticks[0];
  const status: RunStatus =
    (latest.events_failed_count ?? 0) > 0
      ? 'error'
      : isTickStale(latest.finished_at, now)
        ? 'stale'
        : 'success';
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

/**
 * Build a RunRow for a heartbeat-derived schedule-cadence job from its single
 * 'system'-platform heartbeat row. Verdict precedence mirrors rollupFreshness /
 * rollupTick: a real error wins (`error`, surfacing the message); otherwise a
 * success-but-aged-past-its-cadence heartbeat is SYNTHETIC `stale` (the cron
 * stopped firing); otherwise `success`. The error branch is age-INDEPENDENT —
 * a recorded failure is always surfaced, never muted by age.
 */
function heartbeatRunRow(job: JobId, row: FreshnessRow, now: number): RunRow {
  let status: RunStatus;
  let lastError: { code: string | null; message: string | null } | null = null;

  if (!HEALTHY_STATUSES.has(row.status)) {
    status = 'error';
    if (row.error_message || row.error_code) {
      lastError = { code: row.error_code, message: row.error_message };
    }
  } else if (isHeartbeatStale(job, row.last_success_at, now)) {
    status = 'stale';
  } else {
    status = 'success';
  }

  return {
    job,
    lastSuccessAt: row.last_success_at,
    lastAttemptAt: row.last_attempt_at,
    status,
    lastError,
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
    derived.set('cron-tick', rollupTick(ticks, now));
  }

  // Platform-keyed worker jobs: derive ONLY from the scopes the live worker
  // actually writes (ACTIVE_WORKER_SCOPES). Foreign/legacy/orphaned scopes
  // under the same platform — e.g. cron-daily's `kpi_daily` / `adset_metrics`,
  // or the shopify-platform `cohort_monthly` — are excluded so a dead orphan
  // row cannot drag a fresh+success worker to a false "error" (the false-alarm
  // this fixes). A worker with no live-scope rows falls through to the honest
  // `unknown` roster placeholder below — it never borrows another job's verdict.
  for (const [platform, job] of Object.entries(WORKER_BY_PLATFORM)) {
    const owned = freshness.filter(
      (r) => r.platform === platform && ACTIVE_WORKER_SCOPES.has(r.scope),
    );
    if (owned.length > 0) derived.set(job, freshnessRow(job, owned, now));
  }

  // cohort: cohort_monthly scope (platform shopify), with its 7-day SLA.
  const cohortRows = freshness.filter((r) => r.scope === 'cohort_monthly');
  if (cohortRows.length > 0) derived.set('cohort', freshnessRow('cohort', cohortRows, now));

  // Schedule-cadence crons: derive from their 'system'-platform HEARTBEAT row.
  // One row per scope (PK store '__system__'); if duplicates ever exist we pick
  // the newest by last_attempt_at so the verdict is row-order-independent.
  for (const [scope, job] of Object.entries(JOB_BY_HEARTBEAT_SCOPE)) {
    const beats = freshness.filter(
      (r) => r.platform === 'system' && r.scope === scope,
    );
    if (beats.length === 0) continue;
    const newest = beats.reduce((a, b) =>
      (b.last_attempt_at ?? '') > (a.last_attempt_at ?? '') ? b : a,
    );
    derived.set(job, heartbeatRunRow(job, newest, now));
  }

  // Emit the FULL roster in stable order. A job with no derived row falls back
  // to an unknown placeholder so the operator always sees every job (no silent
  // disappearance) — sourceless jobs are always unknown.
  return JOB_ORDER.map(
    (job) => derived.get(job) ?? unknownRow(job),
  );
}
