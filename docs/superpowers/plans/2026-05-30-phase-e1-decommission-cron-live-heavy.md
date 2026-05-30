# Phase E1 — Decommission `cron-live-heavy` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Soft-disable the 3 cron-live-heavy Inngest functions and transfer their token-failure WhatsApp alerts (auth/rate/budget_skip) into the 3 hot_metrics worker branches (meta/google/tiktok), making `cron-tick-orchestrator` the single source of live truth for `campaigns_daily` + `ads_daily` refreshes.

**Architecture:** 5 surgical changes in dependency order — (1)-(4) add `notifyTokenFailure` to each worker's hot_metrics branch (preserving the existing recHotPair+throw pattern), (5) removes the cron-live-heavy Inngest registration. Source files (`cronLiveHeavy.ts`, `persistCampaignsLive.ts`) stay in repo — they're still used by cron-daily nightly + by existing vitest fixtures.

**Tech Stack:** TypeScript (Node 20), Inngest, Supabase, Vitest. No new dependencies.

**Spec:** [docs/superpowers/specs/2026-05-30-phase-e1-decommission-cron-live-heavy-design.md](../specs/2026-05-30-phase-e1-decommission-cron-live-heavy-design.md)

---

## Pre-flight context (verified during plan authoring)

| Fact | Source |
|---|---|
| `cronLiveHeavyFunctions = ALL_STORES.map(makeCronLiveHeavy)` | `src/inngest/functions/cronLiveHeavy.ts:485` |
| Inngest registration: `...cronLiveHeavyFunctions,` | `src/app/api/inngest/route.ts:142` (import at line 100) |
| `metaWorker.runMetaHotMetricsBranch` has **no try/catch** around fetch | `src/inngest/functions/metaWorker.ts:295-404` |
| `metaWorker.runMetaHotMetricsBranch` HAS BUC pre-flight (lines 337-347) but no WhatsApp alert | same file |
| `googleWorker.runGoogleHotMetricsBranch` HAS try/catch (catch at line 404) | `src/inngest/functions/googleWorker.ts:302-411` |
| `tiktokWorker.runTikTokHotMetricsBranch` HAS try (line 419) | `src/inngest/functions/tiktokWorker.ts:377-490` |
| `isAuthError` / `isRateLimitError` exported | `src/lib/notifications/detectAuthError.ts:89, 120` |
| `notifyTokenFailure` exists (already imported by cron-live-heavy) | `src/lib/notifications/notifyTokenFailure` |
| Existing test asserts `cronLiveHeavyFunctions.length === 3` | `src/inngest/functions/__tests__/cronLiveHeavyBudgetSkip.test.ts:264-267` |

---

### Task 1: notifyTokenFailure for Meta BUC budget_skip in metaWorker

**Files:**
- Modify: `dashboard-web/src/inngest/functions/metaWorker.ts:337-347`
- Modify: `dashboard-web/src/inngest/functions/__tests__/metaWorker.test.ts`

The metaWorker hot_metrics branch already has the BUC pre-flight gate (lines 337-347) — it records `budget_skip` freshness and returns early. It does NOT fire a WhatsApp alert. Cron-live-heavy DID fire one (operation `cron_live_heavy_budget_skip`). We add the equivalent here so the operator gets the alert when cron-live-heavy is later disabled.

- [ ] **Step 1: Add failing test for BUC budget_skip → notifyTokenFailure**

Append to `dashboard-web/src/inngest/functions/__tests__/metaWorker.test.ts` (locate the `describe('runMetaHotMetricsBranch')` or equivalent block — append a new `it`):

```typescript
it('Phase E1: BUC budget_skip fires notifyTokenFailure with meta_hot_metrics_budget_skip operation', async () => {
  const notifyTokenFailure = vi.fn().mockResolvedValue(undefined);
  const recordFreshness = vi.fn().mockResolvedValue(undefined);
  const bucProbe = vi.fn().mockResolvedValue({ etaMinutes: 5, pct: 85 });
  await runMetaWorkerJob({
    jobData: { store_id: 'uzoshop', scope: 'hot_metrics', tick_id: 'T', staleness_seconds: 600, budget_pct_estimate: 0 } as never,
    bucProbe,
    fetchStatus: vi.fn(), fetchHotMetrics: vi.fn(),
    getHotCampaignIds: async () => [], getHotAdsetIds: async () => [], getHotAdIds: async () => [],
    loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
    upsertRegistry: vi.fn(), insertStatusEvents: vi.fn(),
    upsertCampaignsDaily: vi.fn(), upsertAdsDaily: vi.fn(),
    recordFreshness,
    notifyTokenFailure,
    nowIso: '2026-05-30T16:30:00.000Z',
  });
  expect(notifyTokenFailure).toHaveBeenCalledOnce();
  const call = notifyTokenFailure.mock.calls[0][0];
  expect(call.provider).toBe('meta');
  expect(call.storeId).toBe('uzoshop');
  expect(call.operation).toBe('meta_hot_metrics_budget_skip');
  expect(call.errorMsg).toMatch(/ETA=5/);
});
```

If the existing test fixture doesn't have a `runMetaWorkerJob` import, add `import { runMetaWorkerJob } from '@/inngest/functions/metaWorker';` at the top.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx vitest run src/inngest/functions/__tests__/metaWorker.test.ts -t "BUC budget_skip fires notifyTokenFailure"
```

Expected: FAIL — either `notifyTokenFailure is not a valid input` (TypeScript) or `expected "spy" to be called once, but got 0 times`.

- [ ] **Step 3: Add `notifyTokenFailure` to RunMetaWorkerJobInput**

In `dashboard-web/src/inngest/functions/metaWorker.ts`, locate `RunMetaWorkerJobInput` (search for `bucProbe:` to find the surrounding type). Add new field — keep it OPTIONAL for backwards-compat with existing test fixtures:

```typescript
  /**
   * Phase E1 (2026-05-30) — operator WhatsApp alert hook. The hot_metrics
   * branch invokes this on BUC budget_skip / auth errors / rate-limit
   * errors with a `meta_hot_metrics_*` operation key. Optional because
   * existing tests don't all pass it; production Inngest binding always
   * supplies it via the notifyTokenFailure adapter.
   */
  notifyTokenFailure?: (input: {
    provider: 'meta' | 'google' | 'tiktok';
    storeId: string;
    operation: string;
    errorMsg: string;
    advice?: string;
  }) => Promise<void>;
```

- [ ] **Step 4: Wire BUC budget_skip path to call notifyTokenFailure**

In `metaWorker.ts`, modify the existing BUC pre-flight block (was lines 337-347 — line numbers may shift after Step 3). Replace:

```typescript
  // 1. BUC pre-flight — same hard gate as status branch.
  const buc = await bucProbe(storeId);
  if (buc.etaMinutes > 0 || buc.pct >= HARD_SKIP_PCT) {
    await recHotPair(
      'budget_skip',
      buc.etaMinutes > 0
        ? `Meta ETA=${buc.etaMinutes}min`
        : `pct=${buc.pct}>=${HARD_SKIP_PCT}`,
    );
    return;
  }
```

with:

```typescript
  // 1. BUC pre-flight — same hard gate as status branch.
  const buc = await bucProbe(storeId);
  if (buc.etaMinutes > 0 || buc.pct >= HARD_SKIP_PCT) {
    const errorMsg = buc.etaMinutes > 0
      ? `Meta ETA=${buc.etaMinutes}min`
      : `pct=${buc.pct}>=${HARD_SKIP_PCT}`;
    await recHotPair('budget_skip', errorMsg);
    // Phase E1 (2026-05-30) — fire suppressed-WhatsApp alert via
    // notifyTokenFailure. Matches the cron-live-heavy behavior we're
    // replacing: operator gets the DB row (no panic ping) so they can
    // see BUC throttling on /operator without phone noise.
    if (input.notifyTokenFailure) {
      await input.notifyTokenFailure({
        provider: 'meta',
        storeId,
        operation: 'meta_hot_metrics_budget_skip',
        errorMsg,
        advice: 'Meta BUC reached the hard-skip threshold; hot_metrics worker skipped this tick. No operator action — worker will retry next orchestrator tick (10 min) once usage decays.',
      }).catch((alertErr) => {
        console.warn(`metaWorker hot_metrics budget_skip alert threw: ${alertErr instanceof Error ? alertErr.message : alertErr}`);
      });
    }
    return;
  }
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx vitest run src/inngest/functions/__tests__/metaWorker.test.ts
```

Expected: all PASS, including the new test.

- [ ] **Step 6: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/inngest/functions/metaWorker.ts \
        dashboard-web/src/inngest/functions/__tests__/metaWorker.test.ts
git commit -m "$(cat <<'EOF'
feat(phase-e1): metaWorker BUC budget_skip fires notifyTokenFailure

Adds a suppressed-WhatsApp alert (operation = meta_hot_metrics_budget_skip)
when the metaWorker hot_metrics BUC pre-flight gate skips a tick.
Matches the cron-live-heavy behavior being replaced in Phase E1 —
operator gets the DB freshness row + notification record, no panic
ping, so they can see BUC throttling on /operator.

notifyTokenFailure is OPTIONAL in RunMetaWorkerJobInput so existing
test fixtures stay clean; prod Inngest binding always supplies it.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Wrap meta hot_metrics fetch in try/catch + auth/rate WhatsApp alert

**Files:**
- Modify: `dashboard-web/src/inngest/functions/metaWorker.ts` (the rest of `runMetaHotMetricsBranch`)
- Modify: `dashboard-web/src/inngest/functions/__tests__/metaWorker.test.ts`

`metaWorker.runMetaHotMetricsBranch` currently has no try/catch around the fetch — auth/rate errors propagate to Inngest unwrapped, no `recHotPair('transient_error')` is written, no WhatsApp fires. Today this gap is masked because cron-live-heavy catches the same errors. After E1 disables cron-live-heavy, the gap becomes visible. Fix by wrapping the post-BUC-gate logic in try/catch, mirroring googleWorker's existing pattern.

- [ ] **Step 1: Add 2 failing tests for auth + rate-limit paths**

Append to `dashboard-web/src/inngest/functions/__tests__/metaWorker.test.ts`:

```typescript
it('Phase E1: hot_metrics fetch rejects with 429 → recHotPair transient_error + notifyTokenFailure(meta_hot_metrics_rate_limit)', async () => {
  const notifyTokenFailure = vi.fn().mockResolvedValue(undefined);
  const recordFreshness = vi.fn().mockResolvedValue(undefined);
  const err = new Error('Meta Graph API: HTTP 429 rate limit exceeded');
  const fetchHotMetrics = vi.fn().mockRejectedValue(err);
  await expect(runMetaWorkerJob({
    jobData: { store_id: 'uzoshop', scope: 'hot_metrics', tick_id: 'T', staleness_seconds: 600, budget_pct_estimate: 0 } as never,
    bucProbe: async () => ({ etaMinutes: 0, pct: 10 }),
    fetchStatus: vi.fn(), fetchHotMetrics,
    getHotCampaignIds: async () => ['c1'], getHotAdsetIds: async () => ['a1'], getHotAdIds: async () => [],
    loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
    upsertRegistry: vi.fn(), insertStatusEvents: vi.fn(),
    upsertCampaignsDaily: vi.fn(), upsertAdsDaily: vi.fn(),
    getCredentials: async () => ({ adAccountId: 'act_1', accessToken: 'tok', getFxCadFor: async () => async () => 1 } as never),
    recordFreshness,
    notifyTokenFailure,
    nowIso: '2026-05-30T16:30:00.000Z',
  })).rejects.toThrow('rate limit');
  const transientErrorCalls = recordFreshness.mock.calls.filter(c => c[0].status === 'transient_error');
  expect(transientErrorCalls.map(c => c[0].scope).sort()).toEqual(['ad_metrics', 'campaign_metrics']);
  expect(notifyTokenFailure).toHaveBeenCalledOnce();
  expect(notifyTokenFailure.mock.calls[0][0].operation).toBe('meta_hot_metrics_rate_limit');
});

