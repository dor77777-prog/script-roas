# Phase D Soak — Stuck BACKFILL_UNKNOWN Rows Fix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drop all 3 platforms (Meta, Google, TikTok) below 10% BACKFILL_UNKNOWN in `campaign_registry` (currently Meta 0%, Google 33.3%, TikTok 25%), and add structural prevention so the bug can't recur. Closes Phase D so [[phase-e-scope-decision]] can begin.

**Architecture:** Three independently-deployable changes, in order of risk (lowest first):

1. **One-shot SQL migration** (`Task 1`) clears the 4 currently-stuck registry rows via a single, idempotent SQL pass: DELETE for cross-store-attribution duplicates, UPDATE-from-effective_status for rows where the worker can never reach. Immediate effect: all 3 platforms drop to 0%.
2. **Google fetcher BACKFILL_UNKNOWN sweep** (`Task 2`) — the change_status API only returns campaigns that changed in the last 24h, so a long-stable campaign is never re-fetched by the worker. Add an `extraCampaignIds` input to `fetchGoogleStatusForStore` and have `googleWorker.ts` derive that list from prior registry rows where `configured_status='BACKFILL_UNKNOWN'`. This makes the registry self-healing: any sentinel row gets fetched on the next tick.
3. **TikTok worker registry self-healing** (`Task 3`) — when the worker writes (tiktok, X, campaign_id), DELETE any (tiktok, Y, campaign_id) registry rows where Y != X. Mirrors the existing `persistCampaignsLive` DELETE-then-UPSERT pattern that already cleans `campaigns_daily` but does not extend to the registry.

**Tech Stack:** TypeScript (Node 20), Supabase PostgreSQL, Inngest, Vitest, Google Ads JSON API (camelCase response, snake_case GAQL), TikTok Marketing API v1.3.

**Out of scope (defer to Phase E2 ad-level workers):** registry sweep for `adset_registry` / `ad_registry`. Today these tables don't have the BACKFILL_UNKNOWN sentinel for the stuck rows (Phase D migration backfill keyed only the campaign level into the sentinel), so the immediate acceptance gate doesn't need them.

---

### Task 1: One-shot SQL cleanup migration

**Files:**
- Create: `supabase/migrations/20260530290000_phase_d_soak_cleanup_stuck_unknown_rows.sql`

The migration is idempotent: each statement uses `WHERE configured_status = 'BACKFILL_UNKNOWN'` so re-running has no effect after the first apply. It is safe to commit even though the data fix is one-shot.

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/20260530290000_phase_d_soak_cleanup_stuck_unknown_rows.sql` with:

```sql
-- Phase D soak hotfix (2026-05-30) — clear 4 stuck BACKFILL_UNKNOWN
-- registry rows that the workers cannot reach. Context:
--   • 2 TikTok rows are cross-store-attribution duplicates from a
--     transient bad campaigns_daily snapshot at Phase D migration time.
--     The campaigns are mapped to usmile360 per dashboard_state
--     campaign-store-map; the usmile360 registry rows are healthy and
--     updated by the worker. The uzoshop rows are stale leftovers.
--   • 1 Google row is an active campaign that hasn't changed in 24h,
--     so the change_status worker (24h window) never refreshes it.
--     Task 2 of this plan adds a sweep so this can't recur; the
--     migration just heals the existing row.
--   • 1 TikTok row is a week-old DISABLED campaign no longer returned
--     by /campaign/get/ (archived/deleted). Worker correctly skips it;
--     this migration derives configured_status from the historical
--     effective_status snapshot so the row exits BACKFILL_UNKNOWN.
--
-- See .planning/PHASE-D-SOAK-FINDINGS-2026-05-30.md for the full
-- root-cause analysis. Migration is idempotent
-- (WHERE configured_status = 'BACKFILL_UNKNOWN' clause).

BEGIN;

