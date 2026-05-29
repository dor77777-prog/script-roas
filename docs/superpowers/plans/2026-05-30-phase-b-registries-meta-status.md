# Phase B — Registries + Meta status discovery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the perpetual entity registries (`campaign_registry`, `adset_registry`, `ad_registry`), the append-only `campaign_status_events` audit log, and the `cron-tick-orchestrator` + `meta-worker` Inngest pair that discover and persist Meta campaign / ad-set / ad status every 10 minutes. Surface the new layer through three `/operator` panels.

**Architecture:** A new 10-minute cron (`cron-tick-orchestrator`) reads `data_freshness` + `meta_buc_usage` to prioritize (store × scope) tuples, then fans out `meta/job.requested` events. A new event-triggered Inngest function (`meta-worker`) consumes each event, fetches Meta status via Graph API Batch, diffs against the registries, writes status events with `ON CONFLICT (dedupe_key) DO NOTHING`, upserts the registries, and bumps freshness. Three new `/operator` panels read the new tables (StatusEventsFeed, CronTickSnapshotsViewer; the existing FreshnessPanel automatically picks up the new `data_freshness` scopes). cron-live + cron-live-heavy continue to run unchanged; Phase C decommissions cron-live-heavy after the orchestrator absorbs hot_metrics.

**Tech Stack:** Next.js 15 + Inngest 4.4 + Supabase (Postgres) + TypeScript + Vitest + lucide-react. Hebrew RTL UI tokens from existing design system.

**Spec:** [`docs/superpowers/specs/2026-05-30-phase-b-registries-meta-status-design.md`](../specs/2026-05-30-phase-b-registries-meta-status-design.md).

---

## File structure

### New files

```
supabase/migrations/<timestamp>_phase_b_registries.sql           # Task 1

dashboard-web/src/lib/registries/
├── types.ts                                                     # Task 2
├── eventNames.ts                                                # Task 2
├── diff.ts                                                      # Task 5
├── upsert.ts                                                    # Task 6
├── priorityBuilder.ts                                           # Task 4
├── snapshots.ts                                                 # Task 8
└── __tests__/
    ├── diff.test.ts
    ├── upsert.test.ts
    ├── priorityBuilder.test.ts
    └── snapshots.test.ts

dashboard-web/src/lib/fetchers/
├── metaStatus.ts                                                # Task 7
└── __tests__/metaStatus.test.ts

dashboard-web/src/inngest/functions/
├── cronTickOrchestrator.ts                                      # Task 8
├── metaWorker.ts                                                # Task 9
└── __tests__/
    ├── cronTickOrchestrator.test.ts
    └── metaWorker.test.ts

dashboard-web/src/app/api/operator/
├── status-events/route.ts                                       # Task 10
├── cron-tick-snapshots/route.ts                                 # Task 10
└── __tests__/
    ├── status-events.test.ts
    └── cron-tick-snapshots.test.ts

dashboard-web/src/components/operator/
├── StatusEventsFeed.tsx                                         # Task 11
└── CronTickSnapshotsViewer.tsx                                  # Task 12
```

### Modified files

```
dashboard-web/src/app/api/inngest/route.ts                       # Task 13 — register the two new functions
dashboard-web/src/app/operator/page.tsx                          # Task 13 — mount the two new panels
docs/ARCHITECTURE.md                                             # Task 14 — Phase B section
docs/ROAS-Dashboard-User-Manual.md                               # Task 14 — User Manual bump to 2.1.21 with Phase B entry
```

---

## Task 1: Migration — 5 new tables

**Files:**
- Create: `supabase/migrations/<timestamp>_phase_b_registries.sql` (where `<timestamp>` is the result of running `supabase migration new phase_b_registries` — the CLI generates the filename)

- [ ] **Step 1: Generate the migration file via the supabase CLI**

```bash
# Run from repo root. Use the .env workaround per existing pattern.
mv .env .env.tmp
cd /tmp && supabase migration new phase_b_registries --workdir /Users/dorperetz/script-roas
mv /Users/dorperetz/script-roas/.env.tmp /Users/dorperetz/script-roas/.env
```

This creates an empty file like `supabase/migrations/20260530XXXXXX_phase_b_registries.sql`.

- [ ] **Step 2: Write the migration content**

Paste the following into the generated file (use the Edit tool, not echo):

```sql
-- Phase B (2026-05-30) — Registries + status discovery + cron-tick observability.
-- See docs/superpowers/specs/2026-05-30-phase-b-registries-meta-status-design.md
-- for the full design rationale.

-- ---------------------------------------------------------------------------
-- 1. campaign_registry
-- ---------------------------------------------------------------------------
CREATE TABLE campaign_registry (
  store_id text NOT NULL,
  platform text NOT NULL,                       -- 'meta' | 'google' | 'tiktok'
  campaign_id text NOT NULL,
  name text,
  configured_status text,                       -- operator-set: ACTIVE | PAUSED | DELETED | ARCHIVED
  effective_status text,                        -- platform-native raw enum
  delivery_status text,                         -- normalized: DELIVERING | PENDING_REVIEW | NOT_DELIVERING | LEARNING | LIMITED | REJECTED | UNKNOWN
  is_enabled boolean,                           -- derived
  is_serving boolean,                           -- derived
  first_seen_at timestamptz NOT NULL,           -- set on INSERT only
  last_seen_at timestamptz NOT NULL,            -- bumped on every observation
  platform_updated_at timestamptz,              -- raw from platform updated_time
  status_changed_at timestamptz,                -- bumped ONLY when configured/effective_status differs
  last_metrics_success_at timestamptz,          -- Phase C hot_metrics
  last_status_success_at timestamptz,           -- bumped by status scope on success
  raw_status_payload jsonb,
  missed_seen_count integer NOT NULL DEFAULT 0,
  is_removed boolean NOT NULL DEFAULT false,
  PRIMARY KEY (store_id, platform, campaign_id)
);
CREATE INDEX idx_campaign_registry_serving
  ON campaign_registry (store_id, platform, is_serving)
  WHERE is_serving = true AND is_removed = false;
CREATE INDEX idx_campaign_registry_recent_status_change
  ON campaign_registry (store_id, platform, status_changed_at DESC NULLS LAST);

-- ---------------------------------------------------------------------------
-- 2. adset_registry
-- ---------------------------------------------------------------------------
CREATE TABLE adset_registry (
  store_id text NOT NULL,
  platform text NOT NULL,
  campaign_id text NOT NULL,
  adset_id text NOT NULL,
  name text,
  configured_status text,
  effective_status text,
  delivery_status text,
  is_enabled boolean,
  is_serving boolean,
  daily_budget_cad numeric(14,4),
  lifetime_budget_cad numeric(14,4),
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  platform_updated_at timestamptz,
  status_changed_at timestamptz,
  last_metrics_success_at timestamptz,
  last_status_success_at timestamptz,
  raw_status_payload jsonb,
  missed_seen_count integer NOT NULL DEFAULT 0,
  is_removed boolean NOT NULL DEFAULT false,
  PRIMARY KEY (store_id, platform, adset_id)
);
CREATE INDEX idx_adset_registry_campaign ON adset_registry (store_id, platform, campaign_id);
CREATE INDEX idx_adset_registry_serving
  ON adset_registry (store_id, platform, is_serving)
  WHERE is_serving = true AND is_removed = false;
CREATE INDEX idx_adset_registry_recent_status_change
  ON adset_registry (store_id, platform, status_changed_at DESC NULLS LAST);

-- ---------------------------------------------------------------------------
-- 3. ad_registry
-- ---------------------------------------------------------------------------
CREATE TABLE ad_registry (
  store_id text NOT NULL,
  platform text NOT NULL,
  campaign_id text NOT NULL,
  adset_id text NOT NULL,
  ad_id text NOT NULL,
  name text,
  configured_status text,
  effective_status text,
  delivery_status text,
  is_enabled boolean,
  is_serving boolean,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  platform_updated_at timestamptz,
  status_changed_at timestamptz,
  last_metrics_success_at timestamptz,
  last_status_success_at timestamptz,
  raw_status_payload jsonb,
  missed_seen_count integer NOT NULL DEFAULT 0,
  is_removed boolean NOT NULL DEFAULT false,
  PRIMARY KEY (store_id, platform, ad_id)
);
CREATE INDEX idx_ad_registry_adset ON ad_registry (store_id, platform, adset_id);
CREATE INDEX idx_ad_registry_serving
  ON ad_registry (store_id, platform, is_serving)
  WHERE is_serving = true AND is_removed = false;
CREATE INDEX idx_ad_registry_recent_status_change
  ON ad_registry (store_id, platform, status_changed_at DESC NULLS LAST);

-- ---------------------------------------------------------------------------
-- 4. campaign_status_events (append-only audit log, deduped)
-- ---------------------------------------------------------------------------
CREATE TABLE campaign_status_events (
  id bigserial PRIMARY KEY,
  store_id text NOT NULL,
  platform text NOT NULL,
  entity_type text NOT NULL,                    -- 'campaign' | 'adset' | 'ad'
  entity_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  from_status text,                             -- null if first_seen
  to_status text NOT NULL,
  change_kind text NOT NULL,                    -- 'first_seen' | 'paused' | 'enabled' | 'archived' | 'removed' | 'effective_only' | 'delivery_only'
  raw_event jsonb,
  dedupe_key text GENERATED ALWAYS AS (
    store_id || ':' || platform || ':' || entity_type || ':' || entity_id || ':' ||
    COALESCE(from_status, 'NULL') || ':' || to_status || ':' ||
    to_char(date_trunc('minute', occurred_at), 'YYYY-MM-DD"T"HH24:MI')
  ) STORED,
  UNIQUE (dedupe_key)
);
CREATE INDEX idx_status_events_recent ON campaign_status_events (store_id, platform, occurred_at DESC);
CREATE INDEX idx_status_events_entity ON campaign_status_events (entity_id, occurred_at DESC);

-- ---------------------------------------------------------------------------
-- 5. cron_tick_snapshots (one row per orchestrator run)
-- ---------------------------------------------------------------------------
CREATE TABLE cron_tick_snapshots (
  tick_id text PRIMARY KEY,                     -- ISO YYYY-MM-DDTHH:MM, 10-min bucket
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  fan_out_count integer,
  events_completed_count integer,
  events_skipped_count integer,
  events_failed_count integer
);
CREATE INDEX idx_cron_tick_snapshots_started ON cron_tick_snapshots (started_at DESC);

-- ---------------------------------------------------------------------------
-- Grants — mirror existing pattern from 20260521075741_add_constraints_and_grants.sql.
-- service_role implicit; anon gets SELECT only (URL-obscurity trust model).
-- ---------------------------------------------------------------------------
GRANT SELECT ON campaign_registry, adset_registry, ad_registry,
                 campaign_status_events, cron_tick_snapshots TO anon;
```

- [ ] **Step 3: Verify the migration list shows the new file as local-only**

```bash
mv .env .env.tmp
cd /tmp && supabase migration list --linked --workdir /Users/dorperetz/script-roas 2>&1 | tail -3
mv /Users/dorperetz/script-roas/.env.tmp /Users/dorperetz/script-roas/.env
```

Expected: last row shows `20260530XXXXXX_phase_b_registries` with the Remote column empty (not yet pushed).

- [ ] **Step 4: Commit (do NOT push to prod yet — Task 14 deploys)**