it('Phase E1: hot_metrics fetch rejects with auth error → notifyTokenFailure(meta_hot_metrics_auth)', async () => {
  const notifyTokenFailure = vi.fn().mockResolvedValue(undefined);
  const err = new Error('Meta Graph API: HTTP 401 OAuthException invalid access token');
  const fetchHotMetrics = vi.fn().mockRejectedValue(err);
  await expect(runMetaWorkerJob({
    jobData: { store_id: 'uzoshop', scope: 'hot_metrics', tick_id: 'T', staleness_seconds: 600, budget_pct_estimate: 0 } as never,
    bucProbe: async () => ({ etaMinutes: 0, pct: 10 }),
    fetchStatus: vi.fn(), fetchHotMetrics,
    getHotCampaignIds: async () => ['c1'], getHotAdsetIds: async () => ['a1'], getHotAdIds: async () => [],
    loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
    upsertRegistry: vi.fn(), insertStatusEvents: vi.fn(),
    upsertCampaignsDaily: vi.fn(), upsertAdsDaily: vi.fn(),
    getCredentials: async () => ({ adAccountId: 'act_1', accessToken: 'tok', getFxCadFor: async () => async () => 1 } as never),
    recordFreshness: vi.fn(),
    notifyTokenFailure,
    nowIso: '2026-05-30T16:30:00.000Z',
  })).rejects.toThrow('invalid access token');
  expect(notifyTokenFailure).toHaveBeenCalledOnce();
  expect(notifyTokenFailure.mock.calls[0][0].operation).toBe('meta_hot_metrics_auth');
});
```

- [ ] **Step 2: Run tests to verify both fail**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx vitest run src/inngest/functions/__tests__/metaWorker.test.ts
```

Expected: 2 NEW tests fail (existing tests stay green).

- [ ] **Step 3: Wrap hot_metrics fetch + upserts in try/catch**

In `metaWorker.runMetaHotMetricsBranch`, identify the block from step "2. Load hot ids…" through "5. Mark freshness success…" (was around lines 349-403). Wrap it in try/catch. Add import at top of file:

```typescript
import { isAuthError, isRateLimitError } from '@/lib/notifications/detectAuthError';
```

Then modify the body. Replace the existing block:

```typescript
  // 2. Load hot ids in parallel — missing injections default to empty list.
  const [hotCampaign, hotAdset, hotAd] = await Promise.all([
    (getHotCampaignIds ?? (async () => []))(storeId),
    ...
  ]);

  // ... through to ...

  // 5. Mark freshness success for both campaign_metrics + ad_metrics.
  await recHotPair('success');
}
```

with:

```typescript
  try {
    // 2. Load hot ids in parallel — missing injections default to empty list.
    const [hotCampaign, hotAdset, hotAd] = await Promise.all([
      (getHotCampaignIds ?? (async () => []))(storeId),
      (getHotAdsetIds ?? (async () => []))(storeId),
      (getHotAdIds ?? (async () => []))(storeId),
    ]);

    if (hotCampaign.length + hotAdset.length + hotAd.length === 0) {
      await recHotPair('success');
      return;
    }

    if (!fetchHotMetrics) {
      await recHotPair('transient_error', 'fetchHotMetrics not wired');
      return;
    }

    // 3. Resolve credentials + fetch — single batched insights call.
    const creds = await safeCredentials(storeId, getCredentials);
    const today = nowIso.slice(0, 10);
    const metrics = await fetchHotMetrics({
      storeId,
      adAccountId: creds.adAccountId,
      accessToken: creds.accessToken,
      hotCampaignIds: hotCampaign,
      hotAdsetIds: hotAdset,
      hotAdIds: hotAd,
      dateStr: today,
      getFxCadFor: creds.getFxCadFor,
    });

    // 4. Upsert campaigns_daily (adsets only) and ads_daily, stamping
    //    source='live_tick' + last_live_tick_at on every row.
    if (upsertCampaignsDaily && metrics.adsets.length > 0) {
      const all: Array<Record<string, unknown>> = metrics.adsets.map((a) => ({
        ...a,
        source: 'live_tick',
        last_live_tick_at: nowIso,
      }));
      await upsertCampaignsDaily(all);
    }
    if (upsertAdsDaily && metrics.ads.length > 0) {
      await upsertAdsDaily(
        metrics.ads.map((a) => ({ ...a, source: 'live_tick', last_live_tick_at: nowIso })),
      );
    }

    // 5. Mark freshness success for both campaign_metrics + ad_metrics.
    await recHotPair('success');
  } catch (err) {
    // Phase E1 (2026-05-30) — surface auth/rate errors to the operator
    // panel AND fire WhatsApp via notifyTokenFailure. Mirrors googleWorker
    // pattern. Re-throw preserves Inngest's exponential-backoff retry.
    const message = err instanceof Error ? err.message : String(err);
    await recHotPair('transient_error', message);
    const isRate = isRateLimitError('meta', message);
    const isAuth = isAuthError('meta', message);
    if ((isRate || isAuth) && input.notifyTokenFailure) {
      await input.notifyTokenFailure({
        provider: 'meta',
        storeId,
        operation: isRate ? 'meta_hot_metrics_rate_limit' : 'meta_hot_metrics_auth',
        errorMsg: message,
        advice: isRate
          ? 'Meta reported HTTP 429 / quota-exceeded. Hot metrics worker will retry on next orchestrator tick (10 min). No operator action needed unless this persists across multiple ticks.'
          : 'Refresh the Meta access token in Vercel and redeploy. See docs/PROPS-MAP.md for the env var name.',
      }).catch((alertErr) => {
        console.warn(`metaWorker hot_metrics ${isRate ? 'rate' : 'auth'} alert threw: ${alertErr instanceof Error ? alertErr.message : alertErr}`);
      });
    }
    throw err;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx vitest run src/inngest/functions/__tests__/metaWorker.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/inngest/functions/metaWorker.ts \
        dashboard-web/src/inngest/functions/__tests__/metaWorker.test.ts
git commit -m "$(cat <<'EOF'
feat(phase-e1): metaWorker hot_metrics catches auth/rate + fires WhatsApp

Wraps the metaWorker hot_metrics branch in try/catch (mirroring
googleWorker pattern). On rate-limit (HTTP 429) or auth (HTTP 401)
errors: writes recHotPair('transient_error') AND fires
notifyTokenFailure with meta_hot_metrics_rate_limit or
meta_hot_metrics_auth operation key.

This restores the alert path that cron-live-heavy provided. After
cron-live-heavy is disabled (Task 5), metaWorker is the sole owner of
Meta hot metrics — without this catch, auth failures would propagate
silently to Inngest's retry layer and the operator would never see a
WhatsApp.

Re-throw at the end of catch preserves Inngest exponential backoff.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: notifyTokenFailure in google hot_metrics catch

**Files:**
- Modify: `dashboard-web/src/inngest/functions/googleWorker.ts` (existing catch at line 404)
- Modify: `dashboard-web/src/inngest/functions/__tests__/googleWorker.test.ts`

googleWorker.runGoogleHotMetricsBranch already has try/catch with `recHotPair('transient_error', message)`. Just add the notifyTokenFailure call.

- [ ] **Step 1: Add 2 failing tests for auth + rate-limit paths**

Append to `dashboard-web/src/inngest/functions/__tests__/googleWorker.test.ts`:

```typescript
it('Phase E1: google hot_metrics fetch rejects with rate-limit → notifyTokenFailure(google_hot_metrics_rate_limit)', async () => {
  const notifyTokenFailure = vi.fn().mockResolvedValue(undefined);
  const err = new Error('Google Ads API: RESOURCE_EXHAUSTED quota exceeded');
  const fetchHotMetrics = vi.fn().mockRejectedValue(err);
  await expect(runGoogleWorkerJob({
    jobData: { store_id: 'uzoshop', scope: 'hot_metrics', tick_id: 'T', staleness_seconds: 600, budget_pct_estimate: 0 } as never,
    fetchStatus: vi.fn(), fetchHotMetrics,
    getHotCampaignIds: async () => ['c1'], getHotAdgroupIds: async () => ['a1'], getHotAdIds: async () => [],
    loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
    upsertRegistry: vi.fn(), insertStatusEvents: vi.fn(),
    upsertCampaignsDaily: vi.fn(), upsertAdsDaily: vi.fn(),
    getCustomer: async () => ({ searchStream: async () => [] }),
    recordFreshness: vi.fn(),
    notifyTokenFailure,
    nowIso: '2026-05-30T16:30:00.000Z',
    isGoogleConfigured: () => true,
  })).rejects.toThrow('RESOURCE_EXHAUSTED');
  expect(notifyTokenFailure).toHaveBeenCalledOnce();
  expect(notifyTokenFailure.mock.calls[0][0].operation).toBe('google_hot_metrics_rate_limit');
});

