// dashboard-web/src/lib/registries/priorityBuilder.ts
//
// Phase B — pure helper that the orchestrator uses to decide what to fan
// out each tick. Reads (snapshot of) data_freshness + meta_buc_usage,
// returns the Inngest event payloads.
//
// Skip layers (see spec §"Dynamic threshold strategy"):
//
// Layer 1 (hard gate):  eta_minutes > 0 OR pct >= 95 → skip immediately.
//                       Meta is explicitly throttling us (ETA) or we're
//                       one tick from 429 (95% safety net).
//
// Layer 2 (tiered cooldown):  cooldown derived from observed pct.
//                              < 30%  → 300s (5 min, aggressive)
//                              30-60% → 480s (8 min, standard)
//                              60-80% → 900s (15 min, conservative)
//                              >= 80% → Infinity (skip)
//
// Layer 3 (orchestrator):  emit only if (now - last_success_at) >= cooldown.
//
// Otherwise emit `meta/job.requested` with scope='status'. Phase C extends
// this builder with scope='hot_metrics'.

import type { FreshnessRow } from '@/lib/inngest/freshness';
import {
  META_JOB_REQUESTED,
  type WorkerScope,
} from './eventNames';
import type { JobRequestedEvent, StoreId } from './types';

const HARD_SKIP_PCT = 95;

export type MetaBucState = { pct: number; etaMinutes: number };

type InngestEventPayload = {
  name: typeof META_JOB_REQUESTED;
  id: string;
  data: JobRequestedEvent;
};

export function cooldownSecondsForPct(pct: number): number {
  if (pct >= 80) return Number.POSITIVE_INFINITY;
  if (pct >= 60) return 900;
  if (pct >= 30) return 480;
  return 300;
}

export function buildEvents(input: {
  stores: StoreId[];
  freshness: FreshnessRow[];
  metaBucStateByStore: Partial<Record<StoreId, MetaBucState>>;
  tickId: string;
  nowMs: number;
}): InngestEventPayload[] {
  const { stores, freshness, metaBucStateByStore, tickId, nowMs } = input;
  const events: InngestEventPayload[] = [];

  for (const storeId of stores) {
    const state = metaBucStateByStore[storeId] ?? { pct: 0, etaMinutes: 0 };

    // Layer 1 — hard gate
    if (state.etaMinutes > 0) continue;
    if (state.pct >= HARD_SKIP_PCT) continue;

    // Layer 2 — tiered cooldown
    const cooldownSeconds = cooldownSecondsForPct(state.pct);
    if (!Number.isFinite(cooldownSeconds)) continue;

    // Layer 3 — staleness vs cooldown
    const stalenessSeconds = freshnessSecondsFor(freshness, storeId, 'campaign_status', nowMs);
    if (stalenessSeconds < cooldownSeconds) continue;

    events.push(makeEvent(storeId, 'status', tickId, stalenessSeconds, state.pct));
  }

  return events;
}

function freshnessSecondsFor(
  rows: FreshnessRow[],
  storeId: StoreId,
  scope: string,
  nowMs: number,
): number {
  const row = rows.find(r => r.store_id === storeId && r.scope === scope);
  if (!row || !row.last_success_at) return Number.MAX_SAFE_INTEGER;
  return Math.floor((nowMs - new Date(row.last_success_at).getTime()) / 1000);
}

function makeEvent(
  storeId: StoreId,
  scope: WorkerScope,
  tickId: string,
  stalenessSeconds: number,
  bucPctEstimate: number,
): InngestEventPayload {
  return {
    name: META_JOB_REQUESTED,
    id: `meta:${storeId}:${scope}:${tickId}`,
    data: {
      store_id: storeId,
      scope,
      tick_id: tickId,
      staleness_seconds: stalenessSeconds,
      budget_pct_estimate: bucPctEstimate,
    },
  };
}