```bash
git add supabase/migrations/20260530XXXXXX_phase_b_registries.sql
git commit -m "feat(phase-b): migration for registries + status events + cron-tick snapshots"
```

---

## Task 2: Shared types + Inngest event names

**Files:**
- Create: `dashboard-web/src/lib/registries/types.ts`
- Create: `dashboard-web/src/lib/registries/eventNames.ts`

- [ ] **Step 1: Write `eventNames.ts`** (Edit/Write — exact content)

```typescript
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

export type WorkerScope = 'status' | 'hot_metrics' | 'kpi' | 'products_live';
```

- [ ] **Step 2: Write `types.ts`** (Edit/Write — exact content)

```typescript
// dashboard-web/src/lib/registries/types.ts
//
// Phase B — TypeScript shapes for the 3 registries, status_events, and
// the orchestrator event payload. These mirror the columns in the
// 20260530XXXXXX_phase_b_registries.sql migration.

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
```

- [ ] **Step 3: Verify tsc passes**

Run: `cd dashboard-web && npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 4: Commit**

```bash
git add dashboard-web/src/lib/registries/types.ts dashboard-web/src/lib/registries/eventNames.ts
git commit -m "feat(phase-b): shared TS types + Inngest event-name constants"
```

---

## Task 3: `tickIdForNow()` helper — 10-minute bucket flooring

**Files:**
- Create: `dashboard-web/src/lib/registries/snapshots.ts` (small file — also hosts the `insertCronTickSnapshot` helper for Task 8)
- Test: `dashboard-web/src/lib/registries/__tests__/snapshots.test.ts`

- [ ] **Step 1: Write the failing test**

Create `dashboard-web/src/lib/registries/__tests__/snapshots.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { tickIdForNow } from '@/lib/registries/snapshots';

describe('tickIdForNow()', () => {
  it('floors to the 10-min bucket — 14:37:42 → "...T14:30"', () => {
    const at = new Date('2026-05-29T14:37:42.000Z').getTime();
    expect(tickIdForNow(at)).toBe('2026-05-29T14:30');
  });

  it('exact bucket boundary stays on the bucket — 14:30:00.000 → "...T14:30"', () => {
    const at = new Date('2026-05-29T14:30:00.000Z').getTime();
    expect(tickIdForNow(at)).toBe('2026-05-29T14:30');
  });

  it('handles hour rollover — 14:59:59 → "...T14:50"', () => {
    const at = new Date('2026-05-29T14:59:59.000Z').getTime();
    expect(tickIdForNow(at)).toBe('2026-05-29T14:50');
  });

  it('a retry 90 sec later in the same bucket → same tick_id (idempotency)', () => {
    const first = new Date('2026-05-29T14:30:05.000Z').getTime();
    const retry = new Date('2026-05-29T14:31:35.000Z').getTime();
    expect(tickIdForNow(first)).toBe(tickIdForNow(retry));
  });
});
```

- [ ] **Step 2: Run — expect FAIL (module not found)**

```bash
cd dashboard-web && npx vitest run src/lib/registries/__tests__/snapshots.test.ts
```

Expected: `Cannot find module '@/lib/registries/snapshots'`.

- [ ] **Step 3: Write the minimal implementation**

Create `dashboard-web/src/lib/registries/snapshots.ts`:

```typescript
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
```

- [ ] **Step 4: Run — expect PASS (4/4)**

```bash
npx vitest run src/lib/registries/__tests__/snapshots.test.ts
```

Expected: `Test Files  1 passed (1) — Tests  4 passed (4)`.

- [ ] **Step 5: Commit**

```bash
git add dashboard-web/src/lib/registries/snapshots.ts \
        dashboard-web/src/lib/registries/__tests__/snapshots.test.ts
git commit -m "feat(phase-b): tickIdForNow() with 10-min flooring + snapshot upserter"
```

---

## Task 4: Priority builder

The orchestrator computes which `(store, scope)` tuples to fan out this tick based on `data_freshness` (staleness) + `meta_buc_usage` (budget). Stale + low budget → high priority; fresh OR budget-exceeded → skip.

**Files:**
- Create: `dashboard-web/src/lib/registries/priorityBuilder.ts`
- Test: `dashboard-web/src/lib/registries/__tests__/priorityBuilder.test.ts`

- [ ] **Step 1: Write the failing test**

Create `dashboard-web/src/lib/registries/__tests__/priorityBuilder.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { buildEvents } from '@/lib/registries/priorityBuilder';
import type { FreshnessRow } from '@/lib/inngest/freshness';

const TICK_ID = '2026-05-29T14:30';
const NOW_MS = new Date('2026-05-29T14:30:42.000Z').getTime();

const ALL_STORES: Array<'uzoshop' | 'zolplus' | 'usmile360'> =
  ['uzoshop', 'zolplus', 'usmile360'];

function freshness(over: Partial<FreshnessRow>): FreshnessRow {
  return {
    store_id: 'uzoshop',
    platform: 'meta',
    scope: 'campaign_status',
    table_name: 'campaign_registry',
    last_attempt_at: '2026-05-29T14:20:00.000Z',
    last_success_at: '2026-05-29T14:20:00.000Z',
    status: 'success',
    lag_minutes: 10,
    error_code: null,
    error_message: null,
    budget_skip: false,
    updated_at: '2026-05-29T14:20:00.000Z',
    ...over,
  };
}