-- 1. DELETE 2 stale TikTok uzoshop rows (cross-attribution duplicates).
--    Bounded by a 4-tuple match so this migration cannot affect any
--    other row even if the same campaign_id appears under a different
--    store in the future.
DELETE FROM campaign_registry
 WHERE platform = 'tiktok'
   AND store_id = 'uzoshop'
   AND campaign_id IN ('1866440028463153', '1866443196508418')
   AND configured_status = 'BACKFILL_UNKNOWN';

-- 2. UPDATE the 2 worker-unreachable rows: derive configured_status
--    from the effective_status that the Phase D migration backfilled
--    from campaigns_daily. Bounded so it only acts on rows still at
--    the sentinel (idempotent on re-apply).
UPDATE campaign_registry
   SET configured_status = effective_status
 WHERE configured_status = 'BACKFILL_UNKNOWN'
   AND effective_status IS NOT NULL
   AND (
     (platform = 'google' AND store_id = 'uzoshop' AND campaign_id = '22552655236')
     OR
     (platform = 'tiktok' AND store_id = 'uzoshop' AND campaign_id = '1865960813023330')
   );

COMMIT;
```

- [ ] **Step 2: Apply migration to prod**

The repo `.env` uses dotted-key format (e.g. `supabase.url = …`) which the supabase CLI's `dotenv` parser does not accept. Move it aside temporarily:

```bash
cd /Users/dorperetz/script-roas
mv .env .env.bak
supabase db push --yes
mv .env.bak .env
```

Expected output: `Applying migration 20260530290000_phase_d_soak_cleanup_stuck_unknown_rows.sql...` then `Finished supabase db push.`

- [ ] **Step 3: Verify post-state via REST API**

```bash
SUPABASE_URL=$(grep "^supabase.url" /Users/dorperetz/script-roas/.env | sed 's/^[^=]*= *//' | tr -d ' ')
SUPABASE_KEY=$(grep "^supabase.service.role.key" /Users/dorperetz/script-roas/.env | sed 's/^[^=]*= *//' | tr -d ' ')

curl -sS "${SUPABASE_URL}/rest/v1/campaign_registry?select=platform,configured_status" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" \
  | jq -r '
    group_by(.platform) | map({
      platform: .[0].platform,
      total: length,
      still_unknown: (map(select(.configured_status == "BACKFILL_UNKNOWN")) | length)
    }) | (.[] | "  \(.platform): \(.still_unknown)/\(.total) BACKFILL_UNKNOWN (\((.still_unknown * 100 / .total) * 10 | floor / 10)%)")
  '
```

Expected:
```
  google: 0/3 BACKFILL_UNKNOWN (0%)
  meta: 0/67 BACKFILL_UNKNOWN (0%)
  tiktok: 1/10 BACKFILL_UNKNOWN (10%)
