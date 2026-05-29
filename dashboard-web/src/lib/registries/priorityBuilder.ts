// dashboard-web/src/lib/registries/priorityBuilder.ts
//
// Phase B → Phase C — pure helper that the orchestrator uses to decide
// what to fan out each tick. Reads (snapshot of) data_freshness +
// per-platform BUC usage, returns the Inngest event payloads.
//
// Skip layers (see spec §"Dynamic threshold strategy"):
//
// Layer 1 (hard gate):  eta_minutes > 0 OR pct >= 95 → skip immediately.
//                       Platform is explicitly throttling us (ETA) or we're
//                       one tick from 429 (95% safety net).
//
// Layer 2 (tiered cooldown):  cooldown derived from observed pct.
//   status scope:
//                              < 30%  → 300s (5 min, aggressive)
//                              30-60% → 480s (8 min, standard)
//                              60-80% → 900s (15 min, conservative)
//                              >= 80% → Infinity (skip)
//   hot_metrics scope (tighter — refreshed more aggressively when budget allows):
//                              < 30%  → 180s (3 min)
//                              30-60% → 300s (5 min)
//                              60-80% → 600s (10 min)
//                              >= 80% → Infinity (skip)
//
// Layer 3 (orchestrator):  emit only if (now - last_success_at) >= cooldown.
//
// Phase C — fan out for all 3 platforms (meta + google + tiktok) and both
// scopes (status + hot_metrics).

import type { FreshnessRow } from '@/lib/inngest/freshness';
import {
  META_JOB_REQUESTED,
  GOOGLE_JOB_REQUESTED,
  TIKTOK_JOB_REQUESTED,
} from './eventNames';
import type { JobRequestedEvent, StoreId } from './types';

const HARD_SKIP_PCT = 95;

export type MetaBucState = { pct: number; etaMinutes: number };

type Platform = 'meta' | 'google' | 'tiktok';
type EventName =
  | typeof META_JOB_REQUESTED
  | typeof GOOGLE_JOB_REQUESTED
  | typeof TIKTOK_JOB_REQUESTED;

type InngestEventPayload = {
  name: EventName;
  id: string;
  data: JobRequestedEvent;
};

const EVENT_NAME_BY_PLATFORM: Record<Platform, EventName> = {
  meta: META_JOB_REQUESTED,
  google: GOOGLE_JOB_REQUESTED,
  tiktok: TIKTOK_JOB_REQUESTED,
};

// Worker scopes (the value the worker reads off the event payload) →
// freshness scope (the row key in `data_freshness`). These differ because
// `data_freshness` predates the worker contract.
const FRESHNESS_SCOPE_BY_WORKER_SCOPE: Record<'status' | 'hot_metrics', string> = {
  status: 'campaign_status',
  hot_metrics: 'campaign_metrics',
};

export function cooldownSecondsForPct(pct: number): number {
  if (pct >= 80) return Number.POSITIVE_INFINITY;
  if (pct >= 60) return 900;
  if (pct >= 30) return 480;
  return 300;
}

// Hot-metrics tier — tighter than status cooldown.
export function cooldownSecondsForHotMetrics(pct: number): number {
  if (pct >= 80) return Number.POSITIVE_INFINITY;
  if (pct >= 60) return 600;
  if (pct >= 30) return 300;
  return 180;
}

export function buildEvents(input: {
  stores: StoreId[];
  freshness: FreshnessRow[];
  metaBucStateByStore: Partial<Record<StoreId, MetaBucState>>;
  googleBucStateByStore?: Partial<Record<StoreId, MetaBucState>>;
  tiktokBucStateByStore?: Partial<Record<StoreId, MetaBucState>>;
  tickId: string;
  nowMs: number;
}): InngestEventPayload[] {
  const events: InngestEventPayload[] = [];
  const bucByPlatform: Record<Platform, Partial<Record<StoreId, MetaBucState>>> = {
    meta: input.metaBucStateByStore,
    google: input.googleBucStateByStore ?? {},
    tiktok: input.tiktokBucStateByStore ?? {},
  };

  for (const storeId of input.stores) {
    for (const platform of ['meta', 'google', 'tiktok'] as Platform[]) {
      const state = bucByPlatform[platform][storeId] ?? { pct: 0, etaMinutes: 0 };

      // Layer 1 — hard gate
      if (state.etaMinutes > 0) continue;
      if (state.pct >= HARD_SKIP_PCT) continue;

      for (const scope of ['status', 'hot_metrics'] as const) {
        // Layer 2 — tiered cooldown
        const cooldown = scope === 'status'
          ? cooldownSecondsForPct(state.pct)
          : cooldownSecondsForHotMetrics(state.pct);
        if (!Number.isFinite(cooldown)) continue;

        // Layer 3 — staleness vs cooldown
        const stalenessScope = FRESHNESS_SCOPE_BY_WORKER_SCOPE[scope];
        const stalenessSec = freshnessSecondsFor(
          input.freshness,
          storeId,
          stalenessScope,
          input.nowMs,
          platform,
        );
        if (stalenessSec < cooldown) continue;

        events.push({
          name: EVENT_NAME_BY_PLATFORM[platform],
          id: `${platform}:${storeId}:${scope}:${input.tickId}`,
          data: {
            store_id: storeId,
            scope,
            tick_id: input.tickId,
            staleness_seconds: stalenessSec,
            budget_pct_estimate: state.pct,
          },
        });
      }
    }
  }
  return events;
}

// Platform-aware-when-specified, platform-agnostic when omitted. Preserves
// Phase B test behavior (freshness rows already carry a `platform` column
// but earlier tests pass rows without filtering by it).
function freshnessSecondsFor(
  rows: FreshnessRow[],
  storeId: StoreId,
  scope: string,
  nowMs: number,
  platform?: string,
): number {
  const row = rows.find(r =>
    r.store_id === storeId
    && r.scope === scope
    && (!platform || r.platform === platform),
  );
  if (!row || !row.last_success_at) return Number.MAX_SAFE_INTEGER;
  return Math.floor((nowMs - new Date(row.last_success_at).getTime()) / 1000);
}
