# Phase E1 — Decommission `cron-live-heavy` Design Spec

**Date:** 2026-05-30
**Status:** Approved (user-confirmed all 4 sections)
**Phase context:** Phase E start, per [[phase-e-scope-decision]] (E1-E4 only). E1 is the natural first step — cheap, immediately frees a Vercel cron slot + ~30% of cron API load. Per user (2026-05-30 ~16:30 IL), the scope-memo's "~1 week soak" prerequisite is waived: Phase D is at 0% BACKFILL_UNKNOWN within 30 min of deploy and coverage parity 4/4 green, so we ship E1 immediately.

## Goal

Disable the `cron-live-heavy` Inngest functions so the Phase C `cron-tick-orchestrator` (every 10 min) becomes the **single source of live truth** for `campaigns_daily` + `ads_daily` metric refreshes. Preserve both safety mechanisms currently living inside `cron-live-heavy`:
1. Token-failure WhatsApp alerts on auth/rate errors.
2. Meta BUC (Business Use Case) pre-flight rate-limit gate that prevents account lockout.

## Why now

- **Reconcile parity already proven:** `npm run audit:reconcile:hot-vs-heavy` (Phase C) confirms that the hot_metrics workers write equivalent data to what cron-live-heavy writes, for hot ids.
- **Phase D stable:** all 3 platforms 0% BACKFILL_UNKNOWN, coverage parity 4/4 green, full vitest 1546/1546 green as of HEAD `a9db94f`.
- **Savings:** removes 3 cron functions (one per store), one Vercel cron slot freed, ~30% reduction in cron API load (cron-live-heavy was the heaviest per-tick burden).
- **Freshness improves:** 30 min → 10 min for campaigns_daily.last_live_tick_at (10-min orchestrator vs 30-min cron-live-heavy).

## Architecture

**Before:**
```
cron-live-heavy/{store}  (every 30 min, staggered :00/:30, :10/:40, :20/:50)
  → fetch metrics (meta + google + tiktok in parallel) for [today, yesterday]
  → persistCampaignsLive
      → upsert campaigns_daily + ads_daily (source='live_tick')
      → agg_tiktok_spend_per_store_for_date RPC
  → notifyTokenFailure on auth/rate/budget_skip per provider

cron-tick-orchestrator  (every 10 min)
  → fan out (store × platform × scope) events
  → workers consume events:
      runMetaHotMetricsBranch     → upsert campaigns_daily + ads_daily
      runGoogleHotMetricsBranch   → upsert campaigns_daily + ads_daily
      runTikTokHotMetricsBranch   → upsert campaigns_daily + ads_daily
```

**After:**
```
cron-tick-orchestrator  (every 10 min)
  → fan out (store × platform × scope) events
  → workers consume events:
      runMetaHotMetricsBranch
        + Meta BUC pre-flight gate (moved from cron-live-heavy)
        + notifyTokenFailure on auth/rate/budget_skip
        → upsert campaigns_daily + ads_daily
      runGoogleHotMetricsBranch
        + notifyTokenFailure on auth/rate
        → upsert campaigns_daily + ads_daily
      runTikTokHotMetricsBranch
        + notifyTokenFailure on auth/rate
        → upsert campaigns_daily + ads_daily
```

`cronLiveHeavy.ts` + `persistCampaignsLive.ts` source files stay in repo:
- `cronLiveHeavy.ts`: `runHeavyForStore` is retained for the existing vitest fixtures (cronLiveHeavy*.test.ts). The factory loop that registers the 3 per-store Inngest functions is removed.
- `persistCampaignsLive.ts`: still called by `cron-daily` for the nightly authoritative run. No change.

## Tradeoffs acknowledged

| Concern | Mitigation |
|---|---|
| Hot_set is limited to recently-active campaigns. A campaign going PAUSED→ACTIVE may miss the first hot_metrics tick. | Worst-case ~20 min lag (1 status worker cycle + 1 hot_metrics cycle), vs the 30 min cron-live-heavy interval — net better. |
| `persistCampaignsLive` becomes dead-code-ish for the live tick path; only `cron-daily` calls it. | Acceptable; deletion would be a Phase E2/E3 follow-up. |
| If Inngest scheduler doesn't sync immediately, in-flight cron-live-heavy ticks may run on old code. | Per Inngest semantics, removing a registered function takes effect at next deploy. One stray tick is harmless (writes the same data hot_metrics will). |

## Components — files touched