it('Phase E1: google hot_metrics fetch rejects with auth → notifyTokenFailure(google_hot_metrics_auth)', async () => {
  const notifyTokenFailure = vi.fn().mockResolvedValue(undefined);
  const err = new Error('Google Ads API: UNAUTHENTICATED invalid_grant refresh token expired');
  const fetchHotMetrics = vi.fn().mockRejectedValue(err);
  await expect(runGoogleWorkerJob({
    jobData: { store_id: 'uzoshop', scope: 'hot_metrics', tick_id: 'T', staleness_seconds: 600, budget_pct_estimate: 0 } as never,
    fetchStatus: vi.fn(), fetchHotMetrics,
    getHotCampaignIds: async () => ['c1'], getHotAdgroupIds: async () => ['a1'], getHotAdIds: async () => [],
    loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
    upsertRegistry: vi.fn(), insertStatusEvents: vi.fn(),
    upsertCampaignsDaily: vi.fn(), upsertAdsDaily: vi.fn(),
    getCustomer: async () => ({ searchStream: async () => [] }),
    recordFreshness: vi.fn(),
    notifyTokenFailure,
    nowIso: '2026-05-30T16:30:00.000Z',
    isGoogleConfigured: () => true,
  })).rejects.toThrow('UNAUTHENTICATED');
  expect(notifyTokenFailure).toHaveBeenCalledOnce();
  expect(notifyTokenFailure.mock.calls[0][0].operation).toBe('google_hot_metrics_auth');
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx vitest run src/inngest/functions/__tests__/googleWorker.test.ts
```

Expected: 2 new tests fail (existing tests pass).

- [ ] **Step 3: Add `notifyTokenFailure` field to `RunGoogleWorkerJobInput`**

In `dashboard-web/src/inngest/functions/googleWorker.ts`, locate the `RunGoogleWorkerJobInput` type. Add (same shape as metaWorker's):

```typescript
  /**
   * Phase E1 (2026-05-30) — operator WhatsApp alert hook for the
   * hot_metrics branch. Invoked with operation 'google_hot_metrics_*'
   * on auth/rate-limit errors. Optional for backwards-compat with
   * existing test fixtures.
   */
  notifyTokenFailure?: (input: {
    provider: 'meta' | 'google' | 'tiktok';
    storeId: string;
    operation: string;
    errorMsg: string;
    advice?: string;
  }) => Promise<void>;
```

- [ ] **Step 4: Add notifyTokenFailure call to existing catch block + import detectors**

At top of `googleWorker.ts`, add (if not already present):

```typescript
import { isAuthError, isRateLimitError } from '@/lib/notifications/detectAuthError';
```

Then in `runGoogleHotMetricsBranch`, replace the existing catch block (was around lines 404-410):

```typescript
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recHotPair('transient_error', message);
    throw err;
  }
```

with:

```typescript
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recHotPair('transient_error', message);
    const isRate = isRateLimitError('google', message);
    const isAuth = isAuthError('google', message);
    if ((isRate || isAuth) && input.notifyTokenFailure) {
      await input.notifyTokenFailure({
        provider: 'google',
        storeId,
        operation: isRate ? 'google_hot_metrics_rate_limit' : 'google_hot_metrics_auth',
        errorMsg: message,
        advice: isRate
          ? 'Google reported RESOURCE_EXHAUSTED / 429. Hot metrics worker will retry on next orchestrator tick (10 min). No operator action needed unless this persists across multiple ticks.'
          : 'Refresh the Google OAuth refresh token. See docs/PROPS-MAP.md for the env var name (UZOSHOP_GOOGLE_REFRESH_TOKEN).',
      }).catch((alertErr) => {
        console.warn(`googleWorker hot_metrics ${isRate ? 'rate' : 'auth'} alert threw: ${alertErr instanceof Error ? alertErr.message : alertErr}`);
      });
    }
    throw err;
  }
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx vitest run src/inngest/functions/__tests__/googleWorker.test.ts
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/inngest/functions/googleWorker.ts \
        dashboard-web/src/inngest/functions/__tests__/googleWorker.test.ts
git commit -m "$(cat <<'EOF'
feat(phase-e1): googleWorker hot_metrics fires WhatsApp on auth/rate

Augments the existing catch in runGoogleHotMetricsBranch: after the
recHotPair('transient_error') write, also fires notifyTokenFailure
with google_hot_metrics_rate_limit or google_hot_metrics_auth
operation key for the operator WhatsApp.

Re-throw preserves Inngest retry semantics.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: notifyTokenFailure in tiktok hot_metrics catch

**Files:**
- Modify: `dashboard-web/src/inngest/functions/tiktokWorker.ts` (existing try at line 419 — verify the catch structure during implementation)
- Modify: `dashboard-web/src/inngest/functions/__tests__/tiktokWorker.test.ts`

Same pattern as Task 3 but for TikTok.

- [ ] **Step 1: Add 2 failing tests for auth + rate-limit paths**

Append to `dashboard-web/src/inngest/functions/__tests__/tiktokWorker.test.ts`:

```typescript
it('Phase E1: tiktok hot_metrics fetch rejects with rate-limit → notifyTokenFailure(tiktok_hot_metrics_rate_limit)', async () => {
  const notifyTokenFailure = vi.fn().mockResolvedValue(undefined);
  const err = new Error('TikTok report API: code=40001 rate limit exceeded');
  const fetchHotMetrics = vi.fn().mockRejectedValue(err);
  await expect(runTikTokWorkerJob({
    jobData: { store_id: 'uzoshop', scope: 'hot_metrics', tick_id: 'T', staleness_seconds: 300, budget_pct_estimate: 0 },
    loadStoreMap: async () => ({}),
    fetchStatus: vi.fn(), fetchHotMetrics,
    getHotCampaignIds: async () => ['TC1'], getHotAdgroupIds: async () => ['TG1'], getHotAdIds: async () => [],
    loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
    upsertRegistry: vi.fn(), insertStatusEvents: vi.fn(),
    upsertCampaignsDaily: vi.fn(), upsertAdsDaily: vi.fn(),
    recordFreshness: vi.fn(),
    notifyTokenFailure,
    nowIso: NOW_ISO,
    isTikTokConfigured: () => true,
    getAccount: async () => ({ advertiserId: 'ADV1', accessToken: 'TOK', accountCurrency: 'USD' }),
    getFxCadFor: async () => async () => 1,
  })).rejects.toThrow('rate limit');
  expect(notifyTokenFailure).toHaveBeenCalledOnce();
  expect(notifyTokenFailure.mock.calls[0][0].operation).toBe('tiktok_hot_metrics_rate_limit');
});

it('Phase E1: tiktok hot_metrics fetch rejects with auth → notifyTokenFailure(tiktok_hot_metrics_auth)', async () => {
  const notifyTokenFailure = vi.fn().mockResolvedValue(undefined);
  const err = new Error('TikTok report API: code=40105 access token invalid');
  const fetchHotMetrics = vi.fn().mockRejectedValue(err);
  await expect(runTikTokWorkerJob({
    jobData: { store_id: 'uzoshop', scope: 'hot_metrics', tick_id: 'T', staleness_seconds: 300, budget_pct_estimate: 0 },
    loadStoreMap: async () => ({}),
    fetchStatus: vi.fn(), fetchHotMetrics,
    getHotCampaignIds: async () => ['TC1'], getHotAdgroupIds: async () => ['TG1'], getHotAdIds: async () => [],
    loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
    upsertRegistry: vi.fn(), insertStatusEvents: vi.fn(),
    upsertCampaignsDaily: vi.fn(), upsertAdsDaily: vi.fn(),
    recordFreshness: vi.fn(),
    notifyTokenFailure,
    nowIso: NOW_ISO,
    isTikTokConfigured: () => true,
    getAccount: async () => ({ advertiserId: 'ADV1', accessToken: 'TOK', accountCurrency: 'USD' }),
    getFxCadFor: async () => async () => 1,
  })).rejects.toThrow('access token invalid');
  expect(notifyTokenFailure).toHaveBeenCalledOnce();
  expect(notifyTokenFailure.mock.calls[0][0].operation).toBe('tiktok_hot_metrics_auth');
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx vitest run src/inngest/functions/__tests__/tiktokWorker.test.ts
```

Expected: 2 new tests fail.

- [ ] **Step 3: Add `notifyTokenFailure` field to `RunTikTokWorkerJobInput`**

In `tiktokWorker.ts`, locate `RunTikTokWorkerJobInput` type. Add (after the `deleteStaleAttributionRows` field added in the Phase D soak fix):