```

Note: TikTok denominator drops from 12 → 10 (2 DELETEd dupes), and 1 row stays at `BACKFILL_UNKNOWN` only if the migration's UPDATE didn't match `1865960813023330` — re-check the row's `effective_status` is NOT NULL.

Actually the expected reading is `tiktok: 0/10 (0%)` because the UPDATE clause matches `1865960813023330` and its effective_status (`ADGROUP_STATUS_CAMPAIGN_DISABLE`) IS NOT NULL.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260530290000_phase_d_soak_cleanup_stuck_unknown_rows.sql
git commit -m "$(cat <<'EOF'
feat(phase-d-soak): cleanup 4 stuck BACKFILL_UNKNOWN registry rows

Idempotent migration that resolves the 4 registry rows the Phase D
workers cannot reach:

  • DELETE 2 TikTok uzoshop rows (cross-attribution duplicates;
    same campaign_id has healthy usmile360 rows per current
    campaign-store-map).
  • UPDATE Google uzoshop 22552655236 — derive configured_status from
    effective_status (active campaign outside change_status 24h
    window; Task 2 adds a worker sweep so this can't recur).
  • UPDATE TikTok uzoshop 1865960813023330 — derive configured_status
    from historical effective_status (week-old DISABLE, no longer
    returned by /campaign/get/).

After apply, all 3 platforms drop to 0% BACKFILL_UNKNOWN — Phase D
acceptance gate passes.

See .planning/PHASE-D-SOAK-FINDINGS-2026-05-30.md for the full
root-cause analysis.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Google fetcher BACKFILL_UNKNOWN sweep

**Files:**
- Modify: `dashboard-web/src/lib/fetchers/googleStatus.ts`
- Modify: `dashboard-web/src/inngest/functions/googleWorker.ts`
- Modify: `dashboard-web/src/lib/fetchers/__tests__/googleStatus.test.ts`

The Google fetcher today derives the follow-up SELECT campaign list from `change_status` only. Add an `extraCampaignIds: string[]` input that the worker populates from prior registry rows where `configured_status = 'BACKFILL_UNKNOWN'`. The fetcher merges them into the campaign-IDs set before the follow-up SELECT.

This is a small, surgical change. It does NOT change the adgroup / ad follow-up paths (the stuck rows are all at campaign level; adset/ad sweep can be added later if Phase E2 surfaces a need).

- [ ] **Step 1: Add failing test for `extraCampaignIds` to `googleStatus.test.ts`**

Append to `dashboard-web/src/lib/fetchers/__tests__/googleStatus.test.ts` (before the closing `});` of the top-level `describe`):

```typescript
  it('extraCampaignIds: includes registry sweep campaign ids in the follow-up query even when change_status returns empty', async () => {
    const searchStream = vi.fn();
    // change_status returns no changes in the last 24h
    searchStream.mockResolvedValueOnce([]);
    // follow-up campaign SELECT — should still run for the extra ids
    searchStream.mockResolvedValueOnce([
      { campaign: { id: '22552655236', name: 'Long-Stable Campaign', status: 'ENABLED', servingStatus: 'SERVING' } },
    ]);
    const customer = { searchStream } as unknown as Parameters<typeof fetchGoogleStatusForStore>[0]['customer'];
    const out = await fetchGoogleStatusForStore({
      storeId: 'uzoshop',
      customer,
      extraCampaignIds: ['22552655236'],
    });
    // change_status was called (1st), follow-up campaign SELECT was called (2nd)
    expect(searchStream).toHaveBeenCalledTimes(2);
    const followUpQuery = searchStream.mock.calls[1][0].query as string;
    expect(followUpQuery).toContain("'22552655236'");
    expect(out.campaigns).toHaveLength(1);
    expect(out.campaigns[0]).toMatchObject({
      store_id: 'uzoshop', platform: 'google',
      campaign_id: '22552655236', configured_status: 'ENABLED', effective_status: 'SERVING',
    });
  });

  it('extraCampaignIds: deduplicates ids that already appear in change_status', async () => {
    const searchStream = vi.fn();
    // change_status returns campaign 22542818628
    searchStream.mockResolvedValueOnce([
      {
        changeStatus: {
          resourceType: 'CAMPAIGN',
          campaign: 'customers/123/campaigns/22542818628',
          lastChangeDateTime: '2026-05-30 14:00:00',
        },
      },
    ]);
    // follow-up SELECT — should mention 22542818628 ONCE, not twice
    searchStream.mockResolvedValueOnce([
      { campaign: { id: '22542818628', name: 'X', status: 'ENABLED', servingStatus: 'SERVING' } },
    ]);
    const customer = { searchStream } as unknown as Parameters<typeof fetchGoogleStatusForStore>[0]['customer'];
    await fetchGoogleStatusForStore({
      storeId: 'uzoshop',
      customer,
      extraCampaignIds: ['22542818628'], // overlap with change_status
    });
    const followUpQuery = searchStream.mock.calls[1][0].query as string;
    // The IN (...) clause should have a single quoted id (no duplicates).
    const matches = followUpQuery.match(/'22542818628'/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it('extraCampaignIds: skips follow-up entirely when both change_status and extra ids are empty', async () => {
    const searchStream = vi.fn().mockResolvedValueOnce([]);
    const customer = { searchStream } as unknown as Parameters<typeof fetchGoogleStatusForStore>[0]['customer'];
    const out = await fetchGoogleStatusForStore({
      storeId: 'uzoshop',
      customer,
      extraCampaignIds: [],
    });
    // Only the change_status call — no follow-up since the set is empty.
    expect(searchStream).toHaveBeenCalledTimes(1);
    expect(out.campaigns).toHaveLength(0);
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx vitest run src/lib/fetchers/__tests__/googleStatus.test.ts
```

Expected: 3 NEW tests fail with `extraCampaignIds is not a valid input` or TypeScript compile error.

- [ ] **Step 3: Implement `extraCampaignIds` in `googleStatus.ts`**

Modify `dashboard-web/src/lib/fetchers/googleStatus.ts`:

Change the `GoogleStatusInput` type (around line 35-38):

```typescript
export type GoogleStatusInput = {
  storeId: StoreId;
  customer: Customer;
  /**
   * Phase D soak (2026-05-30) — campaign ids the worker wants the
   * follow-up SELECT to include even if change_status didn't surface
   * them in the last 24h. Used to sweep registry rows that are still
   * at the BACKFILL_UNKNOWN sentinel because the campaign has been
   * stable longer than the change_status window.
   *
   * Without this, a long-stable campaign that was inserted by Phase D
   * migration backfill will stay at BACKFILL_UNKNOWN forever — the
   * worker never re-queries it.
   */
  extraCampaignIds?: string[];
};
```

Change the body of `fetchGoogleStatusForStore` — after the existing change_status parsing loop (after line 120, before the `// 2. Follow up with full entity rows.` comment), add the merge:

```typescript
  // Phase D soak (2026-05-30) — merge in any extra ids the worker
  // wants swept (registry rows still at BACKFILL_UNKNOWN). Set semantics
  // dedupe against change_status hits.
  if (input.extraCampaignIds) {
    for (const id of input.extraCampaignIds) {
      if (id) campaignIds.add(id);
    }
  }
```

The follow-up `if (campaignIds.size > 0)` block (line 124) does not need to change — it iterates `campaignIds` which now includes the extras.

- [ ] **Step 4: Run fetcher tests to verify they pass**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx vitest run src/lib/fetchers/__tests__/googleStatus.test.ts
```

Expected: all tests PASS (3 new + the existing suite).

- [ ] **Step 5: Wire the worker to derive `extraCampaignIds` from prior registry**

Modify `dashboard-web/src/inngest/functions/googleWorker.ts` in `runGoogleStatusBranch` (around line 212-227, between the existing `try {` and the `fetchStatus({...})` call):

Replace:

```typescript
    const customer = await safeCustomer(storeId, getCustomer);
    const status = await fetchStatus({ storeId, customer });

    // 2. Load prior registry rows for the diff (platform='google').
    const prior = await loadPriorRegistry(storeId);
```

with:

```typescript
    const customer = await safeCustomer(storeId, getCustomer);

    // Phase D soak (2026-05-30) — load prior registry BEFORE the fetch so
    // we can pass any BACKFILL_UNKNOWN campaign ids to the fetcher as
    // extraCampaignIds. change_status alone misses long-stable campaigns
    // (e.g. ENABLED for a week without edits), leaving the migration's
    // sentinel in place forever. This sweep is the structural fix.
    const prior = await loadPriorRegistry(storeId);
    const extraCampaignIds: string[] = [];
    for (const row of prior.campaigns.values()) {
      if (row.configured_status === 'BACKFILL_UNKNOWN') {
        extraCampaignIds.push(row.campaign_id);
      }
    }

    const status = await fetchStatus({ storeId, customer, extraCampaignIds });
```

Note: the existing `// 2. Load prior registry rows for the diff (platform='google').` comment block immediately below is now redundant — leave it as a single-line trailing comment or remove it (whichever keeps the existing comment density intact).

- [ ] **Step 6: Update the worker's `fetchStatus` shim type**

The `RunGoogleWorkerJobInput` (around line 84) types `fetchStatus` as `(input: GoogleStatusInput) => Promise<GoogleStatusResult>`. Since `GoogleStatusInput` now has the optional `extraCampaignIds` field, this shim continues to type-check — no change needed. Verify by running:

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx tsc --noEmit
```

Expected: clean (no new errors).

- [ ] **Step 7: Run the full Google worker test suite**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx vitest run src/inngest/functions/__tests__/googleWorker.test.ts src/lib/fetchers/__tests__/googleStatus.test.ts
```

Expected: all pass. If a prior googleWorker test asserted that `fetchStatus` was called with exactly `{ storeId, customer }`, update it to allow the new `extraCampaignIds: []` field.

- [ ] **Step 8: Commit**

```bash
git add dashboard-web/src/lib/fetchers/googleStatus.ts \
        dashboard-web/src/lib/fetchers/__tests__/googleStatus.test.ts \
        dashboard-web/src/inngest/functions/googleWorker.ts
git commit -m "$(cat <<'EOF'
feat(phase-d-soak): sweep BACKFILL_UNKNOWN registry rows in google worker

The change_status API only returns campaigns that changed in the last
24h. A campaign that has been ENABLED for a week without edits is never
re-fetched by the worker, so a registry row with
configured_status='BACKFILL_UNKNOWN' (Phase D migration backfill
sentinel) stays at the sentinel forever.

Fix: have googleWorker derive a list of stale campaign ids from prior
registry rows (configured_status === 'BACKFILL_UNKNOWN') and pass them
as fetchGoogleStatusForStore({ extraCampaignIds }). The fetcher merges
them into the existing change_status follow-up SELECT, so every tick
that has any stale rows performs a one-shot refresh of them.

Tests: 3 new units in googleStatus.test.ts cover the include / dedupe /
empty paths. Full suite green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: TikTok worker stale-attribution registry DELETE

**Files:**
- Modify: `dashboard-web/src/inngest/functions/tiktokWorker.ts`
- Modify: `dashboard-web/src/inngest/functions/__tests__/tiktokWorker.test.ts`

The TikTok worker fetches all campaigns from the shared ad account, applies the per-campaign mapping, and upserts (tiktok, resolved_store_id, campaign_id) registry rows. If a prior registry row exists at (tiktok, other_store_id, campaign_id), it stays — the upsert key includes `store_id`, so no conflict, no overwrite. Mirror the existing `persistCampaignsLive` DELETE-then-UPSERT pattern: after the registry upsert, DELETE any (platform='tiktok', campaign_id IN fresh_set, store_id NOT IN fresh_target_set) rows.

This is at the registry level only — `persistCampaignsLive` already handles `campaigns_daily`. Out of scope: adset/ad-level cleanup (Phase E2 ad-level worker design will revisit).

- [ ] **Step 1: Add failing test in `tiktokWorker.test.ts`**

Locate the existing `describe('runTikTokStatusBranch')` block and append a new test:

```typescript
  it('Phase D soak: after upsert, DELETEs stale-attribution registry rows for the same (platform, campaign_id) under other store_ids', async () => {
    // Fresh fetch resolves campaign X to usmile360 (per map).
    const fetchStatus = vi.fn().mockResolvedValue({
      campaigns: [
        {
          store_id: 'usmile360', platform: 'tiktok', campaign_id: '1866440028463153',
          name: 'X', configured_status: 'ENABLE', effective_status: 'CAMPAIGN_STATUS_ENABLE',
          delivery_status: 'DELIVERING', is_enabled: true, is_serving: true,
          first_seen_at: null, last_seen_at: null,
          platform_updated_at: null, status_changed_at: null,
          last_metrics_success_at: null, last_status_success_at: null,
          raw_status_payload: {}, missed_seen_count: 0, is_removed: false,
        },
      ],
      adsets: [],
      ads: [],
    });
    // Prior registry has a stale (tiktok, uzoshop, X) row from a previous
    // mapping — the worker MUST delete it.
    const loadPriorRegistry = vi.fn().mockResolvedValue({
      campaigns: new Map([
        ['1866440028463153', {
          store_id: 'uzoshop', platform: 'tiktok', campaign_id: '1866440028463153',
          configured_status: 'BACKFILL_UNKNOWN', effective_status: 'ADGROUP_STATUS_DELIVERY_OK',
        }],
      ]),
      adsets: new Map(),
      ads: new Map(),
    });
    const upsertRegistry = vi.fn().mockResolvedValue(undefined);
    const insertStatusEvents = vi.fn().mockResolvedValue(undefined);
    const deleteStaleAttributionRows = vi.fn().mockResolvedValue(undefined);
    const recordFreshness = vi.fn().mockResolvedValue(undefined);

    await runTikTokWorkerJob({
      jobData: { store_id: 'usmile360', platform: 'tiktok', scope: 'status' } as any,
      loadStoreMap: async () => ({}),
      fetchStatus,
      fetchHotMetrics: vi.fn(),
      getHotCampaignIds: vi.fn().mockResolvedValue([]),
      getHotAdgroupIds: vi.fn().mockResolvedValue([]),
      getHotAdIds: vi.fn().mockResolvedValue([]),
      loadPriorRegistry,
      upsertRegistry,
      insertStatusEvents,
      deleteStaleAttributionRows,
      upsertCampaignsDaily: vi.fn(),
      upsertAdsDaily: vi.fn(),
      getAccount: async () => ({ advertiserId: 'adv1', accessToken: 'tok', accountCurrency: 'USD' } as any),
      getFxCadFor: async () => async () => 1,
      recordFreshness,
      nowIso: '2026-05-30T16:00:00.000Z',
      isTikTokConfigured: () => true,
    });

    // The worker must invoke deleteStaleAttributionRows with the freshly-
    // written ids + target stores so the DELETE clears (tiktok, uzoshop, X).
    expect(deleteStaleAttributionRows).toHaveBeenCalledOnce();
    const call = deleteStaleAttributionRows.mock.calls[0][0];
    expect(call.platform).toBe('tiktok');
    expect(call.entityType).toBe('campaign');
    expect(call.freshCampaignIds).toEqual(['1866440028463153']);
    expect(call.freshTargetStoreIds.sort()).toEqual(['usmile360']);
  });
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx vitest run src/inngest/functions/__tests__/tiktokWorker.test.ts -t "DELETEs stale-attribution"
```

Expected: FAIL with `deleteStaleAttributionRows is not a valid input` or similar.

- [ ] **Step 3: Add `deleteStaleAttributionRows` to the worker's input type**

In `dashboard-web/src/inngest/functions/tiktokWorker.ts`, in the `RunTikTokWorkerJobInput` type (search for `loadPriorRegistry` to find the surrounding block), add a new required field after `insertStatusEvents`:

```typescript
  /**
   * Phase D soak (2026-05-30) — DELETE registry rows that share
   * (platform, campaign_id) with a freshly-written row but live under
   * a different store_id (stale cross-attribution leftovers). Mirrors
   * the DELETE-then-UPSERT pattern already used by persistCampaignsLive
   * for campaigns_daily.
   */
  deleteStaleAttributionRows: (input: {
    platform: 'tiktok';
    entityType: 'campaign' | 'adset' | 'ad';
    freshCampaignIds: string[];
    freshTargetStoreIds: string[];
  }) => Promise<void>;
```

- [ ] **Step 4: Wire the worker to call it after the campaign_registry upsert**

In `runTikTokStatusBranch` (around line 312-315), after the `await upsertRegistry({ table: 'campaign_registry', rows: campRows });` line, add:

```typescript
    // Phase D soak (2026-05-30) — after writing the fresh campaign rows,
    // DELETE any stale cross-store rows for the same campaign_ids. The
    // upsert key includes store_id, so a (tiktok, uzoshop, X) row left
    // over from a previous mapping does NOT conflict with the new
    // (tiktok, usmile360, X) row — without this DELETE both linger,
    // and the uzoshop one stays at BACKFILL_UNKNOWN forever because the
    // worker never resolves X to uzoshop again.
    if (status.campaigns.length > 0) {
      const freshCampaignIds = [...new Set(status.campaigns.map((c) => c.campaign_id))];
      const freshTargetStoreIds = [...new Set(status.campaigns.map((c) => c.store_id))];
      await input.deleteStaleAttributionRows({
        platform: 'tiktok',
        entityType: 'campaign',
        freshCampaignIds,
        freshTargetStoreIds,
      });
    }
```

- [ ] **Step 5: Implement the production adapter in the Inngest binding**

Locate the `inngest.createFunction` block at the bottom of `tiktokWorker.ts` (look for `id: 'tiktok-worker'`). In the dependency wiring (the object passed to `runTikTokWorkerJob`), add the `deleteStaleAttributionRows` adapter:

```typescript
        deleteStaleAttributionRows: async (inp) => {
          const tableName =
            inp.entityType === 'campaign' ? 'campaign_registry'
            : inp.entityType === 'adset' ? 'adset_registry'
            : 'ad_registry';
          if (inp.freshCampaignIds.length === 0) return;
          const { error } = await sb
            .from(tableName)
            .delete()
            .eq('platform', inp.platform)
            .in('campaign_id', inp.freshCampaignIds)
            .not(
              'store_id',
              'in',
              `(${inp.freshTargetStoreIds.map((s) => `"${s}"`).join(',')})`,
            );
          if (error) {
            // Soft-fail: registry stays as-is, next tick retries. Don't
            // throw because the upsert already succeeded; throwing would
            // mark the whole status branch as failed and obscure the
            // operator panel.
            console.warn(
              `tiktokWorker deleteStaleAttributionRows ${tableName}: ${error.message}`,
            );
          }
        },
```

Place it next to `insertStatusEvents` in the same dependency-injection block.

- [ ] **Step 6: Run tiktokWorker tests**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx vitest run src/inngest/functions/__tests__/tiktokWorker.test.ts
```

Expected: all pass (new test + the existing suite, all green).

- [ ] **Step 7: Run typecheck**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add dashboard-web/src/inngest/functions/tiktokWorker.ts \
        dashboard-web/src/inngest/functions/__tests__/tiktokWorker.test.ts
git commit -m "$(cat <<'EOF'
feat(phase-d-soak): tiktokWorker DELETEs stale-attribution registry rows

The TikTok ad account belongs to uzoshop, but individual campaigns can
be mapped to other stores via campaign-store-map. When the worker
resolves campaign X to usmile360 and upserts (tiktok, usmile360, X), a
prior (tiktok, uzoshop, X) registry row from before the remapping
stays put — the upsert PK includes store_id so no conflict, no
overwrite, and the uzoshop row sits at BACKFILL_UNKNOWN forever
because the worker never resolves X to uzoshop again.

Fix: after the campaign_registry upsert, DELETE any (platform='tiktok',
campaign_id IN fresh_set, store_id NOT IN fresh_target_set) rows.
Mirrors the same DELETE-then-UPSERT pattern persistCampaignsLive
already uses for campaigns_daily (Phase A.5 v2).

Soft-fail on DELETE error so a transient Supabase blip doesn't take
down the whole status branch — the upsert already succeeded and the
next tick retries.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Push, deploy, and re-verify against prod

**Files:** (none — verification only)

The 3 prior commits constitute the full fix. Push to origin/main to trigger the Vercel auto-deploy. Re-run the BACKFILL_UNKNOWN snapshot AND the live coverage parity harness to prove Phase D acceptance.

- [ ] **Step 1: Run the full pre-push gate**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx tsc --noEmit && npx vitest run
```

Expected: tsc clean + all vitest tests pass.

- [ ] **Step 2: Push to origin/main**

```bash
cd /Users/dorperetz/script-roas
git push origin main
```

Expected: push succeeds; Vercel detects changes in `dashboard-web/` + `supabase/migrations/` and starts a build (the `ignoreCommand` block in `vercel.json` covers this).

- [ ] **Step 3: Wait for Vercel build to finish**

Use `gh run list -L 3` or check the Vercel dashboard. Typical build time: 3-5 min. The migration is already applied to prod (Task 1 Step 2), so the Vercel deploy is the *code* deploy only.

- [ ] **Step 4: Re-run BACKFILL_UNKNOWN snapshot post-deploy**

Use the same SQL from Task 1 Step 3. Expected after deploy:

```
  google: 0/3 BACKFILL_UNKNOWN (0%)
  meta: 0/67 BACKFILL_UNKNOWN (0%)
  tiktok: 0/10 BACKFILL_UNKNOWN (0%)
```

Note: TikTok denominator stays at 10 (Task 1 DELETEd 2 dupes; no new sweep events on TikTok side because Task 3 is defensive, not corrective).

- [ ] **Step 5: Re-run the live coverage parity harness**

```bash
cd /Users/dorperetz/script-roas/dashboard-web && \
  SUPABASE_URL=$(grep "^supabase.url" ../.env | sed 's/^[^=]*= *//' | tr -d ' ') \
  SUPABASE_SERVICE_ROLE_KEY=$(grep "^supabase.service.role.key" ../.env | sed 's/^[^=]*= *//' | tr -d ' ') \
  AUDIT_LIVE=1 npx vitest run src/lib/audit/__tests__/registryCoverageParity.live.test.ts
```

Expected: 4/4 PASS (unchanged from baseline; no regression from the cleanup).

- [ ] **Step 6: Update memory**

Update the handoff memory `~/.claude/projects/-Users-dorperetz-script-roas/memory/reference_handoff_phase_d_15_of_16_done.md` to mark soak as CLOSED.

Update `~/.claude/projects/-Users-dorperetz-script-roas/memory/project_phase_d_soak_stuck_rows_2026_05_30.md` to record the resolution (which option was chosen and the deploy HEAD).

Update `MEMORY.md` to add a `Phase D soak CLOSED 2026-05-30` line.

- [ ] **Step 7: Hand off to Phase E**

The user's gate condition is now met. Per [[phase-e-scope-decision]], the next session can open the Phase E brainstorm scoped to E1+E2+E3+E4. The Task 3 work in this plan partially overlaps with E2 (ad-level workers) — Phase E2 still needs to add the equivalent `deleteStaleAttributionRows` call for the adset and ad branches; the campaign branch is already covered here.

---

## Self-review

**Spec coverage check:**
- ✅ 4 stuck rows cleared by Task 1
- ✅ Google never-touch root cause structurally fixed by Task 2 (worker sweep)
- ✅ TikTok cross-attribution root cause structurally fixed by Task 3 (worker DELETE)
- ✅ TikTok week-old DISABLED row handled by Task 1's UPDATE-from-effective_status (the worker truly can't reach it; Task 3 helps the cross-attribution case, not the API-absent case)

**Placeholder scan:** none — every code block is concrete. SQL migration file content is verbatim. Test bodies are full. Commit messages are full HEREDOCs.

**Type consistency:** `extraCampaignIds: string[]` matches between `GoogleStatusInput` (Task 2 Step 3) and worker call site (Step 5). `deleteStaleAttributionRows` signature in `RunTikTokWorkerJobInput` (Task 3 Step 3) matches the worker call site (Step 4) and the production adapter (Step 5).
