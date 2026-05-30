# Meta API budget gating — header-aware self-throttling + cron stagger

**Date:** 2026-05-29
**Status:** Approved (brainstorm complete, awaiting implementation plan)

## Predecessor context

Phase 13.9 (commit `33d1fc2`, 2026-05-27) shipped `cron-live-heavy` — a 30-min Inngest cron that refreshes `campaigns_daily` + `ads_daily` for today + yesterday across 3 stores (uzoshop, zolplus, usmile360). The function dispatches via a per-store factory ([cronLiveHeavy.ts:348-369](dashboard-web/src/inngest/functions/cronLiveHeavy.ts#L348-L369)); all 3 store crons fire on the same `*/30 * * * *` schedule, with no inter-store coordination.

Per-tick fan-out per store:
- 2 paginated insights fetches (adsets + ads, up to 50 pages × 500 rows)
- 3 budget fetches (account currency + campaigns + adsets, also paginated)
- × 2 dates (today + yesterday)

When traffic is heavy in any single store, pagination spikes the per-tick call count. Combined with 3 stores firing simultaneously, the app-level Meta quota (~600 calls/h for tier-2 apps per existing inline comment in [cronLiveHeavy.ts:354-356](dashboard-web/src/inngest/functions/cronLiveHeavy.ts#L354-L356)) is hit.

Existing protection at [withBackoff.ts:1-51](dashboard-web/src/lib/fetchers/withBackoff.ts#L1-L51) handles **per-request** 429 backoff (up to 3 retries + `Retry-After` honoring) but has no **global** budget awareness — it retries the SAME call, then propagates the failure to the cron, which moves on to the NEXT call that also hits the wall.

Production today (2026-05-29 13:30) fired a Meta `cron_live_heavy_rate_limit` alert for uzoshop with error code 4 / subcode 1504022 "Application request limit reached" (seen 4 times, alert #3 — the existing 6-hour WhatsApp throttle is suppressing the rest). This spec fixes the underlying pressure, not the alert UX.

## Goals

1. The `cron-live-heavy` and `cron-daily` Inngest jobs **never** drive the Meta app quota to 100% — they back off pre-emptively at 80% and rely on the next tick to fill the data gap.
2. The dashboard `/operator` page shows the current Meta API budget at a glance, so the operator can verify the system is self-regulating rather than failing silently.
3. Data correctness contract preserved — no partial/bad rows written; `(date, store, …)` upserts mean a deferred tick is filled in on the next successful tick.
4. The 3 per-store cron-live-heavy ticks are staggered by 10 minutes so they don't pile their pagination spikes on top of each other.

## Non-goals

- Changing the alert UX, throttle rules, or the WhatsApp template.
- Replacing the existing `fetchWithBackoff` mid-request retry behavior — the new wrapper composes around it.
- Per-BUC (Business Use Case) tracking from `x-business-use-case-usage` header. App-level `x-app-usage` is sufficient because the failing error is app-wide.
- Per-store rate limiting (Meta's app-level quota is shared across stores; per-store gating would not help).
- Google / TikTok budget gating. Different quota model; not the current pain point. If they start failing we'll spec separately.
- Increasing the freshness window beyond 30 min when budget is healthy. Tick cadence stays `*/30`.

## Design

### 1. Database — `meta_app_usage` singleton

New table holding the latest parsed `x-app-usage` snapshot:

```sql
CREATE TABLE meta_app_usage (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),     -- singleton row
  call_count_pct numeric NOT NULL DEFAULT 0,
  total_time_pct numeric NOT NULL DEFAULT 0,
  total_cputime_pct numeric NOT NULL DEFAULT 0,
  last_updated_at timestamptz NOT NULL DEFAULT now(),
  last_url text                                          -- last endpoint that updated this row (debug aid)
);
INSERT INTO meta_app_usage (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
```

Singleton via the `CHECK (id = 1)` constraint — only one row ever exists. Avoids "which row to read" questions on the consumer side. New migration file: `supabase/migrations/20260529100000_add_meta_app_usage.sql`.

### 2. New fetcher wrapper — `fetchMeta()`

Location: `dashboard-web/src/lib/fetchers/fetchMeta.ts` (new file, sibling of existing `withBackoff.ts`).

```typescript
import { fetchWithBackoff } from './withBackoff';
import { recordMetaUsage } from '@/lib/notifications/metaUsage';

export class MetaBudgetHighError extends Error {
  constructor(public readonly pct: number) {
    super(`META_BUDGET_HIGH: x-app-usage at ${pct.toFixed(1)}%; deferring to next tick`);
    this.name = 'MetaBudgetHighError';
  }
}

export const META_BUDGET_THRESHOLD_PCT = 80;

interface MetaAppUsage {
  call_count?: number;
  total_time?: number;
  total_cputime?: number;
}

/**
 * Meta API fetch wrapper. Composes around fetchWithBackoff to add
 * app-level quota awareness via the x-app-usage header that Meta
 * sends on every Graph API response.
 *
 * After every successful response, parses the header, persists the
 * snapshot to meta_app_usage, and throws MetaBudgetHighError when the
 * max of (call_count, total_time, total_cputime) >= META_BUDGET_THRESHOLD_PCT.
 *
 * On 429 (post-backoff exhaustion) returns the 429 response unchanged
 * so existing callers can still see status codes and message bodies.
 */
export async function fetchMeta(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetchWithBackoff(url, init);

  const usageRaw = res.headers.get('x-app-usage');
  if (usageRaw) {
    try {
      const usage = JSON.parse(usageRaw) as MetaAppUsage;
      const callPct = usage.call_count ?? 0;
      const timePct = usage.total_time ?? 0;
      const cpuPct = usage.total_cputime ?? 0;
      const maxPct = Math.max(callPct, timePct, cpuPct);

      // Fire-and-forget persist; don't block the request on Supabase round-trip
      void recordMetaUsage({ callPct, timePct, cpuPct, url });

      if (maxPct >= META_BUDGET_THRESHOLD_PCT) {
        throw new MetaBudgetHighError(maxPct);
      }
    } catch (e) {
      if (e instanceof MetaBudgetHighError) throw e;
      // Malformed header — log + continue (don't poison the caller)
      console.warn('[fetchMeta] failed to parse x-app-usage header:', usageRaw, e);
    }
  }

  return res;
}
```

`recordMetaUsage` is a small helper at `dashboard-web/src/lib/notifications/metaUsage.ts`:

```typescript
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export async function recordMetaUsage(snapshot: {
  callPct: number;
  timePct: number;
  cpuPct: number;
  url: string;
}) {
  try {
    const sb = getSupabaseAdmin();
    await sb.from('meta_app_usage').upsert({
      id: 1,
      call_count_pct: snapshot.callPct,
      total_time_pct: snapshot.timePct,
      total_cputime_pct: snapshot.cpuPct,
      last_url: snapshot.url,
      last_updated_at: new Date().toISOString(),
    });
  } catch (e) {
    // Singleton upsert should never fail in practice; if it does, don't break the fetch
    console.warn('[recordMetaUsage] upsert failed:', e);
  }
}

export async function getMetaUsage(): Promise<{
  callPct: number;
  timePct: number;
  cpuPct: number;
  maxPct: number;
  lastUpdatedAt: string | null;
} | null> {
  try {
    const sb = getSupabaseAdmin();
    const { data } = await sb
      .from('meta_app_usage')
      .select('call_count_pct, total_time_pct, total_cputime_pct, last_updated_at')
      .eq('id', 1)
      .maybeSingle();
    if (!data) return null;
    const callPct = data.call_count_pct ?? 0;
    const timePct = data.total_time_pct ?? 0;
    const cpuPct = data.total_cputime_pct ?? 0;
    return {
      callPct, timePct, cpuPct,
      maxPct: Math.max(callPct, timePct, cpuPct),
      lastUpdatedAt: data.last_updated_at ?? null,
    };
  } catch (e) {
    console.warn('[getMetaUsage] read failed:', e);
    return null;
  }
}
```

### 3. Pre-flight skip in `cron-live-heavy` + `cron-daily`

Before any Meta fetch in a tick, read the singleton:

```typescript
// cronLiveHeavy.ts — inside runHeavyForStore(), before Step A's Meta fetches
const usage = await getMetaUsage();
const STALE_THRESHOLD_MS = 15 * 60 * 1000; // 15 min
const isFresh = usage?.lastUpdatedAt
  && Date.now() - new Date(usage.lastUpdatedAt).getTime() < STALE_THRESHOLD_MS;

if (usage && isFresh && usage.maxPct >= META_BUDGET_THRESHOLD_PCT) {
  // Defer Meta fetches; Google + TikTok still proceed
  console.log(`[cron-live-heavy] skipping Meta for ${storeId} — app usage at ${usage.maxPct.toFixed(1)}%`);
  failures.push({
    provider: 'meta',
    storeId,
    date,
    errorMsg: `META_BUDGET_HIGH (pre-flight): app usage at ${usage.maxPct.toFixed(1)}% (call_count=${usage.callPct.toFixed(1)}%, total_time=${usage.timePct.toFixed(1)}%, total_cputime=${usage.cpuPct.toFixed(1)}%)`,
    kind: 'budget_skip',
  });
  // Continue with Google/TikTok fetches; meta.adSetRows + meta.adRows stay empty
} else {
  // Proceed with the existing Meta fetch block
}
```

The `isFresh` gate prevents permanent skip if the singleton becomes stale (e.g., a deploy reset Supabase or the row hasn't been updated in hours). If stale, we attempt the fetch optimistically — the in-flight `fetchMeta` will catch the high-budget case via the header.

Same pattern integrates into `cron-daily` and `cron-live` (the existing `*/10` cron — needs verification that it actually calls Meta; if it does, gating it too prevents bursts during minute-aligned hot zones).

### 4. Error classification — recognize `MetaBudgetHighError`

[detectAuthError.ts:99-146](dashboard-web/src/lib/notifications/detectAuthError.ts#L99-L146) already classifies Meta rate-limit errors via substring match. Add:

```typescript
// Inside isRateLimitError() for provider='meta':
if (errorMsg.includes('META_BUDGET_HIGH')) return true;
```

The token-failure notifier then routes our self-thrown error through the same WhatsApp throttle pipeline. **Optionally** flag budget skips with a different `operation` key (`cron_live_heavy_budget_skip` instead of `cron_live_heavy_rate_limit`) so the operator can distinguish "we throttled ourselves" from "Meta throttled us":

```typescript
const operation = errorMsg.includes('META_BUDGET_HIGH')
  ? 'cron_live_heavy_budget_skip'
  : 'cron_live_heavy_rate_limit';
```

`budget_skip` failures **do not fire WhatsApp** — they only log to the `token_failures` table so /operator can see them. The WhatsApp throttle path is gated on `operation !== 'cron_*_budget_skip'`. This is the operator's "graceful self-throttle" signal — no alert noise.

### 5. Cron stagger — split the per-store schedules

At [cronLiveHeavy.ts:348-369](dashboard-web/src/inngest/functions/cronLiveHeavy.ts#L348-L369) the factory currently emits identical `cron: 'TZ=Asia/Jerusalem */30 * * * *'` for all 3 stores. Update the factory to accept a `cronExpr` parameter:

```typescript
// New factory signature
function makeHeavyForStore(storeId: StoreId, cronExpr: string) {
  return inngest.createFunction(
    { id: `cron-live-heavy-${storeId}`, name: `Cron Live Heavy — ${storeId}`, ... },
    { cron: cronExpr },
    async ({ event, step }) => runHeavyForStore(storeId, step),
  );
}

// New exports
export const cronLiveHeavyUzoshop = makeHeavyForStore('uzoshop', 'TZ=Asia/Jerusalem 0,30 * * * *');
export const cronLiveHeavyZolplus = makeHeavyForStore('zolplus', 'TZ=Asia/Jerusalem 10,40 * * * *');
export const cronLiveHeavyUsmile  = makeHeavyForStore('usmile360', 'TZ=Asia/Jerusalem 20,50 * * * *');
```

Each store still gets 2 ticks per hour (30-min cadence preserved), but they're offset by 10 minutes. Inngest will register each as a separate scheduled function — no plumbing change to `runHeavyForStore`.

`cron-live` (`*/10`) and `cron-daily` (one tick a day) are NOT staggered — they're already a single function or single-tick.

### 6. `/operator` budget panel

Add a small card to `dashboard-web/src/app/operator/page.tsx` that reads the singleton row server-side and renders:

```
┌─ Meta API Budget ─────────────────────────┐
│ Call count: 42% ████░░░░░░ (last 1h)      │
│ Time:        18% ██░░░░░░░░                │
│ CPU time:    31% ███░░░░░░░                │
│                                            │
│ Updated 2 min ago                          │
│ Threshold: 80% (configurable)              │
└────────────────────────────────────────────┘
```

Color: green < 60%, amber 60-80%, red ≥ 80%. Last URL is hidden by default; reveal on hover/click for debugging.

Uses the existing `getMetaUsage()` helper from §2. Static rendering with a 30-sec stale-while-revalidate would be ideal but a simple server-component fetch is fine for v1.

### 7. Test strategy

#### Unit tests

- **`fetchMeta.test.ts`** — mock global fetch, return responses with various `x-app-usage` headers:
  - `{"call_count": 50}` → no throw, `recordMetaUsage` called with `callPct=50`.
  - `{"call_count": 80}` → throws `MetaBudgetHighError`, `recordMetaUsage` still called.
  - `{"call_count": 50, "total_time": 90}` → throws (max-of-three rule).
  - missing header → no throw, no record call.
  - malformed JSON → log warning, no throw, no record call.

- **`metaUsage.test.ts`** — mock Supabase admin:
  - `recordMetaUsage` upserts with id=1, all 4 columns.
  - `getMetaUsage` reads back; returns `null` if row missing; computes `maxPct` correctly.
  - Both functions swallow Supabase errors and log warnings (don't throw).

- **`detectAuthError.test.ts`** (existing file, add cases):
  - `isRateLimitError('meta', 'META_BUDGET_HIGH: ...')` → `true`.
  - Existing cases still return their original results.

#### Integration test

- **`cronLiveHeavyBudgetSkip.test.ts`** (new) — mocks `getMetaUsage` to return `{ maxPct: 85, lastUpdatedAt: <2 min ago> }`:
  - Assert: Meta fetchers are NOT called for this tick.
  - Assert: Google + TikTok fetchers ARE called.
  - Assert: `failures` contains a `budget_skip` entry with the right error message.
  - Assert: `notifyTokenFailure` is called with `operation='cron_live_heavy_budget_skip'`.
  - Assert: WhatsApp send is NOT triggered (the existing template send gate skips `budget_skip` operations).

- **`cronLiveHeavyBudgetStale.test.ts`** (new) — `getMetaUsage` returns `{ maxPct: 85, lastUpdatedAt: <2 hours ago> }`:
  - Assert: Meta fetchers ARE called (stale data triggers optimistic attempt).
  - Mock `fetchMeta` to throw `MetaBudgetHighError` on first call.
  - Assert: failure is classified as `cron_live_heavy_budget_skip` (the new throw path).

#### Manual production check

After deploy, the operator visits `/operator`, confirms the Meta API Budget panel renders, watches the percentages over a 30-min window to verify they're moving with cron ticks.

### 8. Migration sequence

1. Apply the new Supabase migration (`20260529100000_add_meta_app_usage.sql`). Pre-deploy — no code reads the table yet.
2. Ship the `fetchMeta` + `recordMetaUsage` + `getMetaUsage` helpers, plus tests. No fetcher is rewired yet — the wrapper exists but is unused.
3. Rewire the 4 Meta fetchers (`fetchMetaAdSetInsights`, `fetchMetaAdInsights`, `fetchMetaBudgets`, `fetchMetaSpendForDayLight`) from `fetchWithBackoff` → `fetchMeta`. After deploy: the `meta_app_usage` row starts updating live.
4. Add the pre-flight skip in `cron-live-heavy` (+ `cron-daily` if it calls Meta). Add `MetaBudgetHighError` substring to `isRateLimitError`. Split the WhatsApp send path on `operation`.
5. Update the cron stagger schedules.
6. Add the `/operator` budget panel.

Steps 1-2 are no-ops in production. Step 3 is the first live behavior change (Supabase row starts updating). Step 4 is the first cron-behavior change. Step 5 is the schedule change (re-registers Inngest functions). Step 6 is visual only.

## Risks

| Risk | Mitigation |
|---|---|
| Header parsing fails silently | Try/catch around `JSON.parse`; log warning; don't poison the caller. Test covers malformed header. |
| `recordMetaUsage` upsert latency adds to cron walltime | Fire-and-forget via `void recordMetaUsage(...)`; failures are logged but never propagated. |
| Singleton race when 3 stores upsert simultaneously | Last-writer-wins on the `(id=1)` row is fine — we only care about latest snapshot, not history. |
| Pre-flight read sees a value updated mid-tick by a sibling cron and skips wrongly | Acceptable: missing one tick is better than blowing the budget. Self-corrects on the next tick (10 min away post-stagger). |
| Stagger change re-registers Inngest functions and breaks existing schedules | Inngest treats function IDs as the identity; the IDs (`cron-live-heavy-uzoshop` etc.) don't change. Only the trigger expression changes. |
| The 15-min "freshness" window for the pre-flight check might be too long if the cron is silent (deploy, outage) | If `getMetaUsage` returns stale, we proceed optimistically. Worst case: one tick burns the budget; subsequent ticks fall into the in-flight throw path. |
| Stagger gives uzoshop unfair advantage (always fetches first) | Operator chooses store order. Recommend uzoshop first since it's the highest-traffic and most likely to push the budget — start with it so the others see updated state. |
| `cron-live` (`*/10`) also calls Meta and could keep budget hot between cron-live-heavy ticks | Add pre-flight check to `cron-live` too as part of step 4. Same code shape. |

## File touchpoints (anticipated)

```
supabase/migrations/20260529100000_add_meta_app_usage.sql            NEW (~25 lines)
dashboard-web/src/lib/fetchers/fetchMeta.ts                          NEW (~70 lines)
dashboard-web/src/lib/notifications/metaUsage.ts                     NEW (~55 lines)
dashboard-web/src/lib/fetchers/meta.ts                               ~6 lines (swap 4 fetchWithBackoff → fetchMeta calls)
dashboard-web/src/lib/notifications/detectAuthError.ts               ~2 lines (META_BUDGET_HIGH classification)
dashboard-web/src/lib/notifications/tokenFailures.ts                 ~5 lines (skip WhatsApp on budget_skip operation)
dashboard-web/src/inngest/functions/cronLiveHeavy.ts                 ~30 lines (pre-flight check + stagger factory)
dashboard-web/src/inngest/functions/cronDaily.ts                     ~20 lines (pre-flight check; only if it calls Meta)
dashboard-web/src/inngest/functions/cronLive.ts                      ~15 lines (pre-flight check)
dashboard-web/src/app/operator/page.tsx                              ~60 lines (new Meta budget card)

dashboard-web/src/lib/fetchers/__tests__/fetchMeta.test.ts           NEW (~120 lines)
dashboard-web/src/lib/notifications/__tests__/metaUsage.test.ts      NEW (~80 lines)
dashboard-web/src/lib/notifications/__tests__/detectAuthError.test.ts ~10 lines added
dashboard-web/src/inngest/functions/__tests__/cronLiveHeavyBudgetSkip.test.ts   NEW (~100 lines)
dashboard-web/src/inngest/functions/__tests__/cronLiveHeavyBudgetStale.test.ts  NEW (~80 lines)

docs/ROAS-Dashboard-User-Manual.md                                   1 changelog (2.1.13 → 2.1.14, "Meta API budget gating added")
```

Estimated total: ~4-5 hours focused work + 30 min visual verification.

## Out of scope (deferred)

- Per-BUC quota tracking from `x-business-use-case-usage` — different shape, deeper refactor. Spec separately if needed.
- Google / TikTok budget gating. Different quota model; not the current pain point.
- Adaptive threshold (lower when we observe frequent skips). The 80% threshold is a constant for v1.
- Adaptive tick cadence (slow down 30 min → 60 min during heavy usage). Not needed if pre-flight + in-flight gating works.
- Per-store quota (Meta's app-level quota is shared across stores; per-store gating would not help).