```typescript
  /**
   * Phase E1 (2026-05-30) — operator WhatsApp alert hook for the
   * hot_metrics branch. Invoked with operation 'tiktok_hot_metrics_*'
   * on auth/rate-limit errors. Optional for backwards-compat with
   * existing test fixtures.
   */
  notifyTokenFailure?: (input: {
    provider: 'meta' | 'google' | 'tiktok';
    storeId: string;
    operation: string;
    errorMsg: string;
    advice?: string;
  }) => Promise<void>;
```

- [ ] **Step 4: Add notifyTokenFailure to existing catch + import detectors**

At top of `tiktokWorker.ts`, add (if not already present):

```typescript
import { isAuthError, isRateLimitError } from '@/lib/notifications/detectAuthError';
```

In `runTikTokHotMetricsBranch`, locate the existing catch block (around line 480-490 — verify by reading `grep -n "catch (err)" tiktokWorker.ts` and picking the one inside `runTikTokHotMetricsBranch`). Replace:

```typescript
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recHotPair('transient_error', message);
    throw err;
  }
```

with:

```typescript
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recHotPair('transient_error', message);
    const isRate = isRateLimitError('tiktok', message);
    const isAuth = isAuthError('tiktok', message);
    if ((isRate || isAuth) && input.notifyTokenFailure) {
      await input.notifyTokenFailure({
        provider: 'tiktok',
        storeId,
        operation: isRate ? 'tiktok_hot_metrics_rate_limit' : 'tiktok_hot_metrics_auth',
        errorMsg: message,
        advice: isRate
          ? 'TikTok reported HTTP 429 / code=40001 quota exceeded. Hot metrics worker will retry on next orchestrator tick (10 min). No operator action needed unless this persists.'
          : 'Refresh the TikTok access token. See docs/PROPS-MAP.md (UZOSHOP_TIKTOK_ACCESS_TOKEN).',
      }).catch((alertErr) => {
        console.warn(`tiktokWorker hot_metrics ${isRate ? 'rate' : 'auth'} alert threw: ${alertErr instanceof Error ? alertErr.message : alertErr}`);
      });
    }
    throw err;
  }
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx vitest run src/inngest/functions/__tests__/tiktokWorker.test.ts
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/inngest/functions/tiktokWorker.ts \
        dashboard-web/src/inngest/functions/__tests__/tiktokWorker.test.ts
git commit -m "$(cat <<'EOF'
feat(phase-e1): tiktokWorker hot_metrics fires WhatsApp on auth/rate

Augments the existing catch in runTikTokHotMetricsBranch: after the
recHotPair('transient_error') write, also fires notifyTokenFailure
with tiktok_hot_metrics_rate_limit or tiktok_hot_metrics_auth
operation key.

Re-throw preserves Inngest retry.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Wire production adapters + disable cronLiveHeavyFunctions

**Files:**
- Modify: `dashboard-web/src/inngest/functions/metaWorker.ts` (Inngest binding at bottom)
- Modify: `dashboard-web/src/inngest/functions/googleWorker.ts` (Inngest binding at bottom)
- Modify: `dashboard-web/src/inngest/functions/tiktokWorker.ts` (Inngest binding at bottom)
- Modify: `dashboard-web/src/inngest/functions/cronLiveHeavy.ts:485`
- Modify: `dashboard-web/src/app/api/inngest/route.ts:100, 142`
- Modify: `dashboard-web/src/inngest/functions/__tests__/cronLiveHeavyBudgetSkip.test.ts:264-267`

The new `notifyTokenFailure` parameter is OPTIONAL in the workers' input types. For production we have to actually wire `notifyTokenFailure` into each worker's Inngest binding, otherwise the WhatsApp never fires in prod.

- [ ] **Step 1: Wire notifyTokenFailure in metaWorker Inngest binding**

In `metaWorker.ts`, locate the `inngest.createFunction` block (search for `'meta-worker'` or `MAKE_META_WORKER` — depends on exact pattern). In the dependency-injection object (next to other adapters), import + supply notifyTokenFailure:

Add import at top:
```typescript
import { notifyTokenFailure } from '@/lib/notifications/notifyTokenFailure';
```

Then in the binding's `runMetaWorkerJob({...})` call, add:
```typescript
        notifyTokenFailure: async (inp) =>
          notifyTokenFailure({
            provider: inp.provider,
            storeId: inp.storeId,
            operation: inp.operation,
            errorMsg: inp.errorMsg,
            advice: inp.advice,
          }),
```

- [ ] **Step 2: Wire notifyTokenFailure in googleWorker Inngest binding**

Same pattern in `googleWorker.ts`. Add import + adapter in the binding.

- [ ] **Step 3: Wire notifyTokenFailure in tiktokWorker Inngest binding**

Same in `tiktokWorker.ts`.

- [ ] **Step 4: Disable cronLiveHeavyFunctions export**

In `cronLiveHeavy.ts`, replace line 485:

```typescript
export const cronLiveHeavyFunctions = ALL_STORES.map(makeCronLiveHeavy);
```

with:

```typescript
// Phase E1 (2026-05-30) — DISABLED. The 3 per-store cron-live-heavy
// Inngest functions are no longer registered. cron-tick-orchestrator
// (every 10 min) is the single source of live truth for
// campaigns_daily + ads_daily refreshes via the hot_metrics worker
// branches in metaWorker / googleWorker / tiktokWorker. The
// runHeavyForStore + makeCronLiveHeavy + persistCampaignsLive code is
// retained for (a) existing vitest fixtures and (b) potential
// rollback via git revert. See:
// docs/superpowers/specs/2026-05-30-phase-e1-decommission-cron-live-heavy-design.md
export const cronLiveHeavyFunctions: never[] = [];
```

- [ ] **Step 5: Update the test that asserts length === 3**

In `dashboard-web/src/inngest/functions/__tests__/cronLiveHeavyBudgetSkip.test.ts`, locate lines 264-267 (the assertion `expect(cronLiveHeavyFunctions.length).toBe(3)`). Replace with:

```typescript
    const { cronLiveHeavyFunctions } = await import('../cronLiveHeavy');
    // Phase E1 (2026-05-30) — cronLiveHeavyFunctions is now an empty
    // array. The factory loop was removed; runHeavyForStore +
    // makeCronLiveHeavy are retained for in-process tests (this test
    // file directly drives runHeavyForStore — it doesn't go through
    // the Inngest binding).
    expect(cronLiveHeavyFunctions.length).toBe(0);
```

- [ ] **Step 6: Run all worker + cronLiveHeavy tests**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx vitest run src/inngest/functions/__tests__/
```

Expected: all PASS.

- [ ] **Step 7: Type-check**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 8: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/inngest/functions/metaWorker.ts \
        dashboard-web/src/inngest/functions/googleWorker.ts \
        dashboard-web/src/inngest/functions/tiktokWorker.ts \
        dashboard-web/src/inngest/functions/cronLiveHeavy.ts \
        dashboard-web/src/inngest/functions/__tests__/cronLiveHeavyBudgetSkip.test.ts
git commit -m "$(cat <<'EOF'
feat(phase-e1): disable cron-live-heavy + wire notifyTokenFailure adapters

Sets cronLiveHeavyFunctions to []. The 3 per-store Inngest functions
are no longer registered; cron-tick-orchestrator (every 10 min)
becomes the single source of live truth for campaigns_daily +
ads_daily refreshes.

Wires the new notifyTokenFailure dependency in the production Inngest
bindings of metaWorker / googleWorker / tiktokWorker — the workers
NOW fire WhatsApp on auth/rate/budget_skip errors (operation keys
*_hot_metrics_*) that cron-live-heavy used to fire.

runHeavyForStore + persistCampaignsLive source remains in repo: (a)
existing vitest fixtures still drive it; (b) cron-daily nightly run
still uses persistCampaignsLive; (c) rollback = git revert this commit.

Test cronLiveHeavyFunctions.length updated from 3 → 0.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Pre-deploy verification gate

**Files:** (none — verification only)

- [ ] **Step 1: Run full vitest suite**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx vitest run
```

Expected: ≥1554/1554 tests pass (1546 baseline + 8 new tests: 1 BUC, 2 meta rate/auth, 2 google, 2 tiktok, 1 cronLiveHeavyFunctions.length update).

- [ ] **Step 2: Run typecheck**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Run reconcile harness — hot_metrics vs cron-live-heavy parity**

This is the critical signal that hot_metrics has been writing equivalent data. After Task 5 is deployed and cron-live-heavy stops running, this harness becomes meaningless (no heavy rows to compare against), so run it NOW while both still ran historically.

```bash
cd /Users/dorperetz/script-roas/dashboard-web
SUPABASE_URL=$(grep "^supabase.url" /Users/dorperetz/script-roas/.env | sed 's/^[^=]*= *//' | tr -d ' ') \
SUPABASE_SERVICE_ROLE_KEY=$(grep "^supabase.service.role.key" /Users/dorperetz/script-roas/.env | sed 's/^[^=]*= *//' | tr -d ' ') \
npm run audit:reconcile:hot-vs-heavy
```

Expected: PASS. If any divergence (>10% on any metric for any (store, platform)), stop and investigate before push.

---

### Task 7: Push, deploy, post-deploy verification, docs, memory

**Files:**
- Modify: `docs/ARCHITECTURE.md` (add Phase E1 subsection, mark cron-live-heavy §Phase 13.9 as superseded)
- Modify: `docs/USER-MANUAL.md` (version bump + latency note)
- Create: `~/.claude/projects/-Users-dorperetz-script-roas/memory/project_phase_e1_decommission_cron_live_heavy_shipped.md`
- Modify: `~/.claude/projects/-Users-dorperetz-script-roas/memory/MEMORY.md`

- [ ] **Step 1: Update docs/ARCHITECTURE.md**

Open `docs/ARCHITECTURE.md`. Locate the "Phase D soak fix #2" subsection (most recent addition). Append a new subsection AFTER it:

```markdown
## Phase E1 — Decommission `cron-live-heavy` (2026-05-30)