| File | Action |
|---|---|
| `dashboard-web/src/inngest/functions/cronLiveHeavy.ts` | Remove the `CRON_STAGGER` factory loop that exports the 3 per-store functions. Keep `runHeavyForStore` for vitest fixtures. Add bold "DISABLED in Phase E1" header note. |
| Inngest function registry (`inngest/client.ts` or the endpoint route registering functions for the Inngest UI) | Drop the cronLiveHeavy* function references so they don't appear in the Inngest dashboard. |
| `dashboard-web/src/inngest/functions/metaWorker.ts` | (1) Move Meta BUC pre-flight gate from cronLiveHeavy into `runMetaHotMetricsBranch` (top of try-block). (2) Add `notifyTokenFailure` call inside the `catch` block on auth/rate/budget_skip errors — operation keys `meta_hot_metrics_*`. |
| `dashboard-web/src/inngest/functions/googleWorker.ts` | Add `notifyTokenFailure` in `runGoogleHotMetricsBranch` catch — operation keys `google_hot_metrics_*`. (No BUC equivalent on Google.) |
| `dashboard-web/src/inngest/functions/tiktokWorker.ts` | Add `notifyTokenFailure` in `runTikTokHotMetricsBranch` catch — operation keys `tiktok_hot_metrics_*`. (No BUC equivalent on TikTok.) |
| `dashboard-web/src/inngest/functions/__tests__/metaWorker.test.ts` | Add test: hot_metrics fetch rejects with 429 → `notifyTokenFailure` called with `meta_hot_metrics_rate_limit`. |
| `dashboard-web/src/inngest/functions/__tests__/googleWorker.test.ts` | Same for `google_hot_metrics_rate_limit`. |
| `dashboard-web/src/inngest/functions/__tests__/tiktokWorker.test.ts` | Same for `tiktok_hot_metrics_rate_limit`. |
| `dashboard-web/src/inngest/functions/__tests__/metaWorker.test.ts` | Additional test: when `meta_buc_usage` > threshold, runMetaHotMetricsBranch skips the fetch and writes budget_skip freshness rows. |
| `docs/ARCHITECTURE.md` | Add §Phase E1 subsection. Remove cron-live-heavy from §"live tick" / §Phase 13.9. |
| `docs/USER-MANUAL.md` | Version bump + note: "freshness latency = 10 min via hot_metrics workers (was 30 min)". |
| `MEMORY.md` + new entry `project_phase_e1_decommission_cron_live_heavy_shipped.md` | Standard handoff entry. |

## Detail 1 — Token failure alert transfer

**Current (cronLiveHeavy.ts ~lines 385-417):**
```typescript
for (const f of failures) {
  const isRate = isRateLimitError(f.provider, f.errorMsg);
  const isAuth = isAuthError(f.provider, f.errorMsg);
  if (isRate || isAuth) {
    await notifyTokenFailure({
      provider: f.provider, storeId,
      operation: isRate
        ? (f.errorMsg.includes('META_BUDGET_HIGH')
            ? 'cron_live_heavy_budget_skip'
            : 'cron_live_heavy_rate_limit')
        : 'cron_live_heavy_auth',
      errorMsg: f.errorMsg,
      advice: f.errorMsg.includes('META_BUDGET_HIGH')
        ? 'Meta BUC reached 80% threshold; pre-flight gate skipped this tick...'
        : isRate
          ? 'Platform reported HTTP 429 / quota-exceeded...'
          : 'Refresh the platform access token...',
    }).catch((alertErr) => console.warn(...));
  }
}
```

**New, per worker hot_metrics catch block:**
```typescript
catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  await recHotPair('transient_error', message);
  const isRate = isRateLimitError('meta', message);
  const isAuth = isAuthError('meta', message);
  const isBudgetSkip = message.includes('META_BUDGET_HIGH');
  if (isRate || isAuth || isBudgetSkip) {
    await notifyTokenFailure({
      provider: 'meta',
      storeId,
      operation: isBudgetSkip
        ? 'meta_hot_metrics_budget_skip'
        : isRate
          ? 'meta_hot_metrics_rate_limit'
          : 'meta_hot_metrics_auth',
      errorMsg: message,
      advice: isBudgetSkip
        ? 'Meta BUC reached 80% threshold; hot_metrics pre-flight gate skipped this tick. No operator action — worker will retry next orchestrator tick (10 min) once usage decays.'
        : isRate
          ? 'Platform reported HTTP 429 / quota-exceeded. Hot metrics worker will retry on next orchestrator tick (10 min). No operator action needed unless this persists across multiple ticks.'
          : 'Refresh the platform access token in Vercel and redeploy. See docs/PROPS-MAP.md.',
    }).catch((alertErr) => console.warn(`...notifyTokenFailure threw: ${alertErr}`));
  }
  throw err; // existing — preserves Inngest retry
}
```