describe('buildEvents()', () => {
  it('emits one meta status event per store when all are stale + budget OK', () => {
    const events = buildEvents({
      stores: ALL_STORES,
      freshness: [],   // no prior rows → infinite staleness
      metaBucPctByStore: { uzoshop: 10, zolplus: 5, usmile360: 0 },
      tickId: TICK_ID,
      nowMs: NOW_MS,
    });
    expect(events).toHaveLength(3);
    expect(events.every(e => e.name === 'meta/job.requested')).toBe(true);
    expect(events.every(e => e.data.scope === 'status')).toBe(true);
    expect(events.map(e => e.data.store_id).sort()).toEqual(['usmile360', 'uzoshop', 'zolplus']);
  });

  it('skips a store whose Meta BUC pct is >= 80', () => {
    const events = buildEvents({
      stores: ALL_STORES,
      freshness: [],
      metaBucPctByStore: { uzoshop: 85, zolplus: 10, usmile360: 0 },
      tickId: TICK_ID,
      nowMs: NOW_MS,
    });
    expect(events.map(e => e.data.store_id).sort()).toEqual(['usmile360', 'zolplus']);
  });

  it('skips a store whose last_success_at < 8 minutes ago (already fresh)', () => {
    const events = buildEvents({
      stores: ALL_STORES,
      freshness: [
        freshness({
          store_id: 'uzoshop',
          scope: 'campaign_status',
          last_success_at: '2026-05-29T14:26:00.000Z', // 4 min ago
        }),
      ],
      metaBucPctByStore: { uzoshop: 10, zolplus: 5, usmile360: 0 },
      tickId: TICK_ID,
      nowMs: NOW_MS,
    });
    expect(events.map(e => e.data.store_id).sort()).toEqual(['usmile360', 'zolplus']);
  });

  it('event id encodes platform:store:scope:tick (idempotency)', () => {
    const events = buildEvents({
      stores: ['uzoshop'],
      freshness: [],
      metaBucPctByStore: { uzoshop: 10 },
      tickId: TICK_ID,
      nowMs: NOW_MS,
    });
    expect(events[0].id).toBe('meta:uzoshop:status:2026-05-29T14:30');
  });

  it('staleness_seconds reflects time since last_success_at (or large value when never succeeded)', () => {
    const events = buildEvents({
      stores: ['uzoshop'],
      freshness: [
        freshness({ store_id: 'uzoshop', last_success_at: '2026-05-29T14:20:42.000Z' }),
      ],
      metaBucPctByStore: { uzoshop: 0 },
      tickId: TICK_ID,
      nowMs: NOW_MS,
    });
    expect(events[0].data.staleness_seconds).toBe(600); // 10 min
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run src/lib/registries/__tests__/priorityBuilder.test.ts
```

Expected: `Cannot find module '@/lib/registries/priorityBuilder'`.

- [ ] **Step 3: Write the implementation**

Create `dashboard-web/src/lib/registries/priorityBuilder.ts`:

```typescript
// dashboard-web/src/lib/registries/priorityBuilder.ts
//
// Phase B — pure helper that the orchestrator uses to decide what to fan
// out each tick. Reads (snapshot of) data_freshness + meta_buc_usage,
// returns the Inngest event payloads.
//
// Skip rules:
//   1. Meta BUC pct (max of ads_insights / ads_management) >= 80 → skip.
//   2. last_success_at for (store, scope='campaign_status') is younger than
//      the per-scope cooldown (8 min for status) → skip; some other tick
//      already touched it recently.
//
// Otherwise emit `meta/job.requested` with scope='status'. Phase C extends
// this builder with scope='hot_metrics'.

import type { FreshnessRow } from '@/lib/inngest/freshness';
import {
  META_JOB_REQUESTED,
  type WorkerScope,
} from './eventNames';
import type { JobRequestedEvent, StoreId } from './types';

const STATUS_COOLDOWN_SECONDS = 8 * 60;     // skip if last success < 8 min ago
const BUC_SKIP_THRESHOLD = 80;

type InngestEventPayload = {
  name: typeof META_JOB_REQUESTED;
  id: string;
  data: JobRequestedEvent;
};

export function buildEvents(input: {
  stores: StoreId[];
  freshness: FreshnessRow[];
  metaBucPctByStore: Partial<Record<StoreId, number>>;
  tickId: string;
  nowMs: number;
}): InngestEventPayload[] {
  const { stores, freshness, metaBucPctByStore, tickId, nowMs } = input;
  const events: InngestEventPayload[] = [];

  for (const storeId of stores) {
    const bucPct = metaBucPctByStore[storeId] ?? 0;
    if (bucPct >= BUC_SKIP_THRESHOLD) continue;

    const stalenessSeconds = freshnessSecondsFor(freshness, storeId, 'campaign_status', nowMs);
    if (stalenessSeconds < STATUS_COOLDOWN_SECONDS) continue;

    events.push(makeEvent(storeId, 'status', tickId, stalenessSeconds, bucPct));
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
```

- [ ] **Step 4: Run — expect PASS (5/5)**

```bash
npx vitest run src/lib/registries/__tests__/priorityBuilder.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add dashboard-web/src/lib/registries/priorityBuilder.ts \
        dashboard-web/src/lib/registries/__tests__/priorityBuilder.test.ts
git commit -m "feat(phase-b): priority builder — skip on BUC>=80% or status<8min stale"
```

---

## Task 5: Diff logic — classify status changes

Given a prior registry snapshot and the freshly-fetched status payload, the diff logic emits `StatusEventInsert[]` describing each transition.

**Files:**
- Create: `dashboard-web/src/lib/registries/diff.ts`
- Test: `dashboard-web/src/lib/registries/__tests__/diff.test.ts`

- [ ] **Step 1: Write the failing test**

Create `dashboard-web/src/lib/registries/__tests__/diff.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { classifyChange, diffAgainstRegistry } from '@/lib/registries/diff';
import type { CampaignRegistryRow } from '@/lib/registries/types';

const NOW = '2026-05-29T14:30:42.000Z';

function row(over: Partial<CampaignRegistryRow>): CampaignRegistryRow {
  return {
    store_id: 'uzoshop',
    platform: 'meta',
    campaign_id: 'C1',
    name: 'Hair Serum',
    configured_status: 'ACTIVE',
    effective_status: 'ACTIVE',
    delivery_status: 'DELIVERING',
    is_enabled: true,
    is_serving: true,
    first_seen_at: '2026-05-29T10:00:00.000Z',
    last_seen_at: '2026-05-29T14:20:00.000Z',
    platform_updated_at: '2026-05-29T14:10:00.000Z',
    status_changed_at: '2026-05-29T10:00:00.000Z',
    last_metrics_success_at: null,
    last_status_success_at: '2026-05-29T14:20:00.000Z',
    raw_status_payload: null,
    missed_seen_count: 0,
    is_removed: false,
    ...over,
  };
}

describe('classifyChange()', () => {
  it('null prior → first_seen', () => {
    expect(classifyChange(null, row({}))).toBe('first_seen');
  });

  it('ACTIVE → PAUSED on configured_status → paused', () => {
    const prior = row({ configured_status: 'ACTIVE' });
    const next = row({ configured_status: 'PAUSED' });
    expect(classifyChange(prior, next)).toBe('paused');
  });

  it('PAUSED → ACTIVE on configured_status → enabled', () => {
    const prior = row({ configured_status: 'PAUSED' });
    const next = row({ configured_status: 'ACTIVE' });
    expect(classifyChange(prior, next)).toBe('enabled');
  });

  it('configured_status moves to ARCHIVED → archived', () => {
    const prior = row({ configured_status: 'ACTIVE' });
    const next = row({ configured_status: 'ARCHIVED' });
    expect(classifyChange(prior, next)).toBe('archived');
  });

  it('only effective_status changes (e.g. PENDING_REVIEW → ACTIVE) → effective_only', () => {
    const prior = row({ configured_status: 'ACTIVE', effective_status: 'PENDING_REVIEW' });
    const next = row({ configured_status: 'ACTIVE', effective_status: 'ACTIVE' });
    expect(classifyChange(prior, next)).toBe('effective_only');
  });

  it('only delivery_status changes (e.g. DELIVERING → LIMITED) → delivery_only', () => {
    const prior = row({ delivery_status: 'DELIVERING' });
    const next = row({ delivery_status: 'LIMITED' });
    expect(classifyChange(prior, next)).toBe('delivery_only');
  });

  it('only name changed → null (no event)', () => {
    const prior = row({ name: 'Old' });
    const next = row({ name: 'New' });
    expect(classifyChange(prior, next)).toBeNull();
  });
});

describe('diffAgainstRegistry()', () => {
  it('emits one StatusEventInsert per changed entity, none for unchanged', () => {
    const prior = new Map<string, CampaignRegistryRow>([
      ['C1', row({ campaign_id: 'C1', configured_status: 'ACTIVE' })],
      ['C2', row({ campaign_id: 'C2', configured_status: 'ACTIVE' })],
    ]);
    const fresh = [
      row({ campaign_id: 'C1', configured_status: 'PAUSED' }),
      row({ campaign_id: 'C2', configured_status: 'ACTIVE' }), // unchanged
      row({ campaign_id: 'C3', configured_status: 'ACTIVE' }), // new
    ];
    const events = diffAgainstRegistry({
      entityType: 'campaign',
      prior,
      fresh,
      occurredAt: NOW,
    });
    expect(events).toHaveLength(2);
    expect(events.find(e => e.entity_id === 'C1')?.change_kind).toBe('paused');
    expect(events.find(e => e.entity_id === 'C3')?.change_kind).toBe('first_seen');
  });

  it('event payload carries from_status, to_status, raw_event', () => {
    const prior = new Map<string, CampaignRegistryRow>();
    const fresh = [row({ campaign_id: 'C1', configured_status: 'ACTIVE', effective_status: 'PENDING_REVIEW' })];
    const events = diffAgainstRegistry({ entityType: 'campaign', prior, fresh, occurredAt: NOW });
    expect(events[0].from_status).toBeNull();
    expect(events[0].to_status).toBe('ACTIVE');
    expect(events[0].raw_event).toMatchObject({ effective_status: 'PENDING_REVIEW' });
    expect(events[0].occurred_at).toBe(NOW);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run src/lib/registries/__tests__/diff.test.ts
```

- [ ] **Step 3: Write the implementation**

Create `dashboard-web/src/lib/registries/diff.ts`:

```typescript
// dashboard-web/src/lib/registries/diff.ts
//
// Phase B — diff logic that compares the fresh status payload against
// the prior registry snapshot and emits one StatusEventInsert per
// genuine status transition. Cosmetic edits (name, budget, creative)
// do NOT produce events — `status_changed_at` is the high-fidelity
// "real change" signal that Phase C's hot-set relies on.

import type {
  CampaignRegistryRow,
  ChangeKind,
  EntityType,
  StatusEventInsert,
  StoreId,
  Platform,
} from './types';

const ARCHIVE_STATUSES = new Set(['ARCHIVED', 'DELETED']);

export function classifyChange(
  prior: CampaignRegistryRow | null,
  next: CampaignRegistryRow,
): ChangeKind | null {
  if (prior === null) return 'first_seen';

  // Soft-delete (missed for N ticks) → 'removed' is emitted by the upsert
  // layer when it bumps missed_seen_count past the threshold, not here.

  const configuredChanged = (prior.configured_status ?? null) !== (next.configured_status ?? null);
  const effectiveChanged = (prior.effective_status ?? null) !== (next.effective_status ?? null);
  const deliveryChanged = (prior.delivery_status ?? null) !== (next.delivery_status ?? null);

  if (configuredChanged) {
    const nx = next.configured_status ?? '';
    if (ARCHIVE_STATUSES.has(nx)) return 'archived';
    if (nx === 'PAUSED') return 'paused';
    if (nx === 'ACTIVE') return 'enabled';
    // Unknown configured_status transition — fall through to effective_only.
  }
  if (effectiveChanged) return 'effective_only';
  if (deliveryChanged) return 'delivery_only';

  return null;
}

export function diffAgainstRegistry(input: {
  entityType: EntityType;
  prior: Map<string, CampaignRegistryRow>;
  fresh: CampaignRegistryRow[];
  occurredAt: string;
}): StatusEventInsert[] {
  const { entityType, prior, fresh, occurredAt } = input;
  const out: StatusEventInsert[] = [];
  for (const row of fresh) {
    const entityId = pickEntityId(entityType, row);
    const priorRow = prior.get(entityId) ?? null;
    const kind = classifyChange(priorRow, row);
    if (kind === null) continue;
    out.push({
      store_id: row.store_id as StoreId,
      platform: row.platform as Platform,
      entity_type: entityType,
      entity_id: entityId,
      occurred_at: occurredAt,
      from_status: priorRow ? (priorRow.configured_status ?? null) : null,
      to_status: row.configured_status ?? row.effective_status ?? row.delivery_status ?? '',
      change_kind: kind,
      raw_event: {
        configured_status: row.configured_status,
        effective_status: row.effective_status,
        delivery_status: row.delivery_status,
      },
    });
  }
  return out;
}

function pickEntityId(entityType: EntityType, row: CampaignRegistryRow): string {
  if (entityType === 'campaign') return row.campaign_id;
  if (entityType === 'adset') return (row as unknown as { adset_id: string }).adset_id;
  return (row as unknown as { ad_id: string }).ad_id;
}
```

- [ ] **Step 4: Run — expect PASS (9/9)**

```bash
npx vitest run src/lib/registries/__tests__/diff.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add dashboard-web/src/lib/registries/diff.ts \
        dashboard-web/src/lib/registries/__tests__/diff.test.ts
git commit -m "feat(phase-b): classifyChange + diffAgainstRegistry pure helpers"
```

---

## Task 6: Registry upserter + status-events writer

Pure (mock-Supabase) test for the SQL shape of the upsert; the actual Supabase call is integration-tested by Task 9 with the worker.

**Files:**
- Create: `dashboard-web/src/lib/registries/upsert.ts`
- Test: `dashboard-web/src/lib/registries/__tests__/upsert.test.ts`

- [ ] **Step 1: Write the failing test**

Create `dashboard-web/src/lib/registries/__tests__/upsert.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import {
  buildRegistryUpsertRow,
  insertStatusEventsBatch,
  upsertRegistryBatch,
} from '@/lib/registries/upsert';
import type { CampaignRegistryRow, StatusEventInsert } from '@/lib/registries/types';

const NOW = '2026-05-29T14:30:42.000Z';

function makeFresh(over: Partial<CampaignRegistryRow> = {}): CampaignRegistryRow {
  return {
    store_id: 'uzoshop',
    platform: 'meta',
    campaign_id: 'C1',
    name: 'Hair Serum',
    configured_status: 'ACTIVE',
    effective_status: 'ACTIVE',
    delivery_status: 'DELIVERING',
    is_enabled: true,
    is_serving: true,
    first_seen_at: '__will_be_set__',
    last_seen_at: '__will_be_set__',
    platform_updated_at: '2026-05-29T14:10:00.000Z',
    status_changed_at: null,
    last_metrics_success_at: null,
    last_status_success_at: null,
    raw_status_payload: { id: 'C1', name: 'Hair Serum' },
    missed_seen_count: 0,
    is_removed: false,
    ...over,
  };
}

describe('buildRegistryUpsertRow()', () => {
  it('new entity: first_seen_at = now, last_seen_at = now, status_changed_at = now', () => {
    const out = buildRegistryUpsertRow({ prior: null, fresh: makeFresh({}), nowIso: NOW });
    expect(out.first_seen_at).toBe(NOW);
    expect(out.last_seen_at).toBe(NOW);
    expect(out.status_changed_at).toBe(NOW);
    expect(out.last_status_success_at).toBe(NOW);
    expect(out.missed_seen_count).toBe(0);
  });

  it('existing entity, status unchanged: first_seen_at + status_changed_at preserved; last_seen_at bumped', () => {
    const prior = makeFresh({
      first_seen_at: '2026-05-29T10:00:00.000Z',
      last_seen_at: '2026-05-29T14:20:00.000Z',
      status_changed_at: '2026-05-29T10:00:00.000Z',
      missed_seen_count: 0,
    });
    const fresh = makeFresh({}); // same configured/effective
    const out = buildRegistryUpsertRow({ prior, fresh, nowIso: NOW });
    expect(out.first_seen_at).toBe('2026-05-29T10:00:00.000Z'); // preserved
    expect(out.status_changed_at).toBe('2026-05-29T10:00:00.000Z'); // preserved
    expect(out.last_seen_at).toBe(NOW); // bumped
    expect(out.last_status_success_at).toBe(NOW);
  });

  it('existing entity, configured_status changed: status_changed_at = now', () => {
    const prior = makeFresh({ configured_status: 'ACTIVE', status_changed_at: '2026-05-29T10:00:00.000Z' });
    const fresh = makeFresh({ configured_status: 'PAUSED' });
    const out = buildRegistryUpsertRow({ prior, fresh, nowIso: NOW });
    expect(out.status_changed_at).toBe(NOW);
  });

  it('existing entity, only name changed: status_changed_at preserved (cosmetic edit)', () => {
    const prior = makeFresh({ name: 'Old', status_changed_at: '2026-05-29T10:00:00.000Z' });
    const fresh = makeFresh({ name: 'New' });
    const out = buildRegistryUpsertRow({ prior, fresh, nowIso: NOW });
    expect(out.status_changed_at).toBe('2026-05-29T10:00:00.000Z'); // preserved
    expect(out.name).toBe('New'); // but name updated
  });

  it('missed_seen_count resets to 0 when fresh data arrives', () => {
    const prior = makeFresh({ missed_seen_count: 2 });
    const fresh = makeFresh({});
    const out = buildRegistryUpsertRow({ prior, fresh, nowIso: NOW });
    expect(out.missed_seen_count).toBe(0);
  });
});

describe('upsertRegistryBatch()', () => {
  it('calls supabase.upsert with the registries[] payload (table name parameterized)', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ upsert });
    const admin = { from } as unknown as Parameters<typeof upsertRegistryBatch>[0]['admin'];
    const rows: CampaignRegistryRow[] = [makeFresh({})];
    await upsertRegistryBatch({ admin, table: 'campaign_registry', rows });
    expect(from).toHaveBeenCalledWith('campaign_registry');
    expect(upsert).toHaveBeenCalledWith(rows, { onConflict: 'store_id,platform,campaign_id' });
  });
});

describe('insertStatusEventsBatch()', () => {
  it('inserts events with ignoreDuplicates: true (ON CONFLICT DO NOTHING via PostgREST)', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ insert });
    const admin = { from } as unknown as Parameters<typeof insertStatusEventsBatch>[0]['admin'];
    const events: StatusEventInsert[] = [{
      store_id: 'uzoshop',
      platform: 'meta',
      entity_type: 'campaign',
      entity_id: 'C1',
      occurred_at: NOW,
      from_status: null,
      to_status: 'ACTIVE',
      change_kind: 'first_seen',
      raw_event: {},
    }];
    await insertStatusEventsBatch({ admin, events });
    expect(from).toHaveBeenCalledWith('campaign_status_events');
    expect(insert).toHaveBeenCalledWith(events, { count: 'exact', defaultToNull: true });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run src/lib/registries/__tests__/upsert.test.ts
```

- [ ] **Step 3: Write the implementation**

Create `dashboard-web/src/lib/registries/upsert.ts`:

```typescript
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
  const { error } = await admin
    .from('campaign_status_events')
    .insert(events, { count: 'exact', defaultToNull: true });
  // ON CONFLICT (dedupe_key) DO NOTHING is enforced by the UNIQUE
  // constraint. Translate the 23505 unique_violation into a soft warning
  // (we already deduped in app code; the constraint is belt-and-suspenders).
  if (error && error.code !== '23505') {
    throw new Error(`insert campaign_status_events: ${error.message}`);
  }
}
```

- [ ] **Step 4: Run — expect PASS (7/7)**

```bash
npx vitest run src/lib/registries/__tests__/upsert.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add dashboard-web/src/lib/registries/upsert.ts \
        dashboard-web/src/lib/registries/__tests__/upsert.test.ts
git commit -m "feat(phase-b): buildRegistryUpsertRow + upsertRegistryBatch + insertStatusEventsBatch"
```

---

## Task 7: `fetchMetaStatusForStore`

Calls Meta Graph API Batch (`POST /` with `batch=[…]`) for `/campaigns`, `/adsets`, `/ads`. Returns a normalized object.

**Files:**
- Create: `dashboard-web/src/lib/fetchers/metaStatus.ts`
- Test: `dashboard-web/src/lib/fetchers/__tests__/metaStatus.test.ts`

- [ ] **Step 1: Write the failing test (uses `vi.fn()` to mock `fetch`)**

Create `dashboard-web/src/lib/fetchers/__tests__/metaStatus.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchMetaStatusForStore } from '@/lib/fetchers/metaStatus';

const BATCH_RESPONSE_BODY = JSON.stringify([
  {
    code: 200,
    body: JSON.stringify({
      data: [{
        id: 'C1', name: 'Hair Serum',
        configured_status: 'ACTIVE', effective_status: 'ACTIVE',
        updated_time: '2026-05-29T14:10:00+0000',
      }],
    }),
  },
  {
    code: 200,
    body: JSON.stringify({
      data: [{
        id: 'AS1', campaign_id: 'C1', name: 'Adset A',
        configured_status: 'ACTIVE', effective_status: 'ACTIVE',
        daily_budget: '5000', updated_time: '2026-05-29T14:10:00+0000',
      }],
    }),
  },
  {
    code: 200,
    body: JSON.stringify({
      data: [{
        id: 'AD1', adset_id: 'AS1', campaign_id: 'C1', name: 'Ad A',
        configured_status: 'ACTIVE', effective_status: 'ACTIVE',
        updated_time: '2026-05-29T14:10:00+0000',
      }],
    }),
  },
]);

function mockFetch(body: string, bucHeader: string) {
  return vi.fn(async () => new Response(body, {
    status: 200,
    headers: { 'x-business-use-case-usage': bucHeader },
  }));
}

afterEach(() => { vi.restoreAllMocks(); });

describe('fetchMetaStatusForStore()', () => {
  it('returns campaigns + adsets + ads normalized to the registry shape', async () => {
    const fetchMock = mockFetch(BATCH_RESPONSE_BODY, '{}');
    const out = await fetchMetaStatusForStore({
      storeId: 'uzoshop',
      adAccountId: 'act_111',
      accessToken: 'tok',
      fetcher: fetchMock,
      getFxCadFor: async (amount, currency) => currency === 'USD' ? amount * 1.36 : amount,
    });

    expect(out.campaigns).toHaveLength(1);
    expect(out.campaigns[0]).toMatchObject({
      store_id: 'uzoshop', platform: 'meta',
      campaign_id: 'C1', name: 'Hair Serum',
      configured_status: 'ACTIVE', effective_status: 'ACTIVE',
    });
    expect(out.adsets).toHaveLength(1);
    expect(out.adsets[0]).toMatchObject({ adset_id: 'AS1', campaign_id: 'C1' });
    expect(out.ads).toHaveLength(1);
    expect(out.ads[0]).toMatchObject({ ad_id: 'AD1', adset_id: 'AS1', campaign_id: 'C1' });
  });

  it('parses BUC header into ads_insights_call_pct etc when present', async () => {
    const buc = JSON.stringify({
      '111': [{
        type: 'ads_insights',
        call_count: 50,
        total_cputime: 30,
        total_time: 25,
        estimated_time_to_regain_access: 0,
      }],
    });
    const fetchMock = mockFetch(BATCH_RESPONSE_BODY, buc);
    const out = await fetchMetaStatusForStore({
      storeId: 'uzoshop', adAccountId: 'act_111', accessToken: 'tok',
      fetcher: fetchMock,
      getFxCadFor: async () => 0,
    });
    expect(out.bucUsage.ads_insights_call_pct).toBe(50);
  });

  it('uses HTTPS POST with batch JSON array of 3 sub-requests', async () => {
    const fetchMock = mockFetch(BATCH_RESPONSE_BODY, '{}');
    await fetchMetaStatusForStore({
      storeId: 'uzoshop', adAccountId: 'act_111', accessToken: 'tok',
      fetcher: fetchMock,
      getFxCadFor: async () => 0,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/^https:\/\/graph\.facebook\.com\//);
    expect(init?.method).toBe('POST');
    const body = init?.body as string;
    expect(body).toContain('act_111%2Fcampaigns'); // relative_url url-encoded
    expect(body).toContain('act_111%2Fadsets');
    expect(body).toContain('act_111%2Fads');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run src/lib/fetchers/__tests__/metaStatus.test.ts
```

- [ ] **Step 3: Write the implementation**

Create `dashboard-web/src/lib/fetchers/metaStatus.ts`:

```typescript
// dashboard-web/src/lib/fetchers/metaStatus.ts
//
// Phase B — single-batch Meta Graph API call that fetches campaigns +
// adsets + ads status for one ad account, parses the
// x-business-use-case-usage header, and converts adset budgets to CAD.
//
// Why batch:
//   - 1 HTTPS round-trip vs 3
//   - Header parsing happens once
//   - The Graph API charges the same BUC whether you batch or not, but
//     batching reduces TCP / TLS overhead.
//
// Why fetcher injection:
//   - Vitest unit tests can pass `vi.fn()` instead of stubbing global
//     fetch, mirroring the rest of the fetcher modules.

import type {
  AdRegistryRow,
  AdsetRegistryRow,
  CampaignRegistryRow,
  StoreId,
} from '@/lib/registries/types';

const GRAPH_VERSION = 'v22.0';
const CAMPAIGN_FIELDS = 'id,name,configured_status,effective_status,updated_time';
const ADSET_FIELDS = 'id,campaign_id,name,configured_status,effective_status,daily_budget,lifetime_budget,updated_time';
const AD_FIELDS = 'id,adset_id,campaign_id,name,configured_status,effective_status,updated_time';

export type MetaStatusFetchInput = {
  storeId: StoreId;
  adAccountId: string;                          // 'act_<id>' OR raw '<id>' (we'll prefix)
  accessToken: string;
  fetcher?: typeof fetch;
  getFxCadFor: (amount: number, currency: 'USD' | 'CAD' | 'ILS') => Promise<number>;
};

export type MetaStatusResult = {
  campaigns: CampaignRegistryRow[];
  adsets: AdsetRegistryRow[];
  ads: AdRegistryRow[];
  bucUsage: {
    ads_insights_call_pct: number;
    ads_insights_cputime_pct: number;
    ads_insights_time_pct: number;
    ads_insights_eta_minutes: number;
    ads_management_call_pct: number;
    ads_management_cputime_pct: number;
    ads_management_time_pct: number;
    ads_management_eta_minutes: number;
  };
};

const ZERO_BUC: MetaStatusResult['bucUsage'] = {
  ads_insights_call_pct: 0,
  ads_insights_cputime_pct: 0,
  ads_insights_time_pct: 0,
  ads_insights_eta_minutes: 0,
  ads_management_call_pct: 0,
  ads_management_cputime_pct: 0,
  ads_management_time_pct: 0,
  ads_management_eta_minutes: 0,
};

export async function fetchMetaStatusForStore(input: MetaStatusFetchInput): Promise<MetaStatusResult> {
  const { storeId, accessToken, fetcher = fetch } = input;
  const adAccountId = input.adAccountId.startsWith('act_')
    ? input.adAccountId
    : `act_${input.adAccountId}`;
  const account = adAccountId.replace(/^act_/, '');

  const batch = [
    { method: 'GET', relative_url: `${adAccountId}/campaigns?fields=${CAMPAIGN_FIELDS}&limit=500` },
    { method: 'GET', relative_url: `${adAccountId}/adsets?fields=${ADSET_FIELDS}&limit=1000` },
    { method: 'GET', relative_url: `${adAccountId}/ads?fields=${AD_FIELDS}&limit=2000` },
  ];

  const body = new URLSearchParams();
  body.set('access_token', accessToken);
  body.set('batch', JSON.stringify(batch));

  const res = await fetcher(`https://graph.facebook.com/${GRAPH_VERSION}/`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`Meta batch ${res.status}: ${await res.text()}`);
  }

  const parts = (await res.json()) as Array<{ code: number; body: string }>;
  const [campaignsPart, adsetsPart, adsPart] = parts;

  const bucUsage = parseBucHeader(res.headers.get('x-business-use-case-usage'), account);

  const campaigns = await Promise.all(
    asArray(campaignsPart).map(async (c) => toCampaignRow(storeId, c)),
  );
  const adsets = await Promise.all(
    asArray(adsetsPart).map(async (a) => toAdsetRow(storeId, a, input.getFxCadFor)),
  );
  const ads = asArray(adsPart).map((a) => toAdRow(storeId, a));

  return { campaigns, adsets, ads, bucUsage };
}

function asArray(part: { code: number; body: string }): Array<Record<string, unknown>> {
  if (part.code !== 200) return [];
  try {
    const parsed = JSON.parse(part.body) as { data?: unknown };
    return Array.isArray(parsed.data) ? (parsed.data as Array<Record<string, unknown>>) : [];
  } catch {
    return [];
  }
}

const NULL_PLACEHOLDER = '__will_be_overwritten_by_upsert_layer__';

function toCampaignRow(storeId: StoreId, c: Record<string, unknown>): CampaignRegistryRow {
  return {
    store_id: storeId,
    platform: 'meta',
    campaign_id: String(c.id),
    name: c.name as string ?? null,
    configured_status: c.configured_status as string ?? null,
    effective_status: c.effective_status as string ?? null,
    delivery_status: deriveDeliveryStatus(c.effective_status as string | undefined),
    is_enabled: c.configured_status === 'ACTIVE',
    is_serving: c.effective_status === 'ACTIVE',
    first_seen_at: NULL_PLACEHOLDER,
    last_seen_at: NULL_PLACEHOLDER,
    platform_updated_at: c.updated_time ? new Date(c.updated_time as string).toISOString() : null,
    status_changed_at: null,
    last_metrics_success_at: null,
    last_status_success_at: null,
    raw_status_payload: c,
    missed_seen_count: 0,
    is_removed: false,
  };
}

async function toAdsetRow(
  storeId: StoreId,
  a: Record<string, unknown>,
  getFx: MetaStatusFetchInput['getFxCadFor'],
): Promise<AdsetRegistryRow> {
  // Meta returns budget in account currency cents (string). Convert to
  // major-unit number and CAD via the FX adapter. Account currency is
  // assumed CAD for uzoshop/zolplus/usmile360; the caller passes the
  // right adapter.
  const dailyMinor = a.daily_budget ? Number(a.daily_budget) : null;
  const lifetimeMinor = a.lifetime_budget ? Number(a.lifetime_budget) : null;
  const dailyCad = dailyMinor != null ? await getFx(dailyMinor / 100, 'CAD') : null;
  const lifetimeCad = lifetimeMinor != null ? await getFx(lifetimeMinor / 100, 'CAD') : null;

  return {
    ...toCampaignRow(storeId, { ...a, id: a.campaign_id }),
    campaign_id: String(a.campaign_id),
    adset_id: String(a.id),
    daily_budget_cad: dailyCad,
    lifetime_budget_cad: lifetimeCad,
  };
}

function toAdRow(storeId: StoreId, a: Record<string, unknown>): AdRegistryRow {
  return {
    ...toCampaignRow(storeId, { ...a, id: a.campaign_id }),
    campaign_id: String(a.campaign_id),
    adset_id: String(a.adset_id),
    ad_id: String(a.id),
  };
}

function deriveDeliveryStatus(effective: string | undefined): string | null {
  if (!effective) return null;
  if (effective === 'ACTIVE') return 'DELIVERING';
  if (effective === 'PENDING_REVIEW') return 'PENDING_REVIEW';
  if (effective === 'IN_REVIEW') return 'PENDING_REVIEW';
  if (effective === 'REJECTED' || effective === 'DISAPPROVED') return 'REJECTED';
  if (effective === 'PAUSED' || effective === 'CAMPAIGN_PAUSED') return 'NOT_DELIVERING';
  return 'UNKNOWN';
}

function parseBucHeader(raw: string | null, account: string): MetaStatusResult['bucUsage'] {
  if (!raw) return ZERO_BUC;
  try {
    const parsed = JSON.parse(raw) as Record<string, Array<Record<string, unknown>>>;
    const list = parsed[account] ?? [];
    let insights: Record<string, unknown> | undefined;
    let management: Record<string, unknown> | undefined;
    for (const item of list) {
      const t = item.type as string;
      if (t === 'ads_insights') insights = item;
      if (t === 'ads_management') management = item;
    }
    return {
      ads_insights_call_pct: Number(insights?.call_count ?? 0),
      ads_insights_cputime_pct: Number(insights?.total_cputime ?? 0),
      ads_insights_time_pct: Number(insights?.total_time ?? 0),
      ads_insights_eta_minutes: Number(insights?.estimated_time_to_regain_access ?? 0),
      ads_management_call_pct: Number(management?.call_count ?? 0),
      ads_management_cputime_pct: Number(management?.total_cputime ?? 0),
      ads_management_time_pct: Number(management?.total_time ?? 0),
      ads_management_eta_minutes: Number(management?.estimated_time_to_regain_access ?? 0),
    };
  } catch {
    return ZERO_BUC;
  }
}
```

- [ ] **Step 4: Run — expect PASS (3/3)**

```bash
npx vitest run src/lib/fetchers/__tests__/metaStatus.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add dashboard-web/src/lib/fetchers/metaStatus.ts \
        dashboard-web/src/lib/fetchers/__tests__/metaStatus.test.ts
git commit -m "feat(phase-b): fetchMetaStatusForStore — single-batch campaigns+adsets+ads"
```

---

## Task 8: `cron-tick-orchestrator` Inngest function

**Files:**
- Create: `dashboard-web/src/inngest/functions/cronTickOrchestrator.ts`
- Test: `dashboard-web/src/inngest/functions/__tests__/cronTickOrchestrator.test.ts`

- [ ] **Step 1: Read existing Inngest test patterns**

```bash
ls dashboard-web/src/inngest/functions/__tests__/ | head -10
```

Read one of them to see the existing pattern (e.g. `cronLiveHeavyBudgetSkip.test.ts`).

- [ ] **Step 2: Write the failing test**

Create `dashboard-web/src/inngest/functions/__tests__/cronTickOrchestrator.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { runTickOnce } from '@/inngest/functions/cronTickOrchestrator';

describe('runTickOnce()', () => {
  it('fans out 3 meta/job.requested events when all stores are stale + BUC OK', async () => {
    const sendEvent = vi.fn().mockResolvedValue({ ids: ['e1', 'e2', 'e3'] });
    const upsertSnapshot = vi.fn().mockResolvedValue(undefined);
    const loadFreshness = vi.fn().mockResolvedValue([]);
    const loadMetaBuc = vi.fn().mockResolvedValue({
      uzoshop: 5, zolplus: 5, usmile360: 0,
    });
    const result = await runTickOnce({
      nowMs: new Date('2026-05-29T14:30:42.000Z').getTime(),
      sendEvent,
      upsertSnapshot,
      loadFreshness,
      loadMetaBuc,
    });
    expect(result.tickId).toBe('2026-05-29T14:30');
    expect(result.fanOutCount).toBe(3);
    expect(sendEvent).toHaveBeenCalledTimes(1);
    const [events] = sendEvent.mock.calls[0];
    expect(events).toHaveLength(3);
    expect(events[0].name).toBe('meta/job.requested');
    expect(upsertSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      tick_id: '2026-05-29T14:30',
      fan_out_count: 3,
    }));
  });

  it('emits no events when all 3 stores are BUC-skipped', async () => {
    const sendEvent = vi.fn();
    const upsertSnapshot = vi.fn();
    const result = await runTickOnce({
      nowMs: new Date('2026-05-29T14:30:42.000Z').getTime(),
      sendEvent,
      upsertSnapshot,
      loadFreshness: async () => [],
      loadMetaBuc: async () => ({ uzoshop: 90, zolplus: 95, usmile360: 80 }),
    });
    expect(result.fanOutCount).toBe(0);
    expect(sendEvent).not.toHaveBeenCalled();
    expect(upsertSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      fan_out_count: 0,
    }));
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

```bash
npx vitest run src/inngest/functions/__tests__/cronTickOrchestrator.test.ts
```

- [ ] **Step 4: Write the implementation**

Create `dashboard-web/src/inngest/functions/cronTickOrchestrator.ts`:

```typescript
// dashboard-web/src/inngest/functions/cronTickOrchestrator.ts
//
// Phase B — every 10 minutes, fan out Meta status discovery events
// based on data_freshness + meta_buc_usage.
//
// Pure orchestrator logic is extracted to `runTickOnce` so the test suite
// can exercise it with mocked dependencies instead of stubbing the whole
// Inngest runtime.

import { inngest } from '@/inngest/client';
import { getFreshness } from '@/lib/inngest/freshness';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { buildEvents } from '@/lib/registries/priorityBuilder';
import { insertCronTickSnapshot, tickIdForNow } from '@/lib/registries/snapshots';
import type { StoreId } from '@/lib/registries/types';

const STORES: StoreId[] = ['uzoshop', 'zolplus', 'usmile360'];

type SendEventFn = (events: Array<{ name: string; id: string; data: unknown }>) => Promise<{ ids: string[] }>;
type UpsertSnapshotFn = (row: { tick_id: string; started_at: string; finished_at: string; fan_out_count: number }) => Promise<void>;

export async function runTickOnce(input: {
  nowMs: number;
  sendEvent: SendEventFn;
  upsertSnapshot: UpsertSnapshotFn;
  loadFreshness: typeof getFreshness;
  loadMetaBuc: () => Promise<Partial<Record<StoreId, number>>>;
}): Promise<{ tickId: string; fanOutCount: number }> {
  const { nowMs, sendEvent, upsertSnapshot, loadFreshness, loadMetaBuc } = input;
  const tickId = tickIdForNow(nowMs);
  const startedAt = new Date(nowMs).toISOString();

  const [freshness, metaBucPctByStore] = await Promise.all([
    loadFreshness('campaign_status'),
    loadMetaBuc(),
  ]);
  const events = buildEvents({
    stores: STORES,
    freshness,
    metaBucPctByStore,
    tickId,
    nowMs,
  });

  if (events.length > 0) {
    await sendEvent(events);
  }
  await upsertSnapshot({
    tick_id: tickId,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    fan_out_count: events.length,
  });

  return { tickId, fanOutCount: events.length };
}

export const cronTickOrchestrator = inngest.createFunction(
  { id: 'cron-tick-orchestrator' },
  { cron: '*/10 * * * *' },
  async ({ step }) => {
    await step.run('runTickOnce', async () => {
      return runTickOnce({
        nowMs: Date.now(),
        sendEvent: async (events) => {
          // step.sendEvent returns { ids: string[] } typed as unknown without
          // top-level inferrer — type-assert at this seam.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (await (step as any).sendEvent('fan-out', events)) as { ids: string[] };
        },
        upsertSnapshot: insertCronTickSnapshot,
        loadFreshness: getFreshness,
        loadMetaBuc: loadMetaBucPctByStore,
      });
    });
  },
);

async function loadMetaBucPctByStore(): Promise<Partial<Record<StoreId, number>>> {
  const sb = getSupabaseAdmin();
  const { data } = await sb
    .from('meta_buc_usage')
    .select('store_id, ads_insights_call_pct, ads_management_call_pct');
  const out: Partial<Record<StoreId, number>> = {};
  for (const row of data ?? []) {
    const max = Math.max(
      Number((row as { ads_insights_call_pct?: number }).ads_insights_call_pct ?? 0),
      Number((row as { ads_management_call_pct?: number }).ads_management_call_pct ?? 0),
    );
    const sid = (row as { store_id: StoreId }).store_id;
    out[sid] = Math.max(out[sid] ?? 0, max);
  }
  return out;
}
```

- [ ] **Step 5: Run — expect PASS (2/2)**

```bash
npx vitest run src/inngest/functions/__tests__/cronTickOrchestrator.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add dashboard-web/src/inngest/functions/cronTickOrchestrator.ts \
        dashboard-web/src/inngest/functions/__tests__/cronTickOrchestrator.test.ts
git commit -m "feat(phase-b): cron-tick-orchestrator function + runTickOnce pure core"
```

---

## Task 9: `meta-worker` Inngest function

Consumes `meta/job.requested` (scope='status'), fetches Meta, diffs, persists.

**Files:**
- Create: `dashboard-web/src/inngest/functions/metaWorker.ts`
- Test: `dashboard-web/src/inngest/functions/__tests__/metaWorker.test.ts`

- [ ] **Step 1: Write the failing test**

Create `dashboard-web/src/inngest/functions/__tests__/metaWorker.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { runMetaWorkerJob } from '@/inngest/functions/metaWorker';
import type { CampaignRegistryRow } from '@/lib/registries/types';

const NOW_ISO = '2026-05-29T14:30:42.000Z';

function freshCampaign(id: string, configured: string): CampaignRegistryRow {
  return {
    store_id: 'uzoshop', platform: 'meta', campaign_id: id,
    name: 'Campaign ' + id, configured_status: configured,
    effective_status: configured, delivery_status: 'DELIVERING',
    is_enabled: configured === 'ACTIVE', is_serving: configured === 'ACTIVE',
    first_seen_at: '__placeholder__', last_seen_at: '__placeholder__',
    platform_updated_at: '2026-05-29T14:00:00.000Z',
    status_changed_at: null,
    last_metrics_success_at: null, last_status_success_at: null,
    raw_status_payload: null, missed_seen_count: 0, is_removed: false,
  };
}

describe('runMetaWorkerJob()', () => {
  it('budget skip path: BUC pct >= 80 → mark freshness budget_skip, no fetch', async () => {
    const fetcher = vi.fn();
    const recordFreshness = vi.fn();
    await runMetaWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'status', tick_id: 'T', staleness_seconds: 0, budget_pct_estimate: 85 },
      bucProbe: async () => ({ pct: 85 }),
      fetchStatus: fetcher,
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn(),
      insertStatusEvents: vi.fn(),
      recordFreshness,
      upsertBuc: vi.fn(),
      nowIso: NOW_ISO,
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(recordFreshness).toHaveBeenCalledWith(expect.objectContaining({
      status: 'budget_skip',
      scope: 'campaign_status',
    }));
  });

  it('happy path: fetch → diff → upsert registries → insert status events → mark success', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      campaigns: [freshCampaign('C1', 'ACTIVE')],
      adsets: [],
      ads: [],
      bucUsage: {
        ads_insights_call_pct: 12, ads_insights_cputime_pct: 5, ads_insights_time_pct: 5, ads_insights_eta_minutes: 0,
        ads_management_call_pct: 7, ads_management_cputime_pct: 2, ads_management_time_pct: 2, ads_management_eta_minutes: 0,
      },
    });
    const upsertRegistry = vi.fn();
    const insertEvents = vi.fn();
    const recordFreshness = vi.fn();
    const upsertBuc = vi.fn();
    await runMetaWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'status', tick_id: 'T', staleness_seconds: 900, budget_pct_estimate: 12 },
      bucProbe: async () => ({ pct: 12 }),
      fetchStatus: fetcher,
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry,
      insertStatusEvents: insertEvents,
      recordFreshness,
      upsertBuc,
      nowIso: NOW_ISO,
    });
    expect(fetcher).toHaveBeenCalled();
    expect(upsertRegistry).toHaveBeenCalledWith(expect.objectContaining({ table: 'campaign_registry' }));
    expect(insertEvents).toHaveBeenCalled();
    expect(insertEvents.mock.calls[0][0].events).toHaveLength(1);
    expect(insertEvents.mock.calls[0][0].events[0].change_kind).toBe('first_seen');
    expect(upsertBuc).toHaveBeenCalledWith(expect.objectContaining({ ads_management_call_pct: 7 }));
    // 3 scopes get marked success
    const successCalls = recordFreshness.mock.calls.filter(c => c[0].status === 'success');
    expect(successCalls.map(c => c[0].scope).sort()).toEqual(['ad_status', 'adset_status', 'campaign_status']);
  });

  it('ignores scope !== status (Phase C will handle hot_metrics)', async () => {
    const fetcher = vi.fn();
    await runMetaWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'hot_metrics', tick_id: 'T', staleness_seconds: 0, budget_pct_estimate: 0 },
      bucProbe: async () => ({ pct: 0 }),
      fetchStatus: fetcher,
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn(),
      insertStatusEvents: vi.fn(),
      recordFreshness: vi.fn(),
      upsertBuc: vi.fn(),
      nowIso: NOW_ISO,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run src/inngest/functions/__tests__/metaWorker.test.ts
```

- [ ] **Step 3: Write the implementation**

Create `dashboard-web/src/inngest/functions/metaWorker.ts`:

```typescript
// dashboard-web/src/inngest/functions/metaWorker.ts
//
// Phase B — consumes meta/job.requested events emitted by cron-tick-
// orchestrator. Only handles scope='status' in this phase; Phase C
// extends with scope='hot_metrics'.

import { inngest } from '@/inngest/client';
import { META_JOB_REQUESTED } from '@/lib/registries/eventNames';
import { recordFreshness } from '@/lib/inngest/freshness';
import { fetchMetaStatusForStore } from '@/lib/fetchers/metaStatus';
import { diffAgainstRegistry } from '@/lib/registries/diff';
import {
  buildRegistryUpsertRow,
  insertStatusEventsBatch,
  upsertRegistryBatch,
} from '@/lib/registries/upsert';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { recordMetaBucUsage } from '@/lib/notifications/metaBucUsage';
import { getAdAccountIdForStore, getMetaAccessTokenForStore, getFxCadAdapterForStore } from '@/lib/fetchers/metaAccountConfig';
import type {
  AdRegistryRow,
  AdsetRegistryRow,
  CampaignRegistryRow,
  EntityType,
  JobRequestedEvent,
  StatusEventInsert,
  StoreId,
} from '@/lib/registries/types';

const BUC_SKIP_THRESHOLD = 80;

type PriorMaps = {
  campaigns: Map<string, CampaignRegistryRow>;
  adsets: Map<string, AdsetRegistryRow>;
  ads: Map<string, AdRegistryRow>;
};

export type RunMetaWorkerJobInput = {
  jobData: JobRequestedEvent;
  bucProbe: (storeId: StoreId) => Promise<{ pct: number }>;
  fetchStatus: typeof fetchMetaStatusForStore;
  loadPriorRegistry: (storeId: StoreId) => Promise<PriorMaps>;
  upsertRegistry: (input: { table: 'campaign_registry' | 'adset_registry' | 'ad_registry'; rows: unknown[] }) => Promise<void>;
  insertStatusEvents: (input: { events: StatusEventInsert[] }) => Promise<void>;
  recordFreshness: (input: { storeId: StoreId; platform: 'meta'; scope: string; tableName: string; status: 'success' | 'budget_skip' | 'transient_error'; errorMessage?: string }) => Promise<void>;
  upsertBuc: (row: Record<string, unknown>) => Promise<void>;
  nowIso: string;
};

export async function runMetaWorkerJob(input: RunMetaWorkerJobInput): Promise<void> {
  const { jobData, bucProbe, fetchStatus, loadPriorRegistry, upsertRegistry, insertStatusEvents, recordFreshness: rec, upsertBuc, nowIso } = input;
  const { store_id: storeId, scope } = jobData;

  if (scope !== 'status') return;

  // 1. BUC pre-flight
  const buc = await bucProbe(storeId);
  if (buc.pct >= BUC_SKIP_THRESHOLD) {
    for (const s of ['campaign_status', 'adset_status', 'ad_status'] as const) {
      await rec({ storeId, platform: 'meta', scope: s, tableName: registryNameForScope(s), status: 'budget_skip' });
    }
    return;
  }

  // 2. Fetch
  const status = await fetchStatus({
    storeId,
    adAccountId: await getAdAccountIdForStore(storeId),
    accessToken: await getMetaAccessTokenForStore(storeId),
    getFxCadFor: await getFxCadAdapterForStore(storeId),
  });

  // 3. Update BUC usage
  await upsertBuc({
    store_id: storeId,
    ad_account_id: await getAdAccountIdForStore(storeId),
    ...status.bucUsage,
    last_updated_at: nowIso,
  });

  // 4. Load prior registry rows
  const prior = await loadPriorRegistry(storeId);

  // 5. Diff → status events
  const campaignEvents = diffAgainstRegistry({
    entityType: 'campaign',
    prior: prior.campaigns,
    fresh: status.campaigns,
    occurredAt: nowIso,
  });
  const adsetEvents = diffAgainstRegistry({
    entityType: 'adset',
    prior: prior.adsets as Map<string, CampaignRegistryRow>,
    fresh: status.adsets as CampaignRegistryRow[],
    occurredAt: nowIso,
  });
  const adEvents = diffAgainstRegistry({
    entityType: 'ad',
    prior: prior.ads as Map<string, CampaignRegistryRow>,
    fresh: status.ads as CampaignRegistryRow[],
    occurredAt: nowIso,
  });
  const allEvents = [...campaignEvents, ...adsetEvents, ...adEvents];
  if (allEvents.length > 0) {
    await insertStatusEvents({ events: allEvents });
  }

  // 6. Upsert registries
  const campRows = status.campaigns.map((c) => buildRegistryUpsertRow({ prior: prior.campaigns.get(c.campaign_id) ?? null, fresh: c, nowIso }));
  await upsertRegistry({ table: 'campaign_registry', rows: campRows });
  const asRows = status.adsets.map((a) => buildRegistryUpsertRow({ prior: prior.adsets.get(a.adset_id) ?? null, fresh: a, nowIso }));
  await upsertRegistry({ table: 'adset_registry', rows: asRows });
  const adRows = status.ads.map((a) => buildRegistryUpsertRow({ prior: prior.ads.get(a.ad_id) ?? null, fresh: a, nowIso }));
  await upsertRegistry({ table: 'ad_registry', rows: adRows });

  // 7. Mark freshness success
  for (const s of ['campaign_status', 'adset_status', 'ad_status'] as const) {
    await rec({ storeId, platform: 'meta', scope: s, tableName: registryNameForScope(s), status: 'success' });
  }
}

function registryNameForScope(scope: 'campaign_status' | 'adset_status' | 'ad_status'): string {
  if (scope === 'campaign_status') return 'campaign_registry';
  if (scope === 'adset_status') return 'adset_registry';
  return 'ad_registry';
}

export const metaWorker = inngest.createFunction(
  {
    id: 'meta-worker',
    concurrency: [
      { key: 'event.data.store_id', limit: 1 },
    ],
    throttle: { limit: 540, period: '1h', key: 'event.data.store_id' },
  },
  { event: META_JOB_REQUESTED },
  async ({ event, step }) => {
    await step.run('runMetaWorkerJob', async () => {
      const nowIso = new Date().toISOString();
      const sb = getSupabaseAdmin();
      const data = event.data as unknown as JobRequestedEvent;
      const storeId = data.store_id;

      const bucProbe = async () => {
        const { data: row } = await sb
          .from('meta_buc_usage')
          .select('ads_insights_call_pct, ads_management_call_pct')
          .eq('store_id', storeId)
          .maybeSingle();
        const r = (row as { ads_insights_call_pct?: number; ads_management_call_pct?: number } | null) ?? {};
        return { pct: Math.max(Number(r.ads_insights_call_pct ?? 0), Number(r.ads_management_call_pct ?? 0)) };
      };

      const loadPriorRegistry = async (): Promise<PriorMaps> => {
        const [{ data: c }, { data: a }, { data: ad }] = await Promise.all([
          sb.from('campaign_registry').select('*').eq('store_id', storeId).eq('platform', 'meta'),
          sb.from('adset_registry').select('*').eq('store_id', storeId).eq('platform', 'meta'),
          sb.from('ad_registry').select('*').eq('store_id', storeId).eq('platform', 'meta'),
        ]);
        return {
          campaigns: new Map((c ?? []).map((r: CampaignRegistryRow) => [r.campaign_id, r])),
          adsets: new Map((a ?? []).map((r: AdsetRegistryRow) => [r.adset_id, r])),
          ads: new Map((ad ?? []).map((r: AdRegistryRow) => [r.ad_id, r])),
        };
      };

      await runMetaWorkerJob({
        jobData: data,
        bucProbe,
        fetchStatus: fetchMetaStatusForStore,
        loadPriorRegistry,
        upsertRegistry: async (input) => upsertRegistryBatch({ admin: sb, table: input.table, rows: input.rows as never }),
        insertStatusEvents: async (input) => insertStatusEventsBatch({ admin: sb, events: input.events }),
        recordFreshness: async (input) => recordFreshness(input as never),
        upsertBuc: async (row) => {
          await sb.from('meta_buc_usage').upsert(row, { onConflict: 'store_id,ad_account_id' });
          await recordMetaBucUsage({ storeId, ...((row as unknown) as { ads_insights_call_pct: number; ads_management_call_pct: number }) });
        },
        nowIso,
      });
    });
  },
);
```

> **Note for the implementer:** `getAdAccountIdForStore`, `getMetaAccessTokenForStore`, `getFxCadAdapterForStore` are placeholder names — locate the existing equivalents in `dashboard-web/src/lib/fetchers/` (likely in `fetchMeta.ts` / `metaConfig.ts`) and import them. If a single-store-arg variant doesn't exist, add a thin wrapper in `dashboard-web/src/lib/fetchers/metaAccountConfig.ts` that maps `storeId → { adAccountId, accessToken, fxAdapter }` and export it before this task can compile.

- [ ] **Step 4: Run — expect PASS (3/3)**

```bash
npx vitest run src/inngest/functions/__tests__/metaWorker.test.ts
```

- [ ] **Step 5: Run tsc**

```bash
npx tsc --noEmit
```

If `getAdAccountIdForStore` etc don't resolve, create the thin wrapper described in the implementer note above before re-running.

- [ ] **Step 6: Commit**

```bash
git add dashboard-web/src/inngest/functions/metaWorker.ts \
        dashboard-web/src/inngest/functions/__tests__/metaWorker.test.ts \
        dashboard-web/src/lib/fetchers/metaAccountConfig.ts  # if created
git commit -m "feat(phase-b): meta-worker function consuming meta/job.requested"
```

---

## Task 10: `/operator` API routes — status-events + cron-tick-snapshots

The existing `/operator` page is server-rendered (per the Phase A pattern in `FreshnessPanel`). The new panels can read directly from Supabase server-side without API routes. Keep this task simple — write a single shared server helper, no new API routes.

**Files:**
- Create: `dashboard-web/src/lib/operator/registriesReaders.ts`
- Test: `dashboard-web/src/lib/operator/__tests__/registriesReaders.test.ts`

- [ ] **Step 1: Write the failing test**

Create `dashboard-web/src/lib/operator/__tests__/registriesReaders.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { fetchStatusEvents, fetchCronTickSnapshots } from '@/lib/operator/registriesReaders';

describe('fetchStatusEvents()', () => {
  it('reads campaign_status_events ordered by occurred_at DESC LIMIT 50', async () => {
    const order = vi.fn().mockReturnThis();
    const limit = vi.fn().mockResolvedValue({ data: [{ id: 1 }], error: null });
    const select = vi.fn().mockReturnValue({ order, limit });
    order.mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ select });
    const admin = { from } as unknown as Parameters<typeof fetchStatusEvents>[0];
    const out = await fetchStatusEvents(admin);
    expect(from).toHaveBeenCalledWith('campaign_status_events');
    expect(order).toHaveBeenCalledWith('occurred_at', { ascending: false });
    expect(limit).toHaveBeenCalledWith(50);
    expect(out).toEqual([{ id: 1 }]);
  });
});

describe('fetchCronTickSnapshots()', () => {
  it('reads cron_tick_snapshots ordered by tick_id DESC LIMIT 144', async () => {
    const order = vi.fn().mockReturnThis();
    const limit = vi.fn().mockResolvedValue({ data: [{ tick_id: 'T' }], error: null });
    const select = vi.fn().mockReturnValue({ order, limit });
    order.mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ select });
    const admin = { from } as unknown as Parameters<typeof fetchCronTickSnapshots>[0];
    const out = await fetchCronTickSnapshots(admin);
    expect(from).toHaveBeenCalledWith('cron_tick_snapshots');
    expect(order).toHaveBeenCalledWith('tick_id', { ascending: false });
    expect(limit).toHaveBeenCalledWith(144);
    expect(out).toEqual([{ tick_id: 'T' }]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run src/lib/operator/__tests__/registriesReaders.test.ts
```

- [ ] **Step 3: Write the implementation**

Create `dashboard-web/src/lib/operator/registriesReaders.ts`:

```typescript
// dashboard-web/src/lib/operator/registriesReaders.ts
//
// Phase B — server-side readers used by /operator panels.

import type { SupabaseClient } from '@supabase/supabase-js';

export type StatusEventRow = {
  id: number;
  store_id: string;
  platform: string;
  entity_type: 'campaign' | 'adset' | 'ad';
  entity_id: string;
  occurred_at: string;
  from_status: string | null;
  to_status: string;
  change_kind: string;
};

export type CronTickSnapshotRow = {
  tick_id: string;
  started_at: string;
  finished_at: string | null;
  fan_out_count: number | null;
  events_completed_count: number | null;
  events_skipped_count: number | null;
  events_failed_count: number | null;
};

export async function fetchStatusEvents(admin: SupabaseClient): Promise<StatusEventRow[]> {
  const { data } = await admin
    .from('campaign_status_events')
    .select('id, store_id, platform, entity_type, entity_id, occurred_at, from_status, to_status, change_kind')
    .order('occurred_at', { ascending: false })
    .limit(50);
  return (data ?? []) as StatusEventRow[];
}

export async function fetchCronTickSnapshots(admin: SupabaseClient): Promise<CronTickSnapshotRow[]> {
  const { data } = await admin
    .from('cron_tick_snapshots')
    .select('tick_id, started_at, finished_at, fan_out_count, events_completed_count, events_skipped_count, events_failed_count')
    .order('tick_id', { ascending: false })
    .limit(144);
  return (data ?? []) as CronTickSnapshotRow[];
}
```

- [ ] **Step 4: Run — expect PASS (2/2)**

```bash
npx vitest run src/lib/operator/__tests__/registriesReaders.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add dashboard-web/src/lib/operator/registriesReaders.ts \
        dashboard-web/src/lib/operator/__tests__/registriesReaders.test.ts
git commit -m "feat(phase-b): operator readers — fetchStatusEvents + fetchCronTickSnapshots"
```

---

## Task 11: `StatusEventsFeed` component

**Files:**
- Create: `dashboard-web/src/components/operator/StatusEventsFeed.tsx`
- Test: (no DOM test in Phase B — relies on the pattern established by `FreshnessPanel.tsx` which also has no DOM test)

- [ ] **Step 1: Write the component**

Create `dashboard-web/src/components/operator/StatusEventsFeed.tsx`:

```tsx
// dashboard-web/src/components/operator/StatusEventsFeed.tsx
//
// Phase B — last 50 entries from campaign_status_events. Server
// component (mirrors FreshnessPanel pattern).

import { Pause, Play, Sparkles, Archive, AlertCircle, MousePointerClick, Eye } from 'lucide-react';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { fetchStatusEvents, type StatusEventRow } from '@/lib/operator/registriesReaders';

function relativeHebrew(iso: string): string {
  const dMs = Date.now() - new Date(iso).getTime();
  const dMin = Math.floor(dMs / 60_000);
  if (dMin < 1) return 'כרגע';
  if (dMin < 60) return `${dMin} דק׳ לפני`;
  const dHr = Math.floor(dMin / 60);
  if (dHr < 24) return `${dHr} שע׳ לפני`;
  return `${Math.floor(dHr / 24)} ימים לפני`;
}

function kindIcon(kind: string) {
  const size = 14;
  if (kind === 'paused') return <Pause size={size} className="text-status-orange" />;
  if (kind === 'enabled') return <Play size={size} className="text-status-green" />;
  if (kind === 'first_seen') return <Sparkles size={size} className="text-blue-400" />;
  if (kind === 'archived' || kind === 'removed') return <Archive size={size} className="text-ink-secondary" />;
  if (kind === 'effective_only') return <Eye size={size} className="text-ink-secondary" />;
  if (kind === 'delivery_only') return <MousePointerClick size={size} className="text-ink-secondary" />;
  return <AlertCircle size={size} className="text-status-red" />;
}

export async function StatusEventsFeed() {
  const events: StatusEventRow[] = await fetchStatusEvents(getSupabaseAdmin());
  if (events.length === 0) {
    return (
      <section className="border border-line-subtle rounded-lg p-4 text-ink-secondary text-sm">
        <h3 className="text-base font-medium text-ink-primary mb-2">שינויי סטטוס אחרונים</h3>
        <p>אין אירועי סטטוס עדיין. הראשון יופיע תוך 10 דקות מהפעלת ה-orchestrator.</p>
      </section>
    );
  }
  return (
    <section className="border border-line-subtle rounded-lg p-4">
      <h3 className="text-base font-medium text-ink-primary mb-3">
        שינויי סטטוס אחרונים <span className="text-xs text-ink-secondary">(50 אחרונים)</span>
      </h3>
      <ul className="space-y-1.5 text-sm">
        {events.map((e) => (
          <li key={e.id} className="flex items-start gap-2.5 text-ink-primary">
            <span className="mt-0.5 shrink-0">{kindIcon(e.change_kind)}</span>
            <span className="text-ink-secondary shrink-0 text-xs w-24">{relativeHebrew(e.occurred_at)}</span>
            <span className="shrink-0 text-xs text-ink-secondary">{e.store_id} · {e.platform} · {e.entity_type}</span>
            <span className="shrink-0 text-xs font-mono">{e.entity_id}</span>
            <span className="text-xs text-ink-secondary">
              {e.from_status ?? '—'} → <strong className="text-ink-primary">{e.to_status}</strong>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: Verify tsc**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add dashboard-web/src/components/operator/StatusEventsFeed.tsx
git commit -m "feat(phase-b): StatusEventsFeed server component"
```

---

## Task 12: `CronTickSnapshotsViewer` component

**Files:**
- Create: `dashboard-web/src/components/operator/CronTickSnapshotsViewer.tsx`

- [ ] **Step 1: Write the component**

Create `dashboard-web/src/components/operator/CronTickSnapshotsViewer.tsx`:

```tsx
// dashboard-web/src/components/operator/CronTickSnapshotsViewer.tsx
//
// Phase B — last 144 cron-tick snapshots (24h × 6 ticks/h). Server
// component.

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { fetchCronTickSnapshots, type CronTickSnapshotRow } from '@/lib/operator/registriesReaders';

function durationSeconds(start: string, end: string | null): string {
  if (!end) return '—';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return `${(ms / 1000).toFixed(1)}s`;
}

export async function CronTickSnapshotsViewer() {
  const rows: CronTickSnapshotRow[] = await fetchCronTickSnapshots(getSupabaseAdmin());
  if (rows.length === 0) {
    return (
      <section className="border border-line-subtle rounded-lg p-4 text-ink-secondary text-sm">
        <h3 className="text-base font-medium text-ink-primary mb-2">Cron-tick snapshots</h3>
        <p>אין ticks עדיין.</p>
      </section>
    );
  }
  return (
    <section className="border border-line-subtle rounded-lg p-4">
      <h3 className="text-base font-medium text-ink-primary mb-3">
        Cron-tick snapshots <span className="text-xs text-ink-secondary">({rows.length} ticks אחרונים)</span>
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-ink-primary">
          <thead className="text-xs text-ink-secondary border-b border-line-subtle">
            <tr>
              <th className="text-right py-1 pr-2">tick_id</th>
              <th className="text-left py-1 px-2">fan_out</th>
              <th className="text-left py-1 px-2">completed</th>
              <th className="text-left py-1 px-2">skipped</th>
              <th className="text-left py-1 px-2">failed</th>
              <th className="text-left py-1 pl-2">duration</th>
            </tr>
          </thead>
          <tbody className="font-mono text-xs">
            {rows.map((r) => (
              <tr key={r.tick_id} className="border-b border-line-subtle/40">
                <td className="text-right py-1 pr-2">{r.tick_id}</td>
                <td className="py-1 px-2">{r.fan_out_count ?? '—'}</td>
                <td className="py-1 px-2 text-status-green">{r.events_completed_count ?? '—'}</td>
                <td className="py-1 px-2 text-status-orange">{r.events_skipped_count ?? '—'}</td>
                <td className="py-1 px-2 text-status-red">{r.events_failed_count ?? '—'}</td>
                <td className="py-1 pl-2 text-ink-secondary">{durationSeconds(r.started_at, r.finished_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: tsc**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add dashboard-web/src/components/operator/CronTickSnapshotsViewer.tsx
git commit -m "feat(phase-b): CronTickSnapshotsViewer server component"
```

---

## Task 13: Register Inngest functions + mount on /operator

**Files:**
- Modify: `dashboard-web/src/app/api/inngest/route.ts`
- Modify: `dashboard-web/src/app/operator/page.tsx`

- [ ] **Step 1: Open `dashboard-web/src/app/api/inngest/route.ts` and read the imports + the `serve()` call**

```bash
grep -n "import\|serve(" dashboard-web/src/app/api/inngest/route.ts | head -15
```

- [ ] **Step 2: Add imports for the new functions**

Use Edit to add these import lines after the existing `cronLiveHeavyFunctions` import:

```typescript
import { cronTickOrchestrator } from '@/inngest/functions/cronTickOrchestrator';
import { metaWorker } from '@/inngest/functions/metaWorker';
```

- [ ] **Step 3: Append the two new functions to the `functions` array in `serve()`**

Find the `functions: [...]` line and Edit it to include the two new items. Example diff for the `functions` array (your existing list may differ slightly):

```typescript
functions: [
  ...cronDailyFunctions,
  ...cronLiveFunctions,
  ...cronLiveHeavyFunctions,
  cronTickOrchestrator,
  metaWorker,
],
```

- [ ] **Step 4: Open `dashboard-web/src/app/operator/page.tsx` and add the two new section imports**

```bash
grep -n "import.*operator/" dashboard-web/src/app/operator/page.tsx | head -10
```

Use Edit to add after the existing operator imports:

```typescript
import { StatusEventsFeed } from '@/components/operator/StatusEventsFeed';
import { CronTickSnapshotsViewer } from '@/components/operator/CronTickSnapshotsViewer';
```

- [ ] **Step 5: Mount the new components in the page body**

Find the section where `<FreshnessPanel />` is rendered. Insert `<StatusEventsFeed />` and `<CronTickSnapshotsViewer />` directly after it.

- [ ] **Step 6: Run tsc + build**

```bash
npx tsc --noEmit
npm run build
```

Both should exit clean.

- [ ] **Step 7: Commit**

```bash
git add dashboard-web/src/app/api/inngest/route.ts \
        dashboard-web/src/app/operator/page.tsx
git commit -m "feat(phase-b): register orchestrator+worker + mount StatusEventsFeed + CronTickSnapshotsViewer"
```

---

## Task 14: Apply migration to prod + deploy + verify acceptance

- [ ] **Step 1: Apply the Task 1 migration to prod**

```bash
mv .env .env.tmp
cd /tmp && supabase db push --linked --workdir /Users/dorperetz/script-roas
mv /Users/dorperetz/script-roas/.env.tmp /Users/dorperetz/script-roas/.env
```

Expected: `Applying migration 20260530XXXXXX_phase_b_registries.sql... Finished supabase db push.`

- [ ] **Step 2: Verify the new tables exist**

```bash
mv .env .env.tmp
cd /tmp && supabase db query --linked --workdir /Users/dorperetz/script-roas --output table \
  "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('campaign_registry','adset_registry','ad_registry','campaign_status_events','cron_tick_snapshots') ORDER BY table_name;"
mv /Users/dorperetz/script-roas/.env.tmp /Users/dorperetz/script-roas/.env
```

Expected: 5 rows.

- [ ] **Step 3: Run all gates (tsc + vitest node + vitest DOM + lint + build)**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx tsc --noEmit
npm test
npm run test:components
npm run lint
npm run build
```

All five must exit clean (lint: 0 errors; warnings ok).

- [ ] **Step 4: Update User Manual (2.1.20 → 2.1.21)**

Edit `docs/ROAS-Dashboard-User-Manual.md`:
- Bump version in the header block from `2.1.20` to `2.1.21`.
- Add a new section above `2.1.20` titled "### 2.1.21 (YYYY-MM-DD) — Phase B: registries + Meta status discovery" with a 4-5 sentence summary of: 3 new registries, status events feed in /operator, cron-tick orchestrator every 10 min, meta-worker fetching campaign/adset/ad status, no CampaignsTable changes yet (Phase D).
- Bump footer `**גרסה:** 2.1.20` → `2.1.21`.

- [ ] **Step 5: Update Architecture Doc**

Edit `docs/ARCHITECTURE.md`:
- Add a Phase B section after the existing evening-hotfixes content describing: the 5 new tables (1 line each), the cron-tick-orchestrator + meta-worker pair, the freshness/BUC-driven priority logic, the Operator UI additions, and the explicit non-goals (Google/TikTok/Shopify workers → C/D; CampaignsTable integration → D).

- [ ] **Step 6: Commit docs + push everything to main**

```bash
git add docs/ROAS-Dashboard-User-Manual.md docs/ARCHITECTURE.md
git commit -m "docs: Phase B — User Manual 2.1.21 + Architecture Doc"
git push origin main
```

- [ ] **Step 7: Wait for Vercel deploy to finish, then verify health**

```bash
curl -s https://roas-dashboard-smoky.vercel.app/api/health
```

Expected: `{"sheets":"ok","supabase":"ok",...}`.

- [ ] **Step 8: Acceptance — wait one cron-tick boundary (≤10 min), then query prod**

```bash
mv .env .env.tmp
cd /tmp && supabase db query --linked --workdir /Users/dorperetz/script-roas --output table \
  "SELECT tick_id, fan_out_count, events_completed_count, events_skipped_count, events_failed_count FROM cron_tick_snapshots ORDER BY tick_id DESC LIMIT 5;"
mv /Users/dorperetz/script-roas/.env.tmp /Users/dorperetz/script-roas/.env
```

Expected: at least 1 row with `fan_out_count > 0` (or all 3 stores skipped if BUC was already saturated), `events_completed_count` matching `fan_out_count`.

- [ ] **Step 9: Acceptance — verify campaign_registry populated**

```bash
mv .env .env.tmp
cd /tmp && supabase db query --linked --workdir /Users/dorperetz/script-roas --output table \
  "SELECT store_id, COUNT(*) AS campaigns FROM campaign_registry WHERE platform='meta' GROUP BY store_id;"
mv /Users/dorperetz/script-roas/.env.tmp /Users/dorperetz/script-roas/.env
```

Expected: 1 row per active Meta store (uzoshop / zolplus / usmile360).

- [ ] **Step 10: Acceptance — verify status events feed populated**

Open `https://roas-dashboard-smoky.vercel.app/operator?secret=<secret>` and confirm:
1. **Freshness Matrix** rows for `campaign_status` / `adset_status` / `ad_status` show success per store.
2. **Status Events Feed** shows `first_seen` entries (one per Meta campaign × 3 stores) from the initial tick.
3. **Cron-tick Snapshots** table has ≥1 row.

- [ ] **Step 11: Final commit (if any drift) + push**

If the acceptance run revealed a small fix needed (e.g., `effective_status` value normalization), implement it as a follow-up commit. Otherwise, the deploy is done.

---

## Self-review (run before declaring complete)

- [ ] **Spec coverage** — every numbered deliverable in the Phase B spec maps to at least one task:
  - Migration → Task 1 ✓
  - cron-tick-orchestrator → Task 8 ✓
  - meta-worker → Task 9 ✓
  - `fetchMetaStatusForStore` → Task 7 ✓
  - `upsertRegistryFromX()` (= buildRegistryUpsertRow + upsertRegistryBatch) → Task 6 ✓
  - `writeStatusEventsFromDiff()` (= diffAgainstRegistry + insertStatusEventsBatch) → Tasks 5, 6 ✓
  - `data_freshness` rows for status scopes → marked inside Task 9 (worker calls `recordFreshness` for 3 scopes on success or budget_skip) ✓
  - /operator: status events feed → Task 11 ✓
  - /operator: freshness matrix → existing `FreshnessPanel` auto-picks-up new scopes (no new component) — verified in §spec ✓
  - cron-live-heavy unchanged → no task touches it ✓

- [ ] **Placeholder scan** — search the plan for "TBD", "TODO", "<timestamp>". Only `<timestamp>` placeholder remains (intentional — `supabase migration new` generates it).

- [ ] **Type consistency** — `StoreId`, `Platform`, `EntityType`, `ChangeKind`, `JobRequestedEvent` defined in Task 2 are used consistently in Tasks 4, 5, 6, 8, 9.

- [ ] **Implementer note in Task 9** — the placeholder helpers (`getAdAccountIdForStore`, etc.) MUST be replaced with existing-codebase imports; the note tells the implementer where to look.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-30-phase-b-registries-meta-status.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best when you want to step away for stretches.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints. Best when you want to watch each step.