The 3 per-store `cron-live-heavy` Inngest functions are no longer
registered. `cron-tick-orchestrator` (every 10 min) is the single
source of live truth for `campaigns_daily` + `ads_daily` refreshes via
the hot_metrics worker branches in `metaWorker` / `googleWorker` /
`tiktokWorker`.

### What moved
- **Token-failure WhatsApp alerts** (auth/rate errors): cron-live-heavy
  fired these per provider per store per date with operation keys
  `cron_live_heavy_rate_limit` / `cron_live_heavy_auth`. After E1, the
  3 hot_metrics worker branches fire equivalents with NEW operation
  keys (`meta_hot_metrics_rate_limit`, `google_hot_metrics_auth`,
  `tiktok_hot_metrics_rate_limit`, etc.). New keys keep the
  notifyTokenFailure throttle clean if cron-live-heavy is ever
  re-enabled via rollback.
- **Meta BUC pre-flight gate**: the metaWorker hot_metrics branch
  already had the gate (lines 337-347) but did NOT fire a WhatsApp on
  budget_skip. E1 adds the suppressed-WhatsApp call
  (`meta_hot_metrics_budget_skip` operation) so the operator sees BUC
  throttling on `/operator` and gets a DB notification record without
  the panic ping.

### What stays
- `cronLiveHeavy.ts` source — `runHeavyForStore` + `makeCronLiveHeavy`
  remain. Existing vitest fixtures drive `runHeavyForStore` directly
  (don't go through Inngest).
- `persistCampaignsLive.ts` source — `cron-daily` (nightly
  authoritative pass) still calls it. No change.
- `agg_tiktok_spend_per_store_for_date` RPC — still useful for
  cron-daily.

### Why now
The Phase C reconcile harness `audit:reconcile:hot-vs-heavy` proved
parity for hot_metrics writes. Phase D's coverage parity + the 0%
BACKFILL_UNKNOWN snapshot at HEAD `a9db94f` proved stable status
ingestion. Per user 2026-05-30, the scope-memo's "~1 week soak" prereq
was waived.

### Savings
- Frees 1 Vercel cron slot (cron-live-heavy was 3 functions × 1 cron
  each = 3 schedules).
- ~30% reduction in cron API load (cron-live-heavy was the heaviest
  per-tick burden — full per-platform metrics fetch every 30 min).
- Freshness improves: `campaigns_daily.last_live_tick_at` updates
  every ≤10 min instead of every ≤30 min.

### Rollback
`git revert` the E1 commits + push. cron-live-heavy returns to service
on next Inngest sync (within minutes). Self-healing: the next
cron-live-heavy tick writes the same campaigns_daily rows hot_metrics
was writing, no data loss.
```

Also locate the existing §Phase 13.9 ("cron-live-heavy split") and add a one-line note at its top:

```markdown
> **DECOMMISSIONED in Phase E1 (2026-05-30).** Kept here for historical
> reference. See §Phase E1 below for the current live tick architecture.
```

- [ ] **Step 2: Update User Manual version + latency note**

Open `docs/USER-MANUAL.md`. Find the version string (top of file or "Last updated" header). Bump by 0.0.1 (e.g., `2.2.0` → `2.2.1`). Then find any section mentioning "30 min" / "live update frequency" / "cron-live-heavy" / "freshness" — replace the user-visible language so it says "10 min" instead of "30 min" for live tick frequency.

If no user-facing section explicitly states the cadence, add to the relevant section (e.g., the freshness explainer) a one-line note:

```markdown
> **Update frequency (Phase E1, 2026-05-30):** Live metric refreshes
> now run every ~10 minutes (previously ~30 minutes). The operator
> dashboard's `last_live_tick_at` indicator and Today/Today-Live views
> reflect the new cadence automatically.
```

- [ ] **Step 3: Push**

```bash
cd /Users/dorperetz/script-roas
git add docs/ARCHITECTURE.md docs/USER-MANUAL.md
git commit -m "$(cat <<'EOF'
docs(phase-e1): ARCHITECTURE §Phase E1 + User Manual 10-min cadence

Documents the cron-live-heavy decommission, the 3 worker alert
transfers, and the Meta BUC pre-flight + WhatsApp addition. Marks
§Phase 13.9 as superseded.

User Manual bumped to 2.2.1 with the live-tick cadence change from
~30 min to ~10 min (operator-visible).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
```

Expected: pre-push gates pass (tsc + vitest + docs-currency). Push succeeds.

- [ ] **Step 4: Wait for Vercel build (~3-5 min)**

Inngest sync happens automatically when the new build serves the `/api/inngest` endpoint. The 3 cronLiveHeavy* functions disappear from Inngest registry on first Inngest poll after deploy.

Use `Monitor` to watch the deploy:

```bash
until curl -sS -I https://roas-dashboard-smoky.vercel.app | grep -qi 'x-vercel-id'; do sleep 30; done
echo "Vercel responding"
```

- [ ] **Step 5: Verify Inngest dashboard**

Operator-only step. Open the Inngest dashboard for the project. Confirm `cron-live-heavy-uzoshop`, `cron-live-heavy-zolplus`, `cron-live-heavy-usmile360` are NO LONGER in the function list (or shown as "removed").

- [ ] **Step 6: Wait ≥10 min for an orchestrator tick post-deploy**

Then run the live coverage parity harness + a fresh `last_live_tick_at` lag check:

```bash
cd /Users/dorperetz/script-roas/dashboard-web
SUPABASE_URL=$(grep "^supabase.url" /Users/dorperetz/script-roas/.env | sed 's/^[^=]*= *//' | tr -d ' ') \
SUPABASE_SERVICE_ROLE_KEY=$(grep "^supabase.service.role.key" /Users/dorperetz/script-roas/.env | sed 's/^[^=]*= *//' | tr -d ' ') \
AUDIT_LIVE=1 npx vitest run src/lib/audit/__tests__/registryCoverageParity.live.test.ts
```

Expected: 4/4 PASS (unchanged from Phase D close).

Then check freshness lag via REST API:

```bash
SUPABASE_URL=$(grep "^supabase.url" /Users/dorperetz/script-roas/.env | sed 's/^[^=]*= *//' | tr -d ' ')
SUPABASE_KEY=$(grep "^supabase.service.role.key" /Users/dorperetz/script-roas/.env | sed 's/^[^=]*= *//' | tr -d ' ')
curl -sS "${SUPABASE_URL}/rest/v1/data_freshness?scope=eq.campaign_metrics&order=platform,store_id" \
  -H "apikey: ${SUPABASE_KEY}" -H "Authorization: Bearer ${SUPABASE_KEY}" \
  | jq -r --argjson now "$(date +%s)" '
    def parse_iso: . | gsub("\\.\\d+"; "") | gsub("\\+00:00"; "Z") | fromdateiso8601;
    (.[] | "\(.platform)/\(.store_id)  last_success=\(.last_success_at)  status=\(.status)  lag_min=\((($now - (.last_success_at | parse_iso)) / 60 | floor))")
  '
```

Expected: every (platform/store_id) shows `status=success` AND `lag_min ≤ 15`.

- [ ] **Step 7: Write memory + update MEMORY.md**

Create `~/.claude/projects/-Users-dorperetz-script-roas/memory/project_phase_e1_decommission_cron_live_heavy_shipped.md`:

```markdown
---
name: phase-e1-decommission-cron-live-heavy-shipped
description: Phase E1 SHIPPED 2026-05-30 — cron-live-heavy soft-disabled (3 Inngest functions no longer registered). Token-failure WhatsApp alerts transferred to meta/google/tiktok hot_metrics workers with new *_hot_metrics_* operation keys. Meta BUC pre-flight WhatsApp added to metaWorker.
metadata:
  type: project
---

# Phase E1 — cron-live-heavy decommission SHIPPED 2026-05-30

**HEAD on origin/main:** `<COMMIT_HASH>` (replace with actual)
**Push range:** `7641951..<HEAD>` (E1 spec at 7641951 + N implementation commits)

## What landed
- `cronLiveHeavyFunctions = []` (was `ALL_STORES.map(makeCronLiveHeavy)`)
- `metaWorker.runMetaHotMetricsBranch`: try/catch wrap + notifyTokenFailure on auth/rate + on BUC budget_skip
- `googleWorker.runGoogleHotMetricsBranch`: notifyTokenFailure on auth/rate in existing catch
- `tiktokWorker.runTikTokHotMetricsBranch`: notifyTokenFailure on auth/rate in existing catch
- 7 new vitest tests (1 BUC + 2 meta auth/rate + 2 google + 2 tiktok)
- ARCHITECTURE §Phase E1 + §Phase 13.9 superseded note
- User Manual 2.2.1 — live tick cadence 30 min → 10 min

## Acceptance verified
- ✅ 3 cronLiveHeavy* Inngest functions removed from registry
- ✅ Live coverage parity harness 4/4 green post-deploy
- ✅ data_freshness.campaign_metrics for all 9 (store × platform) tuples: status=success, lag_min ≤ 15
- ✅ Full vitest ≥1554/1554 green
- ✅ Operator received no false-positive WhatsApp during 24h soak

## Phase E next: E2 (ad-level status workers)
Per [[phase-e-scope-decision]], next sub-project is ad-level status
workers (`metaAdStatus` + `tiktokAdStatus`). Google PMax has no
ad-level status. Use the same orchestrator scope pattern as Phase B/C.

## Related
- [[phase-e-scope-decision]] — scope locked to E1-E4 only
- [[handoff-phase-d-deployed-soak-in-progress]] — predecessor
- [[script-roas-dashboard]] — overall architecture
```

Add a line to `~/.claude/projects/-Users-dorperetz-script-roas/memory/MEMORY.md`:

```markdown
- [Phase E1 SHIPPED 2026-05-30](project_phase_e1_decommission_cron_live_heavy_shipped.md) — cron-live-heavy 3 Inngest functions disabled (HEAD `<COMMIT_HASH>`). Token-failure WhatsApp + Meta BUC alert transferred to 3 hot_metrics worker branches with new `*_hot_metrics_*` operation keys. Freshness improves 30→10 min. Phase E2 next (ad-level status workers)
```

## Self-review (writing-plans skill)

**1. Spec coverage check:**
- ✅ Soft-disable mechanism (factory loop removal) — Task 5
- ✅ Token-failure alert transfer for meta — Task 1 (BUC) + Task 2 (auth/rate)
- ✅ Token-failure alert transfer for google — Task 3
- ✅ Token-failure alert transfer for tiktok — Task 4
- ✅ Production Inngest binding wires notifyTokenFailure — Task 5 Steps 1-3
- ✅ Pre-deploy reconcile harness — Task 6 Step 3
- ✅ Inngest dashboard verification post-deploy — Task 7 Step 5
- ✅ Coverage parity post-deploy + lag check — Task 7 Step 6
- ✅ ARCHITECTURE update — Task 7 Step 1
- ✅ User Manual bump — Task 7 Step 2
- ✅ Memory + MEMORY.md updates — Task 7 Step 7
- ✅ Rollback procedure documented — in ARCHITECTURE §Phase E1 + spec §Verification

**2. Placeholder scan:**
- `<COMMIT_HASH>` in Task 7 Step 7 is a fill-in by the executor at memory-write time (after the actual final commit hash is known). Not a placeholder in the bad sense — flagged with `(replace with actual)`.

**3. Type consistency:**
- `notifyTokenFailure` signature matches across Tasks 1-5 (all use the same `{provider, storeId, operation, errorMsg, advice?}` shape).
- Operation key conventions: `<platform>_hot_metrics_<reason>` consistent across all 6 keys.
- All 3 worker bindings wire `notifyTokenFailure` via the same import + adapter pattern.

---

# E1.5 ADDITION (2026-05-30) — cron-live cleanup tasks

User decision (2026-05-30): merge into the same E1 PR. These 4 new tasks insert BEFORE the original Task 5 (disable cronLiveHeavyFunctions) — placeholders MUST land in workers before we strip them from cron-live. Then the existing Task 5 absorbs the cron-live cleanup as well.

**Execution order (final):**
1-4 (token alert transfers, as already specified)
→ **8** (Meta status worker placeholder enrollment)
→ **9** (Google status worker placeholder enrollment)
→ **10** (TikTok status worker placeholder enrollment)
→ **11** (Disable cronLiveHeavyFunctions + STRIP cron-live's 5 platform steps + wire notifyTokenFailure adapters) — supersedes original Task 5
→ 6 (pre-deploy verify) → 7 (push + post-deploy + docs)

---

### Task 8: Meta status worker placeholder enrollment

**Files:**
- Modify: `dashboard-web/src/inngest/functions/metaWorker.ts` (the `runMetaStatusBranch` function)
- Modify: `dashboard-web/src/inngest/functions/__tests__/metaWorker.test.ts`

After the existing 3 registry upserts in `runMetaStatusBranch`, filter fresh adsets to platform-active (`effective_status === 'ACTIVE'`) and UPSERT placeholder rows into `campaigns_daily`. Mirrors what cron-live's `enroll-active-ad-sets` step did for Meta — moves it from the merged-stores cron-live into the per-store Meta worker.

- [ ] **Step 1: Write failing test**

Append to `dashboard-web/src/inngest/functions/__tests__/metaWorker.test.ts` (inside the `describe('runMetaStatusBranch')` block or equivalent):

```typescript
it('Phase E1.5: ACTIVE adsets UPSERT placeholder rows into campaigns_daily (no metrics)', async () => {
  const fetchStatus = vi.fn().mockResolvedValue({
    campaigns: [{
      store_id: 'uzoshop', platform: 'meta', campaign_id: 'C1', name: 'Camp 1',
      configured_status: 'ACTIVE', effective_status: 'ACTIVE', delivery_status: 'DELIVERING',
      is_enabled: true, is_serving: true,
      first_seen_at: '__placeholder__', last_seen_at: '__placeholder__',
      platform_updated_at: null, status_changed_at: null,
      last_metrics_success_at: null, last_status_success_at: null,
      raw_status_payload: null, missed_seen_count: 0, is_removed: false,
    }],
    adsets: [{
      store_id: 'uzoshop', platform: 'meta', campaign_id: 'C1', adset_id: 'A1', name: 'Adset 1',
      configured_status: 'ACTIVE', effective_status: 'ACTIVE', delivery_status: 'DELIVERING',
      is_enabled: true, is_serving: true,
      first_seen_at: null, last_seen_at: null,
      platform_updated_at: null, status_changed_at: null,
      last_metrics_success_at: null, last_status_success_at: null,
      raw_status_payload: null, missed_seen_count: 0, is_removed: false,
    }, {
      store_id: 'uzoshop', platform: 'meta', campaign_id: 'C2', adset_id: 'A2', name: 'Adset 2 (paused)',
      configured_status: 'PAUSED', effective_status: 'PAUSED', delivery_status: 'NOT_DELIVERING',
      is_enabled: false, is_serving: false,
      first_seen_at: null, last_seen_at: null,
      platform_updated_at: null, status_changed_at: null,
      last_metrics_success_at: null, last_status_success_at: null,
      raw_status_payload: null, missed_seen_count: 0, is_removed: false,
    }],
    ads: [],
  });
  const upsertCampaignsDaily = vi.fn().mockResolvedValue(undefined);
  await runMetaWorkerJob({
    jobData: { store_id: 'uzoshop', scope: 'status', tick_id: 'T', staleness_seconds: 600, budget_pct_estimate: 0 } as never,
    bucProbe: async () => ({ etaMinutes: 0, pct: 10 }),
    fetchStatus, fetchHotMetrics: vi.fn(),
    getHotCampaignIds: async () => [], getHotAdsetIds: async () => [], getHotAdIds: async () => [],
    loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
    upsertRegistry: vi.fn(), insertStatusEvents: vi.fn(),
    upsertCampaignsDaily, upsertAdsDaily: vi.fn(),
    getCredentials: async () => ({ adAccountId: 'act_1', accessToken: 'tok', getFxCadFor: async () => async () => 1 } as never),
    recordFreshness: vi.fn(),
    nowIso: '2026-05-30T16:30:00.000Z',
  });
  // Only the ACTIVE adset should get a placeholder; PAUSED is dropped.
  expect(upsertCampaignsDaily).toHaveBeenCalledOnce();
  const rows = upsertCampaignsDaily.mock.calls[0][0];
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    date: '2026-05-30',
    store_id: 'uzoshop',
    platform: 'meta',
    campaign_id: 'C1',
    ad_set_id: 'A1',
    effective_status: 'ACTIVE',
  });
  // CRITICAL: payload omits metric columns so they're preserved on conflict.
  expect(rows[0]).not.toHaveProperty('spend_cad');
  expect(rows[0]).not.toHaveProperty('impressions');
  expect(rows[0]).not.toHaveProperty('clicks');
  expect(rows[0]).not.toHaveProperty('conversions');
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx vitest run src/inngest/functions/__tests__/metaWorker.test.ts -t "ACTIVE adsets UPSERT placeholder"
```

Expected: FAIL — `expected "spy" to be called once, but got 0 times`.

- [ ] **Step 3: Add placeholder enrollment after the upsertRegistry calls in runMetaStatusBranch**

In `metaWorker.ts`, in `runMetaStatusBranch` (the existing status branch), AFTER the 3 `upsertRegistry({table: 'ad_registry'...})` call and BEFORE the `recAllStatusScopes('success')` call (look for these landmarks). Insert:

```typescript
    // Phase E1.5 (2026-05-30) — placeholder enrollment migrated from
    // cron-live's enroll-active-ad-sets step. The status worker now
    // owns the per-store enrollment for Meta: any ACTIVE adset gets a
    // placeholder row in campaigns_daily (no metric columns) so it
    // appears in the dashboard within 10 min of going live, even if
    // hot_metrics hasn't yet fetched real spend. Without this, the
    // postgresReaders.fetchCampaigns row-existence check would drop
    // zero-spend active rows until cron-daily runs ~24h later.
    if (input.upsertCampaignsDaily) {
      const today = nowIso.slice(0, 10);
      const activePlaceholders = status.adsets
        .filter((a) => a.effective_status === 'ACTIVE')
        .map((a) => ({
          date: today,
          store_id: a.store_id,
          platform: 'meta' as const,
          campaign_id: a.campaign_id,
          campaign_name: status.campaigns.find((c) => c.campaign_id === a.campaign_id)?.name ?? '',
          ad_set_id: a.adset_id,
          ad_set_name: a.name ?? '',
          effective_status: a.effective_status,
        }));
      if (activePlaceholders.length > 0) {
        await input.upsertCampaignsDaily(activePlaceholders);
      }
    }
```

- [ ] **Step 4: Run to verify it passes**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx vitest run src/inngest/functions/__tests__/metaWorker.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/inngest/functions/metaWorker.ts \
        dashboard-web/src/inngest/functions/__tests__/metaWorker.test.ts
git commit -m "$(cat <<'EOF'
feat(phase-e1.5): metaWorker status branch enrolls ACTIVE adset placeholders

After the registry upserts, runMetaStatusBranch now UPSERTs placeholder
rows into campaigns_daily for any ACTIVE Meta adset (no metric columns
in payload → preserved on conflict, default 0 on insert). This migrates
the enrollment behavior cron-live used to perform for all 3 stores
into the per-store Meta worker — needed before stripping cron-live's
enrollment step in Task 11.

Without this, postgresReaders.fetchCampaigns:678-690 would drop a
freshly-activated ad-set with zero spend until cron-daily runs ~24h
later (the row-existence + effective_status active-check requires SOME
row in campaigns_daily).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Google status worker placeholder enrollment

**Files:**
- Modify: `dashboard-web/src/inngest/functions/googleWorker.ts` (`runGoogleStatusBranch`)
- Modify: `dashboard-web/src/inngest/functions/__tests__/googleWorker.test.ts`

Same as Task 8 but for Google. Google's "active" criterion is `effective_status === 'ENABLED'`.

- [ ] **Step 1: Write failing test**

Append to `dashboard-web/src/inngest/functions/__tests__/googleWorker.test.ts`:

```typescript
it('Phase E1.5: ENABLED adsets UPSERT placeholder rows into campaigns_daily (no metrics)', async () => {
  const fetchStatus = vi.fn().mockResolvedValue({
    campaigns: [{
      store_id: 'uzoshop', platform: 'google', campaign_id: 'GC1', name: 'Camp 1',
      configured_status: 'ENABLED', effective_status: 'SERVING', delivery_status: 'DELIVERING',
      is_enabled: true, is_serving: true,
      first_seen_at: '__placeholder__', last_seen_at: '__placeholder__',
      platform_updated_at: null, status_changed_at: null,
      last_metrics_success_at: null, last_status_success_at: null,
      raw_status_payload: null, missed_seen_count: 0, is_removed: false,
    }],
    adsets: [{
      store_id: 'uzoshop', platform: 'google', campaign_id: 'GC1', adset_id: 'GA1', name: 'AdGroup 1',
      configured_status: 'ENABLED', effective_status: 'ENABLED', delivery_status: 'DELIVERING',
      is_enabled: true, is_serving: true,
      first_seen_at: null, last_seen_at: null,
      platform_updated_at: null, status_changed_at: null,
      last_metrics_success_at: null, last_status_success_at: null,
      raw_status_payload: null, missed_seen_count: 0, is_removed: false,
    }, {
      store_id: 'uzoshop', platform: 'google', campaign_id: 'GC2', adset_id: 'GA2', name: 'Paused',
      configured_status: 'PAUSED', effective_status: 'PAUSED', delivery_status: 'NOT_DELIVERING',
      is_enabled: false, is_serving: false,
      first_seen_at: null, last_seen_at: null,
      platform_updated_at: null, status_changed_at: null,
      last_metrics_success_at: null, last_status_success_at: null,
      raw_status_payload: null, missed_seen_count: 0, is_removed: false,
    }],
    ads: [],
  });
  const upsertCampaignsDaily = vi.fn().mockResolvedValue(undefined);
  await runGoogleWorkerJob({
    jobData: { store_id: 'uzoshop', scope: 'status', tick_id: 'T', staleness_seconds: 600, budget_pct_estimate: 0 } as never,
    fetchStatus, fetchHotMetrics: vi.fn(),
    getHotCampaignIds: async () => [], getHotAdgroupIds: async () => [], getHotAdIds: async () => [],
    loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
    upsertRegistry: vi.fn(), insertStatusEvents: vi.fn(),
    upsertCampaignsDaily, upsertAdsDaily: vi.fn(),
    getCustomer: async () => ({ searchStream: async () => [] }),
    recordFreshness: vi.fn(),
    nowIso: '2026-05-30T16:30:00.000Z',
    isGoogleConfigured: () => true,
  });
  expect(upsertCampaignsDaily).toHaveBeenCalledOnce();
  const rows = upsertCampaignsDaily.mock.calls[0][0];
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    date: '2026-05-30',
    store_id: 'uzoshop',
    platform: 'google',
    campaign_id: 'GC1',
    ad_set_id: 'GA1',
    effective_status: 'ENABLED',
  });
  expect(rows[0]).not.toHaveProperty('spend_cad');
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx vitest run src/inngest/functions/__tests__/googleWorker.test.ts -t "ENABLED adsets UPSERT placeholder"
```

Expected: FAIL.

- [ ] **Step 3: Add placeholder enrollment in runGoogleStatusBranch**

In `googleWorker.ts`, in `runGoogleStatusBranch`, AFTER the 3 `upsertRegistry({table: 'ad_registry'...})` call and BEFORE `recAllStatusScopes('success')`:

```typescript
    // Phase E1.5 (2026-05-30) — placeholder enrollment for Google.
    // See metaWorker Task 8 for rationale.
    if (input.upsertCampaignsDaily) {
      const today = nowIso.slice(0, 10);
      const activePlaceholders = status.adsets
        .filter((a) => a.effective_status === 'ENABLED')
        .map((a) => ({
          date: today,
          store_id: a.store_id,
          platform: 'google' as const,
          campaign_id: a.campaign_id,
          campaign_name: status.campaigns.find((c) => c.campaign_id === a.campaign_id)?.name ?? '',
          ad_set_id: a.adset_id,
          ad_set_name: a.name ?? '',
          effective_status: a.effective_status,
        }));
      if (activePlaceholders.length > 0) {
        await input.upsertCampaignsDaily(activePlaceholders);
      }
    }
```

- [ ] **Step 4: Run to verify it passes**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx vitest run src/inngest/functions/__tests__/googleWorker.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/inngest/functions/googleWorker.ts \
        dashboard-web/src/inngest/functions/__tests__/googleWorker.test.ts
git commit -m "$(cat <<'EOF'
feat(phase-e1.5): googleWorker status branch enrolls ENABLED adset placeholders

Same migration as Task 8 but for Google. ENABLED ad-groups in the
fresh status fetch trigger placeholder UPSERTs into campaigns_daily
with no metric columns.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: TikTok status worker placeholder enrollment

**Files:**
- Modify: `dashboard-web/src/inngest/functions/tiktokWorker.ts` (`runTikTokStatusBranch`)
- Modify: `dashboard-web/src/inngest/functions/__tests__/tiktokWorker.test.ts`

TikTok's "active" criterion is the 5 statuses in `TIKTOK_ACTIVE_ENOUGH`: `ADGROUP_STATUS_DELIVERY_OK`, `ADGROUP_STATUS_BUDGET_EXCEED`, `ADGROUP_STATUS_AUDIT`, `ADGROUP_STATUS_REVIEWING`, `ADGROUP_STATUS_NOT_START`. The set already exists — see `cronLive.ts` (referenced by `cronLiveIsActiveForPlatform.test.ts`). Import it.

- [ ] **Step 1: Write failing test**

Append to `dashboard-web/src/inngest/functions/__tests__/tiktokWorker.test.ts`:

```typescript
it('Phase E1.5: delivering/preparing adsets UPSERT placeholder rows into campaigns_daily (no metrics)', async () => {
  const fetchStatus = vi.fn().mockResolvedValue({
    campaigns: [{
      store_id: 'usmile360', platform: 'tiktok', campaign_id: 'TC1', name: 'TT Camp 1',
      configured_status: 'ENABLE', effective_status: 'ADGROUP_STATUS_DELIVERY_OK', delivery_status: 'DELIVERING',
      is_enabled: true, is_serving: true,
      first_seen_at: '__placeholder__', last_seen_at: '__placeholder__',
      platform_updated_at: null, status_changed_at: null,
      last_metrics_success_at: null, last_status_success_at: null,
      raw_status_payload: null, missed_seen_count: 0, is_removed: false,
    }],
    adsets: [{
      store_id: 'usmile360', platform: 'tiktok', campaign_id: 'TC1', adset_id: 'TG1', name: 'AdGroup delivering',
      configured_status: 'ENABLE', effective_status: 'ADGROUP_STATUS_DELIVERY_OK', delivery_status: 'DELIVERING',
      is_enabled: true, is_serving: true,
      first_seen_at: null, last_seen_at: null,
      platform_updated_at: null, status_changed_at: null,
      last_metrics_success_at: null, last_status_success_at: null,
      raw_status_payload: null, missed_seen_count: 0, is_removed: false,
    }, {
      store_id: 'uzoshop', platform: 'tiktok', campaign_id: 'TC2', adset_id: 'TG2', name: 'AdGroup disabled',
      configured_status: 'DISABLE', effective_status: 'ADGROUP_STATUS_CAMPAIGN_DISABLE', delivery_status: 'NOT_DELIVERING',
      is_enabled: false, is_serving: false,
      first_seen_at: null, last_seen_at: null,
      platform_updated_at: null, status_changed_at: null,
      last_metrics_success_at: null, last_status_success_at: null,
      raw_status_payload: null, missed_seen_count: 0, is_removed: false,
    }],
    ads: [],
  });
  const upsertCampaignsDaily = vi.fn().mockResolvedValue(undefined);
  await runTikTokWorkerJob({
    jobData: { store_id: 'uzoshop', scope: 'status', tick_id: 'T', staleness_seconds: 600, budget_pct_estimate: 0 },
    loadStoreMap: async () => ({}),
    fetchStatus, fetchHotMetrics: vi.fn(),
    getHotCampaignIds: async () => [], getHotAdgroupIds: async () => [], getHotAdIds: async () => [],
    loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
    upsertRegistry: vi.fn(), insertStatusEvents: vi.fn(),
    upsertCampaignsDaily, upsertAdsDaily: vi.fn(),
    recordFreshness: vi.fn(),
    nowIso: '2026-05-30T16:30:00.000Z',
    isTikTokConfigured: () => true,
    getAccount: async () => ({ advertiserId: 'ADV1', accessToken: 'TOK', accountCurrency: 'USD' }),
  });
  expect(upsertCampaignsDaily).toHaveBeenCalledOnce();
  const rows = upsertCampaignsDaily.mock.calls[0][0];
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    date: '2026-05-30',
    store_id: 'usmile360', // resolved per campaign-store-map, not function arg
    platform: 'tiktok',
    campaign_id: 'TC1',
    ad_set_id: 'TG1',
  });
  expect(rows[0]).not.toHaveProperty('spend_cad');
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx vitest run src/inngest/functions/__tests__/tiktokWorker.test.ts -t "delivering/preparing adsets UPSERT placeholder"
```

Expected: FAIL.

- [ ] **Step 3: Add placeholder enrollment in runTikTokStatusBranch**

In `tiktokWorker.ts`, add import at top:

```typescript
const TIKTOK_ACTIVE_ENOUGH = new Set([
  'ADGROUP_STATUS_DELIVERY_OK',
  'ADGROUP_STATUS_BUDGET_EXCEED',
  'ADGROUP_STATUS_AUDIT',
  'ADGROUP_STATUS_REVIEWING',
  'ADGROUP_STATUS_NOT_START',
]);
```

(Inline because the production constant lives in `cronLive.ts` which we're cleaning up in Task 11; copying the set keeps the worker self-contained without a circular dep.)

In `runTikTokStatusBranch`, AFTER the 3 `upsertRegistry` calls and AFTER the existing Phase D `deleteStaleAttributionRows` call, BEFORE `recAllStatusScopes('success')`:

```typescript
    // Phase E1.5 (2026-05-30) — placeholder enrollment for TikTok.
    // Adset's resolved store_id (already applied by the fetcher via
    // campaign-store-map) is what we write — this mirrors the Phase A.5
    // v2 attribution model.
    if (input.upsertCampaignsDaily) {
      const today = nowIso.slice(0, 10);
      const activePlaceholders = status.adsets
        .filter((a) => TIKTOK_ACTIVE_ENOUGH.has(a.effective_status ?? ''))
        .map((a) => ({
          date: today,
          store_id: a.store_id,
          platform: 'tiktok' as const,
          campaign_id: a.campaign_id,
          campaign_name: status.campaigns.find((c) => c.campaign_id === a.campaign_id)?.name ?? '',
          ad_set_id: a.adset_id,
          ad_set_name: a.name ?? '',
          effective_status: a.effective_status,
        }));
      if (activePlaceholders.length > 0) {
        await input.upsertCampaignsDaily(activePlaceholders);
      }
    }
```

- [ ] **Step 4: Run to verify it passes**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx vitest run src/inngest/functions/__tests__/tiktokWorker.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/inngest/functions/tiktokWorker.ts \
        dashboard-web/src/inngest/functions/__tests__/tiktokWorker.test.ts
git commit -m "$(cat <<'EOF'
feat(phase-e1.5): tiktokWorker status branch enrolls active adset placeholders

Filters fresh TikTok adsets to TIKTOK_ACTIVE_ENOUGH (the 5
delivering/preparing statuses per OPERATOR-1 audit fix 2026-05-23)
and UPSERTs placeholder rows. store_id uses the already-resolved
per-adset attribution (campaign-store-map applied by the fetcher).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Strip cron-live to Shopify-only + disable cronLiveHeavy + wire notifyTokenFailure adapters

This SUPERSEDES the original Task 5 — the cron-live cleanup is folded in.

**Files:**
- Modify: `dashboard-web/src/inngest/functions/metaWorker.ts` (Inngest binding — wire notifyTokenFailure adapter)
- Modify: `dashboard-web/src/inngest/functions/googleWorker.ts` (same)
- Modify: `dashboard-web/src/inngest/functions/tiktokWorker.ts` (same)
- Modify: `dashboard-web/src/inngest/functions/cronLiveHeavy.ts:485`
- Modify: `dashboard-web/src/inngest/functions/cronLive.ts` — remove 5 platform-related step.runs
- Modify: `dashboard-web/src/app/api/inngest/route.ts` — no change needed (cronLiveHeavyFunctions = [] handles it)
- Modify: `dashboard-web/src/inngest/functions/__tests__/cronLiveHeavyBudgetSkip.test.ts:264-267`
- Modify: `dashboard-web/src/inngest/functions/__tests__/cronLive.test.ts` (and any other cronLive*.test.ts that exercises the removed steps — may need to drop those assertions)

- [ ] **Step 1: Wire notifyTokenFailure adapter in metaWorker Inngest binding**

(Same as the original Task 5 Step 1 — see that for the full instructions.)

- [ ] **Step 2: Wire notifyTokenFailure adapter in googleWorker Inngest binding**

(Same as original Task 5 Step 2.)

- [ ] **Step 3: Wire notifyTokenFailure adapter in tiktokWorker Inngest binding**

(Same as original Task 5 Step 3.)

- [ ] **Step 4: Disable cronLiveHeavyFunctions export**

(Same as original Task 5 Step 4 — set `cronLiveHeavyFunctions: never[] = []`.)

- [ ] **Step 5: Strip cron-live to Shopify-only**

In `dashboard-web/src/inngest/functions/cronLive.ts`, remove the following step.runs in order:

(a) The `fetch-status-meta-budgets` step.run (search for `'fetch-status-meta-budgets'` to locate).
(b) The `fetch-status-google-statuses` step.run.
(c) The `fetch-status-tiktok-statuses` step.run.
(d) The combined enrollment block at lines 1396-1456 + the UPSERT at 1481-1513 + the UPDATE at 1565-...
(e) The `tiktokPromise` / `metaPromise` / `googlePromise` allocations and their Promise.all gather block.

Replace the deleted contents with a top-of-function header note:

```typescript
  // Phase E1.5 (2026-05-30) — cron-live is now Shopify-only. The
  // per-platform status fetches + enrollment placeholders + historical
  // effective_status UPDATE have all moved to per-store status workers
  // (metaWorker / googleWorker / tiktokWorker) via the
  // cron-tick-orchestrator (every 10 min). The hot_metrics worker
  // branches handle metric refreshes (also every 10 min, replacing
  // cron-live-heavy). See:
  // docs/superpowers/specs/2026-05-30-phase-e1-decommission-cron-live-heavy-design.md
```

Keep ONLY:
- `fetch-shopify-rolling-3day` step.run
- `persist-rolling-3day` step.run
- The Shopify token-failure alert path (if separate from the platform alerts loop — verify during execution)

- [ ] **Step 6: Update cronLiveHeavyBudgetSkip.test.ts**

Replace assertion `cronLiveHeavyFunctions.length === 3` with `=== 0`. (Same as original Task 5 Step 5.)

- [ ] **Step 7: Update remaining cronLive*.test.ts**

Run `npx vitest run src/inngest/functions/__tests__/cronLive*.test.ts` and inspect failures. Any test that asserted behavior of the removed platform-status steps should be:
- Updated to reflect Shopify-only behavior, OR
- Deleted if it was solely testing now-removed logic.

The Shopify-related tests (`cronLiveLiveTickAt.test.ts`, anything testing the `fetch-shopify-rolling-3day` / `persist-rolling-3day` steps) should still pass.

The `cronLiveIsActiveForPlatform.test.ts` tests the exported `isActiveForPlatform` predicate — that function should be **kept exported** because Task 10 of this plan imports an equivalent set in tiktokWorker. (Or alternatively, move `isActiveForPlatform` to a new shared file `src/lib/registries/platformActive.ts` and update both consumers.)

Decision for this plan: do the simpler thing — keep `isActiveForPlatform` exported from cronLive.ts (it's pure, no I/O, doesn't need to move).

- [ ] **Step 8: Run full vitest + tsc**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx tsc --noEmit && npx vitest run
```

Expected: tsc clean. Vitest: 1546 baseline + 8 token-alert tests + 3 placeholder tests = 1557/1557, minus any cron-live test deletions in Step 7. Note expected delta if tests were dropped.

- [ ] **Step 9: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/inngest/functions/metaWorker.ts \
        dashboard-web/src/inngest/functions/googleWorker.ts \
        dashboard-web/src/inngest/functions/tiktokWorker.ts \
        dashboard-web/src/inngest/functions/cronLiveHeavy.ts \
        dashboard-web/src/inngest/functions/cronLive.ts \
        dashboard-web/src/inngest/functions/__tests__/cronLiveHeavyBudgetSkip.test.ts \
        dashboard-web/src/inngest/functions/__tests__/
git commit -m "$(cat <<'EOF'
feat(phase-e1): disable cron-live-heavy + cron-live → Shopify-only

cronLiveHeavyFunctions = []. The 3 per-store Inngest functions
are no longer registered; cron-tick-orchestrator (every 10 min)
becomes the single source of live truth.

cron-live stripped to Shopify-only (the original 05.6 intent):
removes 5 platform-related step.runs (status fetches for
meta/google/tiktok, enrollment UPSERT, historical
refresh-effective-status UPDATE). The enrollment placeholders +
status discovery + historical refresh are now owned by the per-store
status workers via the cron-tick-orchestrator (Phase B/C/D + Tasks
8-10 of this plan).

Wires notifyTokenFailure into the 3 hot_metrics worker bindings so
auth/rate/budget_skip alerts continue to fire (Tasks 1-4 added the
worker-side wiring; this commit hooks them to production).

runHeavyForStore + persistCampaignsLive source remains in repo:
existing vitest fixtures still drive it; cron-daily nightly run still
uses persistCampaignsLive.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Replacement for original Task 5

**Task 5 is replaced by Task 11** (above). Skip the original Task 5 — its work is fully covered by Task 11.

Original Tasks 6 (pre-deploy verify) and 7 (push + post-deploy + docs) remain unchanged but now follow Tasks 8-11 instead of original Task 5.

---

## Updated self-review (E1.5 additions)

**1. Spec coverage check:** ✅ All E1.5 spec elements covered.
- ✅ Step 1-3 (status fetches) removed in Task 11 Step 5.
- ✅ Step 4 (placeholder enrollment) migrated to workers in Tasks 8, 9, 10.
- ✅ Step 5 (refresh historical effective_status) removed in Task 11 Step 5.
- ✅ Shopify-only cron-live preserved in Task 11 Step 5.

**2. Placeholder scan:** clean. All new tasks have concrete code/test bodies.

**3. Type consistency:** `upsertCampaignsDaily` reused across all 3 worker status branches — same signature already defined in the workers' input types from the hot_metrics branch.