### Design decisions
1. **Operation keys are `_hot_metrics_` (not `_cron_live_heavy_`)** — `notifyTokenFailure` throttles per `(provider, storeId, operation)`. New keys mean a future re-enable of cron-live-heavy wouldn't suppress new alerts and vice versa. Clean separation.
2. **Status branch unchanged** — status errors are transient (1 worker cycle = 1 miss, harmless) and already surface via `recordFreshness('transient_error')` → /operator panel. Adding WhatsApp on status errors would create noise.
3. **`.catch((alertErr) => console.warn(...))` wrapper preserved** — a transient WhatsApp failure must not block the rethrow that preserves Inngest's exponential-backoff retry.

## Detail 2 — Meta BUC pre-flight gate transfer

The BUC gate is critical: without it, Meta API can lock the account at 100% usage. The gate lives in cron-live-heavy today (Phase A.5).

**To transfer:** wrap `runMetaHotMetricsBranch`'s try-block with a pre-flight read of `meta_buc_usage`. If usage > threshold (currently 80% per existing config), skip the fetch, write `budget_skip` freshness rows for both `campaign_metrics` and `ad_metrics`, fire suppressed-WhatsApp alert via `notifyTokenFailure({ operation: 'meta_hot_metrics_budget_skip', ... })`, and return without throwing.

The exact threshold + gate helper functions are already shared in `dashboard-web/src/lib/meta/...` (used by cron-live-heavy); no new helpers needed, just call sites added in metaWorker.

## Verification

### Pre-deploy
1. `cd dashboard-web && npx tsc --noEmit && npx vitest run` — full suite green, including the 4 new tests (3 hot_metrics token alerts + 1 BUC pre-flight).
2. `npm run audit:reconcile:hot-vs-heavy` — must be green; this is the parity check that proves hot_metrics writes equivalent data to cron-live-heavy.

### Post-deploy (after Vercel build)
1. **Inngest dashboard** — confirm `cron-live-heavy-uzoshop`, `cron-live-heavy-zolplus`, `cron-live-heavy-usmile360` are no longer listed.
2. **Wait one orchestrator cycle** (≥10 min) for hot_metrics ticks to complete.
3. `npm run audit:reconcile` — confirm `campaigns_daily.last_live_tick_at` for today is recent (≤10 min lag per (store × platform)).
4. `/operator` panel — confirm `campaign_metrics` and `ad_metrics` freshness rows for all 9 (store × platform) tuples are green within 10 min.

### Acceptance gate
- ✅ No `cron-live-heavy-*` Inngest functions in dashboard.
- ✅ `campaigns_daily.last_live_tick_at` for today updates ≤10 min for every (store × platform).
- ✅ `npm run audit:reconcile:hot-vs-heavy` still green.
- ✅ `vitest run` 1550/1550 green (4 new + 1546 existing).
- ✅ No new errors in Sentry within 30 min.

### Rollback signal + procedure
- **Signal:** `/operator` shows `campaign_metrics` >15 min lag for any (store × platform) across 3 consecutive ticks, OR a BUC alert that would have fired doesn't fire (manually verifiable by checking meta_buc_usage trajectory), OR a Sentry spike of `notifyTokenFailure` errors.
- **Procedure:** `git revert <commit>` of the E1 SHIP commit + push. Vercel redeploys in 3-5 min. cron-live-heavy resumes on the next Inngest sync (within minutes). The data is self-healing: the next cron-live-heavy tick writes the same campaigns_daily rows hot_metrics was writing, no data loss.

## What is NOT in scope (defer to E2/E3/E4)

- Deleting `cronLiveHeavy.ts` source file (defer until no test still references it).
- Deleting `persistCampaignsLive.ts` (still used by `cron-daily`).
- Removing `agg_tiktok_spend_per_store_for_date` RPC (still useful for daily aggregation).
- Adding BUC-equivalent pre-flight gates for Google or TikTok (those platforms' APIs don't expose a comparable usage signal; rate-limit catch + retry remains the model).
- Adding token-failure alerts to status branches (status errors are operator-panel-visible; WhatsApp would be noise).

## Related memory

- [[phase-e-scope-decision]] — Phase E scoped to E1-E4 only.
- [[handoff-phase-d-deployed-soak-in-progress]] — Phase D context.
- [[phase-d-soak-stuck-rows-2026-05-30]] — preceding hotfix work.
- [[script-roas-dashboard]] — overall architecture.
