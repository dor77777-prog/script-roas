# Phase A.5 v2 — TikTok Campaign↔Store Mapping (Re-attribution-safe) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-ship Phase A.5 (operator tags TikTok campaigns to stores via `CampaignDrawer`) WITHOUT the duplicate-row data corruption bug that forced v1 to be rolled back on 2026-05-29.

**Architecture:** The campaigns_daily PK is `(date, store_id, platform, campaign_id, ad_set_id)`. v1 tried to write TikTok rows under the operator-chosen store_id; the legacy uzoshop row stayed because the PK didn't conflict → duplicate rows → doubled spend in data_daily after the agg function. v2 fixes this with **batch DELETE-then-UPSERT** at the persist layer: before any UPSERT, DELETE all rows for the same `(date, platform, campaign_id)` set whose `store_id` is NOT in the target store_ids of this batch. This guarantees campaigns_daily has at most ONE row per `(date, platform, campaign_id, ad_set_id)` regardless of how many times the operator re-tags. The drawer-based UI is restored with `effectiveStoreId` + `effectiveStoreName` + product-map migration on store change to fix the v1 UX bugs (disabled dropdown, stale picker products, stale picker label, orphaned product mappings).

**Tech Stack:** Next.js 15 + React 19, Inngest, Supabase Postgres + RPC functions, Vitest, OKLCH design tokens.

**Reference spec:** [docs/superpowers/specs/2026-05-29-phase-a5-campaign-store-mapping-design.md](../specs/2026-05-29-phase-a5-campaign-store-mapping-design.md)

**Rollback memory:** [project_phase_a5_rolled_back.md](../../../.. /.claude/projects/-Users-dorperetz-script-roas/memory/project_phase_a5_rolled_back.md) — lists all v1 commits + the DB state before/after the rollback.

---

## Bugs from v1 that v2 MUST prevent (verification checklist)

The implementer MUST verify each of these is prevented (test or manual). Use this list as the acceptance gate for the v2 push.

| # | Bug | v1 cause | v2 prevention |
|---|---|---|---|
| 1 | **Duplicate campaigns_daily rows** | UPSERT with new store_id never conflicted with legacy uzoshop row | Batch DELETE-then-UPSERT in `persistCampaignsLive` + `cronDaily` |
| 2 | **Duplicate ads_daily rows** | Same root cause (PK includes store_id) | Same DELETE-then-UPSERT pattern on ads_daily |
| 3 | **Doubled data_daily.tt_spend_cad** | RPC summed both duplicate rows | Naturally fixed by #1 — RPC reads correct campaigns_daily |
| 4 | **Drawer dropdown disabled** | `AdAccountMap.tiktokAdvertiserId` never populated | Restore the `/api/store-meta` env enrichment (already in code, just verify) |
| 5 | **Product picker showed old store's products** | `storeId` prop = data-side store (unmigrated) | `effectiveStoreId` resolves the operator's pending re-tag |
| 6 | **Product picker label showed old store's name** | `storeName` prop = data-side name | `effectiveStoreName` derived from `effectiveStoreId` via STORE_DISPLAY_NAMES |
| 7 | **Cloud-sync re-resurrection of deleted entries** | localStorage → pushCloudKey kept re-pushing after manual DELETE | The v2 deploy ships with `campaign-store-map` BACK on STATE_KEYS — but it's intentional and clean (no stale data exists post-v1 rollback) |
| 8 | **Product map orphans on store change** | productMap keyed by storeId, never migrated when store mapping changed | On dropdown change, COPY productMap entry from old key to new key |
| 9 | **Column-in-table UX (deprecated v1.1)** | First v1 attempt added column to CampaignsTable | NEVER add to the table; UI lives in CampaignDrawer only |

---

## File Structure

**Modified (existing files — re-add v1 logic + harden):**
- `dashboard-web/src/lib/cloudSync.ts` — re-add `'roas-dashboard:campaign-store-map'` to `STATE_KEYS` + `CHANGE_EVENTS`
- `dashboard-web/src/lib/campaignStoreMap.ts` — re-add `pushCloudKey` call in `writeCampaignStoreMap` + restore the import
- `dashboard-web/src/lib/inngest/persistCampaignsLive.ts` — batch DELETE-then-UPSERT for TikTok rows + re-add `r.storeId ?? storeId` + re-add RPC call
- `dashboard-web/src/inngest/functions/cronDaily.ts` — batch DELETE-then-UPSERT for TikTok rows + re-add RPC call
- `dashboard-web/src/components/CampaignDrawer.tsx` — re-add Store dropdown section + `effectiveStoreId` + `effectiveStoreName` + product-map migration on change
- `docs/ROAS-Dashboard-User-Manual.md` — bump 2.1.17 → 2.1.18 with v2 changelog
- `docs/ARCHITECTURE.md` — extend §25.11 with v2 design

**New (4 test files):**
- `dashboard-web/src/lib/inngest/__tests__/persistCampaignsLiveDeleteOldStoreRowV2.test.ts` — ~5 tests for the DELETE-then-UPSERT in persistCampaignsLive
- `dashboard-web/src/inngest/functions/__tests__/cronDailyDeleteOldStoreRowV2.test.ts` — ~3 tests for the DELETE-then-UPSERT in cronDaily
- `dashboard-web/src/components/__tests__/campaignDrawerStoreMapV2.dom.test.tsx` — ~4 tests for the drawer Store section + product-map migration
- `dashboard-web/src/lib/__tests__/campaignStoreMapV2.dom.test.ts` — verify the cloud-sync push round-trip

**Unchanged (already in codebase from v1, kept dormant; v2 re-uses):**
- `dashboard-web/src/lib/inngest/campaignStoreMap.ts` (server-side reader, no change)
- `dashboard-web/src/lib/fetchers/tiktok.ts` (attaches `storeId` per row, no change)
- `dashboard-web/src/app/api/store-meta/route.ts` (enriches `tiktokAdvertiserId` from env, no change)
- `supabase/migrations/20260530120000_add_tt_spend_agg_function.sql` (SQL function `agg_tiktok_spend_per_store_for_date`, no change)
- `dashboard-web/src/lib/dashboardStateKeys.ts` (allowlist entry, no change)
- `dashboard-web/src/app/operator/page.tsx` (historical disclaimer chip, no change)

---

## Task 1: Re-enable cloud-sync for campaign-store-map

**Why this task is first:** all other tasks depend on `writeCampaignStoreMap` actually persisting to Supabase, which requires the cloud-sync pipeline. Without it, the operator's tags only live in localStorage and don't survive cross-device.

**Files:**
- Modify: `dashboard-web/src/lib/cloudSync.ts` (re-add 2 entries: STATE_KEYS + CHANGE_EVENTS)
- Modify: `dashboard-web/src/lib/campaignStoreMap.ts` (re-add pushCloudKey call + import)

- [ ] **Step 1: Re-add `campaign-store-map` to STATE_KEYS in cloudSync.ts**

Open `dashboard-web/src/lib/cloudSync.ts`. Find the `STATE_KEYS` array around line 47. The current state (post-rollback) is:

```typescript
const STATE_KEYS = [
  'roas-dashboard:billing-recurring',
  'roas-dashboard:billing-onetime',
  'roas-dashboard:annotations',
  'roas-dashboard:monthly-revenue-goal',
  'roas-dashboard:insight-states',
  'roas-dashboard:campaign-optimized',
  'roas-dashboard:campaign-product-map',
  // Phase 05.7.9d — per-table column visibility preferences (hide/show).
  'roas-dashboard:campaigns-column-visibility',
  // Phase A.5 ROLLED BACK 2026-05-29 — 'roas-dashboard:campaign-store-map'
  // was here. Removed from auto-sync...
] as const;
```

Replace the rollback comment block with the re-added entry:

```typescript
const STATE_KEYS = [
  'roas-dashboard:billing-recurring',
  'roas-dashboard:billing-onetime',
  'roas-dashboard:annotations',
  'roas-dashboard:monthly-revenue-goal',
  'roas-dashboard:insight-states',
  'roas-dashboard:campaign-optimized',
  'roas-dashboard:campaign-product-map',
  // Phase 05.7.9d — per-table column visibility preferences (hide/show).
  'roas-dashboard:campaigns-column-visibility',
  // Phase A.5 v2 (2026-05-29) — TikTok campaign↔store mapping. v1 was rolled
  // back due to a campaigns_daily PK duplication bug; v2 fixes that via
  // batch DELETE-then-UPSERT in persistCampaignsLive + cronDaily.
  'roas-dashboard:campaign-store-map',
] as const;
```

- [ ] **Step 2: Re-add `campaign-store-map` entry to CHANGE_EVENTS in cloudSync.ts**

In the same file, find the `CHANGE_EVENTS` object around line 64. Append after `campaigns-column-visibility`:

```typescript
const CHANGE_EVENTS: Record<StateKey, string> = {
  'roas-dashboard:billing-recurring': 'roas-billing-changed',
  'roas-dashboard:billing-onetime': 'roas-billing-changed',
  'roas-dashboard:annotations': 'roas-annotations-changed',
  'roas-dashboard:monthly-revenue-goal': 'roas-goal-changed',
  'roas-dashboard:insight-states': 'roas-insight-states-changed',
  'roas-dashboard:campaign-optimized': 'roas-campaign-optimized-changed',
  'roas-dashboard:campaign-product-map': 'roas-campaign-product-map-changed',
  'roas-dashboard:campaigns-column-visibility': 'roas-campaigns-column-visibility-changed',
  'roas-dashboard:campaign-store-map': 'roas-campaign-store-map-changed',
};
```

(The `Record<StateKey, string>` type forces this — tsc will error if you forget.)

- [ ] **Step 3: Re-add the pushCloudKey call + import in `campaignStoreMap.ts`**

Open `dashboard-web/src/lib/campaignStoreMap.ts`. The current state (post-rollback) at the top:

```typescript
// dashboard-web/src/lib/campaignStoreMap.ts
//
// Phase A.5 ROLLED BACK 2026-05-29 — TikTok campaign↔store mapping helpers
// (dormant). Originally mirrored campaignProductMap.ts. After rollback the
// cloud-sync push was removed (the key is off the STATE_KEYS allowlist) so
// only localStorage writes remain. Kept in the codebase for Phase A.5 v2.

const STORAGE_KEY = 'roas-dashboard:campaign-store-map' as const;
```

Replace with:

```typescript
// dashboard-web/src/lib/campaignStoreMap.ts
//
// Phase A.5 v2 (2026-05-29) — TikTok campaign↔store mapping helpers.
// Mirrors campaignProductMap.ts: localStorage + pushCloudKey + window event.

import { pushCloudKey } from './cloudSync';

const STORAGE_KEY = 'roas-dashboard:campaign-store-map' as const;
```

Then find `writeCampaignStoreMap` (around line 38). Current:

```typescript
// Phase A.5 ROLLED BACK 2026-05-29 — pushCloudKey call removed...
export function writeCampaignStoreMap(map: CampaignStoreMap): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  } catch {
    // quota / private mode — ignore
  }
}
```

Replace with:

```typescript
export function writeCampaignStoreMap(map: CampaignStoreMap): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
    pushCloudKey(STORAGE_KEY, map, { immediate: true });
  } catch {
    // quota / private mode — ignore
  }
}
```

- [ ] **Step 4: Verify tsc + baseline tests pass**

Run from `dashboard-web/`:

```bash
npx tsc --noEmit
```

Expected: no output (clean).

```bash
npm test
```

Expected: 1383 passed / 1 skipped (1384) — same as baseline (no new tests yet).

- [ ] **Step 5: Commit**

```bash
git add dashboard-web/src/lib/cloudSync.ts dashboard-web/src/lib/campaignStoreMap.ts
git commit -m "feat(phase-a5-v2): re-enable cloud-sync for campaign-store-map

Restored 'roas-dashboard:campaign-store-map' to cloudSync.STATE_KEYS +
CHANGE_EVENTS, and re-added pushCloudKey call in writeCampaignStoreMap.

This is Phase A.5 v2 Task 1 of 9. The rollback (35aaf63) disabled the
cloud-sync to stop operator browsers from re-pushing orphaned entries
after manual DELETE. v2 ships a clean cloud-sync round-trip with the
duplicate-row fix in Tasks 3-4 (DELETE-then-UPSERT in the persist layer).

Spec: docs/superpowers/specs/2026-05-29-phase-a5-campaign-store-mapping-design.md
Plan: docs/superpowers/plans/2026-05-29-phase-a5-v2-campaign-store-mapping.md (Task 1)"
```

---

## Task 2: Cloud-sync round-trip test (TDD harness)

**Why:** Before adding tests that depend on the cloud-sync writing to Supabase, verify the round-trip works in the test environment. This locks the wire-up in place.

**Files:**
- Create: `dashboard-web/src/lib/__tests__/campaignStoreMapV2.dom.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// dashboard-web/src/lib/__tests__/campaignStoreMapV2.dom.test.ts
//
// Phase A.5 v2 — verifies writeCampaignStoreMap fires pushCloudKey (cloud-sync)
// in addition to writing localStorage + dispatching the window event. This
// guards against another rollback-style regression where the cloud-sync was
// silently disabled.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const pushCloudKeyMock = vi.fn();
vi.mock('../cloudSync', () => ({ pushCloudKey: pushCloudKeyMock }));

import {
  campaignStoreKey,
  readCampaignStoreMap,
  writeCampaignStoreMap,
  resolveStoreForCampaign,
} from '../campaignStoreMap';

beforeEach(() => {
  window.localStorage.clear();
  pushCloudKeyMock.mockReset();
});

describe('Phase A.5 v2 — cloud-sync round-trip', () => {
  it('writeCampaignStoreMap calls pushCloudKey with the storage key and the map', () => {
    writeCampaignStoreMap({ 'tiktok::adv1::C1': 'usmile360' });
    expect(pushCloudKeyMock).toHaveBeenCalledTimes(1);
    expect(pushCloudKeyMock).toHaveBeenCalledWith(
      'roas-dashboard:campaign-store-map',
      { 'tiktok::adv1::C1': 'usmile360' },
      { immediate: true },
    );
  });

  it('writeCampaignStoreMap also writes localStorage + dispatches change event', () => {
    const eventSpy = vi.fn();
    window.addEventListener('roas-campaign-store-map-changed', eventSpy);
    writeCampaignStoreMap({ 'tiktok::adv1::C1': 'uzoshop' });
    expect(window.localStorage.getItem('roas-dashboard:campaign-store-map')).toBe(
      JSON.stringify({ 'tiktok::adv1::C1': 'uzoshop' }),
    );
    expect(eventSpy).toHaveBeenCalledTimes(1);
    window.removeEventListener('roas-campaign-store-map-changed', eventSpy);
  });

  it('readCampaignStoreMap parses what writeCampaignStoreMap wrote', () => {
    writeCampaignStoreMap({ 'tiktok::adv1::C1': 'zolplus' });
    expect(readCampaignStoreMap()).toEqual({ 'tiktok::adv1::C1': 'zolplus' });
  });

  it('campaignStoreKey + resolveStoreForCampaign behave as in v1 (regression guard)', () => {
    const key = campaignStoreKey('tiktok', 'adv1', 'C1');
    expect(key).toBe('tiktok::adv1::C1');
    expect(resolveStoreForCampaign({ [key]: 'usmile360' }, 'tiktok', 'adv1', 'C1', 'uzoshop')).toBe('usmile360');
    expect(resolveStoreForCampaign({}, 'tiktok', 'adv1', 'C1', 'uzoshop')).toBe('uzoshop');
  });
});
```

- [ ] **Step 2: Run test (should pass — Task 1 already wired the code)**

```bash
cd dashboard-web && npm run test:components -- src/lib/__tests__/campaignStoreMapV2.dom.test.ts
```

Expected: 4 passed.

- [ ] **Step 3: Commit**

```bash
git add dashboard-web/src/lib/__tests__/campaignStoreMapV2.dom.test.ts
git commit -m "test(phase-a5-v2): cloud-sync round-trip test for campaign-store-map

Locks the Task 1 wire-up in place. If someone disables cloud-sync again
(e.g. another rollback), this test catches it before the deploy.

Plan: docs/superpowers/plans/2026-05-29-phase-a5-v2-campaign-store-mapping.md (Task 2)"
```

---

## Task 3: persistCampaignsLive — DELETE-then-UPSERT for TikTok rows

**The core fix.** Before any UPSERT batch for TikTok rows, DELETE all rows for the same `(date, platform, campaign_id)` set whose `store_id` is NOT among the target store_ids of this batch. This guarantees the legacy uzoshop row is removed before the new mapped-store row is inserted.

Same for `ads_daily` (PK is `date, store_id, ad_id`).

**Files:**
- Modify: `dashboard-web/src/lib/inngest/persistCampaignsLive.ts`
- Create: `dashboard-web/src/lib/inngest/__tests__/persistCampaignsLiveDeleteOldStoreRowV2.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// dashboard-web/src/lib/inngest/__tests__/persistCampaignsLiveDeleteOldStoreRowV2.test.ts
//
// Phase A.5 v2 — verifies persistCampaignsLive does DELETE-then-UPSERT for
// TikTok rows. This is the load-bearing test that prevents the v1 rollback
// bug (campaigns_daily duplicate rows when a campaign moves between stores).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { persistCampaignsLive, type TikTokAdLiveRow } from '../persistCampaignsLive';

type SqlCall = { op: 'delete' | 'upsert'; table: string; payload: unknown };
const sqlCalls: SqlCall[] = [];

function makeAdminMock() {
  return {
    from: (table: string) => ({
      delete: () => ({
        eq: (col1: string, v1: unknown) => ({
          eq: (col2: string, v2: unknown) => ({
            in: (col3: string, v3: unknown[]) => ({
              in: (col4: string, v4: unknown[]) => {
                sqlCalls.push({
                  op: 'delete',
                  table,
                  payload: { [col1]: v1, [col2]: v2, [col3]: v3, [col4]: v4 },
                });
                return Promise.resolve({ error: null });
              },
            }),
          }),
        }),
      }),
      upsert: async (rows: Array<Record<string, unknown>>) => {
        sqlCalls.push({ op: 'upsert', table, payload: rows });
        return { error: null };
      },
    }),
    rpc: vi.fn().mockResolvedValue({ error: null }),
  };
}

beforeEach(() => {
  sqlCalls.length = 0;
});

describe('Phase A.5 v2 — persistCampaignsLive DELETE-then-UPSERT', () => {
  it('1. Before TikTok campaigns_daily UPSERT, DELETEs other-store rows for these campaign_ids', async () => {
    const ttRow: TikTokAdLiveRow = {
      storeId: 'usmile360', campaignId: 'C1', campaignName: 'X',
      adGroupId: 'AG1', adId: 'A1',
      spend: 10, impressions: 100, clicks: 5, conversions: 1, conversionValue: 50,
      complete_payment_roas: 5, last_status_check: '2026-05-29',
    } as TikTokAdLiveRow;

    await persistCampaignsLive({
      storeId: 'uzoshop',
      dateStr: '2026-05-29',
      admin: makeAdminMock() as unknown as ReturnType<typeof import('@supabase/supabase-js').createClient>,
      getFx: async () => 1,
      meta: { adsetRows: [], adRows: [], budgets: { currency: 'USD', campaigns: {}, adSets: {} } },
      google: { adGroupRows: [], adRows: [] },
      tiktok: { adRows: [ttRow] },
    });

    // Find the campaigns_daily DELETE and verify it removes non-usmile360 rows for C1
    const cdDel = sqlCalls.find(c => c.op === 'delete' && c.table === 'campaigns_daily');
    expect(cdDel).toBeDefined();
    expect((cdDel!.payload as Record<string, unknown>).date).toBe('2026-05-29');
    expect((cdDel!.payload as Record<string, unknown>).platform).toBe('tiktok');
    expect((cdDel!.payload as Record<string, unknown>).campaign_id).toEqual(['C1']);
    // store_id is in the list of stores to KEEP (the new target) — DELETE removes those NOT in this list
    expect((cdDel!.payload as Record<string, unknown>).store_id).toEqual(['usmile360']);
  });

  it('2. DELETE fires BEFORE the corresponding UPSERT (order matters)', async () => {
    const ttRow: TikTokAdLiveRow = {
      storeId: 'usmile360', campaignId: 'C1', campaignName: 'X',
      adGroupId: 'AG1', adId: 'A1',
      spend: 10, impressions: 100, clicks: 5, conversions: 1, conversionValue: 50,
      complete_payment_roas: 5, last_status_check: '2026-05-29',
    } as TikTokAdLiveRow;

    await persistCampaignsLive({
      storeId: 'uzoshop',
      dateStr: '2026-05-29',
      admin: makeAdminMock() as unknown as ReturnType<typeof import('@supabase/supabase-js').createClient>,
      getFx: async () => 1,
      meta: { adsetRows: [], adRows: [], budgets: { currency: 'USD', campaigns: {}, adSets: {} } },
      google: { adGroupRows: [], adRows: [] },
      tiktok: { adRows: [ttRow] },
    });

    const cdDelIdx = sqlCalls.findIndex(c => c.op === 'delete' && c.table === 'campaigns_daily');
    const cdUpsertIdx = sqlCalls.findIndex(c => c.op === 'upsert' && c.table === 'campaigns_daily');
    expect(cdDelIdx).toBeGreaterThanOrEqual(0);
    expect(cdUpsertIdx).toBeGreaterThanOrEqual(0);
    expect(cdDelIdx).toBeLessThan(cdUpsertIdx);
  });

  it('3. ads_daily also gets DELETE-then-UPSERT for TikTok rows', async () => {
    const ttRow: TikTokAdLiveRow = {
      storeId: 'usmile360', campaignId: 'C1', campaignName: 'X',
      adGroupId: 'AG1', adId: 'A1',
      spend: 10, impressions: 100, clicks: 5, conversions: 1, conversionValue: 50,
      complete_payment_roas: 5, last_status_check: '2026-05-29',
    } as TikTokAdLiveRow;

    await persistCampaignsLive({
      storeId: 'uzoshop',
      dateStr: '2026-05-29',
      admin: makeAdminMock() as unknown as ReturnType<typeof import('@supabase/supabase-js').createClient>,
      getFx: async () => 1,
      meta: { adsetRows: [], adRows: [], budgets: { currency: 'USD', campaigns: {}, adSets: {} } },
      google: { adGroupRows: [], adRows: [] },
      tiktok: { adRows: [ttRow] },
    });

    const adDel = sqlCalls.find(c => c.op === 'delete' && c.table === 'ads_daily');
    expect(adDel).toBeDefined();
    expect((adDel!.payload as Record<string, unknown>).ad_id).toEqual(['A1']);
    expect((adDel!.payload as Record<string, unknown>).store_id).toEqual(['usmile360']);
  });

  it('4. No DELETE fires when there are zero TikTok rows', async () => {
    await persistCampaignsLive({
      storeId: 'uzoshop',
      dateStr: '2026-05-29',
      admin: makeAdminMock() as unknown as ReturnType<typeof import('@supabase/supabase-js').createClient>,
      getFx: async () => 1,
      meta: { adsetRows: [], adRows: [], budgets: { currency: 'USD', campaigns: {}, adSets: {} } },
      google: { adGroupRows: [], adRows: [] },
      tiktok: { adRows: [] },
    });

    const cdDel = sqlCalls.find(c => c.op === 'delete' && c.table === 'campaigns_daily');
    const adDel = sqlCalls.find(c => c.op === 'delete' && c.table === 'ads_daily');
    expect(cdDel).toBeUndefined();
    expect(adDel).toBeUndefined();
  });

  it('5. TikTok rows write under row.storeId (not function-arg storeId)', async () => {
    const ttRow: TikTokAdLiveRow = {
      storeId: 'usmile360', campaignId: 'C1', campaignName: 'X',
      adGroupId: 'AG1', adId: 'A1',
      spend: 10, impressions: 100, clicks: 5, conversions: 1, conversionValue: 50,
      complete_payment_roas: 5, last_status_check: '2026-05-29',
    } as TikTokAdLiveRow;

    await persistCampaignsLive({
      storeId: 'uzoshop',
      dateStr: '2026-05-29',
      admin: makeAdminMock() as unknown as ReturnType<typeof import('@supabase/supabase-js').createClient>,
      getFx: async () => 1,
      meta: { adsetRows: [], adRows: [], budgets: { currency: 'USD', campaigns: {}, adSets: {} } },
      google: { adGroupRows: [], adRows: [] },
      tiktok: { adRows: [ttRow] },
    });

    const cdUpsert = sqlCalls.find(c => c.op === 'upsert' && c.table === 'campaigns_daily');
    expect(cdUpsert).toBeDefined();
    const rows = cdUpsert!.payload as Array<Record<string, unknown>>;
    const ttRowOut = rows.find(r => r.platform === 'tiktok' && r.campaign_id === 'C1');
    expect(ttRowOut?.store_id).toBe('usmile360');
  });
});
```

- [ ] **Step 2: Run targeted tests — confirm RED**

```bash
cd dashboard-web && npm test -- src/lib/inngest/__tests__/persistCampaignsLiveDeleteOldStoreRowV2.test.ts
```

Expected: 5/5 FAIL (the DELETE-then-UPSERT logic + row.storeId logic don't exist yet).

- [ ] **Step 3: Add DELETE-then-UPSERT + restore row.storeId in persistCampaignsLive.ts**

Open `dashboard-web/src/lib/inngest/persistCampaignsLive.ts`. Find the ttGroups block (~line 287) — currently:

```typescript
    if (!g) {
      g = {
        // Phase A.5 ROLLED BACK 2026-05-29 — using row.storeId here caused
        // ...
        storeId,
        campaignId: r.campaignId, campaignName: r.campaignName,
        // ...
      };
```

Replace with:

```typescript
    if (!g) {
      g = {
        // Phase A.5 v2 (2026-05-29) — TikTok rows write under their resolved
        // storeId (from the campaign-store-map; fetcher attaches it via
        // resolveStoreForCampaign). v1 introduced this and caused PK
        // duplicate-row bugs because UPSERT against the same campaign_id
        // under a different store_id never conflicted. v2 fixes that via
        // the batch DELETE below (~line 395) that wipes any row whose
        // store_id is NOT in the target set before the UPSERT runs.
        storeId: r.storeId ?? storeId,
        campaignId: r.campaignId, campaignName: r.campaignName,
        adSetId: r.adSetId, adSetName: r.adSetName,
        spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0,
        currency: 'USD', effectiveStatus: r.effectiveStatus ?? null,
      };
```

Find the campaigns_daily TikTok UPSERT block (~line 395). Currently the row builder uses `store_id: storeId` (post-rollback). Replace:

```typescript
      const row: Record<string, unknown> = {
        date: dateStr,
        // Phase A.5 ROLLED BACK 2026-05-29 — see ttGroups comment above for the
        // PK duplication bug. Until a per-campaign-id migration strategy is
        // designed, TikTok rows always write under the function-arg storeId.
        store_id: storeId,
        platform: 'tiktok' as const,
```

With:

```typescript
      const row: Record<string, unknown> = {
        date: dateStr,
        // Phase A.5 v2 (2026-05-29) — store_id from the resolved ttGroup
        // (which honors row.storeId). The batch DELETE below wipes any
        // legacy row under a different store_id BEFORE this UPSERT runs.
        store_id: g.storeId,
        platform: 'tiktok' as const,
```

(Use `g.storeId` since we're inside the `.map(g => ...)` on the group, not the raw row.)

Now find the campaigns_daily UPSERT call (the `.upsert(allCampaignRows, ...)` ~ line 317). BEFORE that upsert, insert the DELETE batch.

The current upsert block (post-rollback):

```typescript
  if (allCampaignRows.length > 0) {
    const { error } = await admin
      .from('campaigns_daily')
      .upsert(allCampaignRows, { onConflict: 'date,store_id,platform,campaign_id,ad_set_id' });
    if (error) {
      throw new Error(`campaigns_daily upsert ${storeId} ${dateStr}: ${error.message}`);
    }
  }
```

Replace with:

```typescript
  if (allCampaignRows.length > 0) {
    // Phase A.5 v2 — DELETE other-store TikTok rows for the campaigns being
    // written this tick. Without this, a campaign that the operator just
    // re-tagged from uzoshop to usmile360 would leave the legacy uzoshop
    // row in place (PK includes store_id, so UPSERT doesn't conflict) →
    // duplicate rows → doubled spend after agg_tiktok_spend_per_store_for_date.
    const ttCampaignRows = allCampaignRows.filter(r => r.platform === 'tiktok');
    if (ttCampaignRows.length > 0) {
      const ttCampaignIds = [...new Set(ttCampaignRows.map(r => r.campaign_id as string))];
      const ttTargetStoreIds = [...new Set(ttCampaignRows.map(r => r.store_id as string))];
      const { error: delErr } = await admin
        .from('campaigns_daily')
        .delete()
        .eq('date', dateStr)
        .eq('platform', 'tiktok')
        .in('campaign_id', ttCampaignIds)
        .not('store_id', 'in', `(${ttTargetStoreIds.map(s => `"${s}"`).join(',')})`);
      if (delErr) {
        console.warn(
          `persistCampaignsLive ${storeId} ${dateStr}: campaigns_daily tt DELETE failed: ${delErr.message}`,
        );
      }
    }

    const { error } = await admin
      .from('campaigns_daily')
      .upsert(allCampaignRows, { onConflict: 'date,store_id,platform,campaign_id,ad_set_id' });
    if (error) {
      throw new Error(`campaigns_daily upsert ${storeId} ${dateStr}: ${error.message}`);
    }
  }
```

**About the test mock shape:** the test's `makeAdminMock` uses 4-chain `.eq().eq().in().in()` because the production code uses `.eq('date').eq('platform').in('campaign_id', ...).not('store_id', 'in', ...)`. The Supabase `.not('col', 'in', '(v1,v2)')` is the negated IN variant — the mock surfaces it as an `.in()` call on the negated column for simplicity. If the test fails because the mock can't accept the `.not()`, update the mock to chain `.not(col, op, val)` as well — keep it simple.

Now repeat the same pattern for `ads_daily`. Find the ads_daily TikTok row builder (~line 395 — uses `store_id: storeId` post-rollback). Replace with `store_id: r.storeId ?? storeId`.

Find the ads_daily UPSERT block:

```typescript
  if (allAdRows.length > 0) {
    const { error } = await admin
      .from('ads_daily')
      .upsert(allAdRows, { onConflict: 'date,store_id,ad_id' });
    if (error) {
      throw new Error(`ads_daily upsert ${storeId} ${dateStr}: ${error.message}`);
    }
  }
```

Replace with:

```typescript
  if (allAdRows.length > 0) {
    // Phase A.5 v2 — same DELETE-then-UPSERT as campaigns_daily but keyed on ad_id.
    const ttAdRows = allAdRows.filter(r => r.platform === 'tiktok');
    if (ttAdRows.length > 0) {
      const ttAdIds = [...new Set(ttAdRows.map(r => r.ad_id as string))];
      const ttTargetStoreIds = [...new Set(ttAdRows.map(r => r.store_id as string))];
      const { error: delErr } = await admin
        .from('ads_daily')
        .delete()
        .eq('date', dateStr)
        .in('ad_id', ttAdIds)
        .not('store_id', 'in', `(${ttTargetStoreIds.map(s => `"${s}"`).join(',')})`);
      if (delErr) {
        console.warn(
          `persistCampaignsLive ${storeId} ${dateStr}: ads_daily tt DELETE failed: ${delErr.message}`,
        );
      }
    }

    const { error } = await admin
      .from('ads_daily')
      .upsert(allAdRows, { onConflict: 'date,store_id,ad_id' });
    if (error) {
      throw new Error(`ads_daily upsert ${storeId} ${dateStr}: ${error.message}`);
    }
  }
```

- [ ] **Step 4: Re-run targeted tests — should GREEN**

```bash
cd dashboard-web && npm test -- src/lib/inngest/__tests__/persistCampaignsLiveDeleteOldStoreRowV2.test.ts
```

Expected: 5/5 PASS.

If the test mock shape doesn't match (`.eq().eq().in().not()`), update the `makeAdminMock` to handle the actual chain. The production code uses `.not('store_id', 'in', '(...)')` — adjust the mock to record the `.not()` call as the 4th chain step. The test's payload assertions should match what the code actually calls.

- [ ] **Step 5: Run full node suite — confirm no regression**

```bash
cd dashboard-web && npm test
```

Expected: 1388 / 1389 (1384 baseline + 4 new in this task — adjust if you added 5 tests).

- [ ] **Step 6: Commit**

```bash
git add dashboard-web/src/lib/inngest/persistCampaignsLive.ts \
        dashboard-web/src/lib/inngest/__tests__/persistCampaignsLiveDeleteOldStoreRowV2.test.ts
git commit -m "feat(phase-a5-v2): persistCampaignsLive batch DELETE-then-UPSERT for TikTok

Fixes the v1 rollback root cause. Before each TikTok UPSERT batch:

  DELETE FROM campaigns_daily
    WHERE date=\$1 AND platform='tiktok'
      AND campaign_id IN (campaigns_being_written)
      AND store_id NOT IN (target_store_ids)

Same for ads_daily (keyed on ad_id). This guarantees campaigns_daily has
exactly one row per (date, platform, campaign_id, ad_set_id) regardless
of how many times the operator re-tags the campaign's store.

TikTok rows now write under row.storeId (resolved by the fetcher via the
campaign-store-map). Non-TikTok branches (Meta, Google) are unchanged.

Tests: 5 covering the DELETE call shape, DELETE-before-UPSERT order,
ads_daily mirroring, no-op when no TikTok rows, row.storeId honored.

Plan: docs/superpowers/plans/2026-05-29-phase-a5-v2-campaign-store-mapping.md (Task 3)"
```

---

## Task 4: cron-daily — DELETE-then-UPSERT for TikTok + re-enable RPC

`cron-daily` runs at 00:05 IL and re-writes yesterday's data. It writes campaigns_daily directly (not via persistCampaignsLive). The same DELETE-then-UPSERT is needed in `cronDaily.ts`.

**Files:**
- Modify: `dashboard-web/src/inngest/functions/cronDaily.ts`
- Create: `dashboard-web/src/inngest/functions/__tests__/cronDailyDeleteOldStoreRowV2.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// dashboard-web/src/inngest/functions/__tests__/cronDailyDeleteOldStoreRowV2.test.ts
//
// Phase A.5 v2 — verifies cron-daily does DELETE-then-UPSERT for TikTok rows
// so the nightly reconcile also can't introduce duplicate rows.

import { describe, it, expect, vi } from 'vitest';

// Mock the Phase A pre-flight + freshness paths so the test focuses on
// the DELETE-then-UPSERT behavior.
vi.mock('@/lib/notifications/metaBucUsage', () => ({
  getMetaBucUsageForStore: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/inngest/freshness', () => ({
  recordFreshness: vi.fn(),
}));
vi.mock('@/lib/notifications/tokenFailures', () => ({
  notifyTokenFailure: vi.fn(),
}));

// Mock the fetchers to return TikTok rows under usmile360 (i.e. the operator
// has already tagged the campaign).
vi.mock('@/lib/fetchers/tiktok', () => ({
  fetchTikTokSpendForDay: vi.fn().mockResolvedValue({ spend: 0, impressions: 0, currency: 'USD' }),
  fetchTikTokAdInsights: vi.fn().mockResolvedValue([
    {
      storeId: 'usmile360',
      campaignId: 'C1',
      campaignName: 'X',
      adGroupId: 'AG1',
      adId: 'A1',
      spend: 10,
      impressions: 100,
      clicks: 5,
      conversions: 1,
      conversionValue: 50,
      complete_payment_roas: 5,
      last_status_check: '2026-05-28',
      effectiveStatus: 'ADGROUP_STATUS_DELIVERY_OK',
    },
  ]),
  fetchTikTokAdvertiserInfo: vi.fn().mockResolvedValue({ currency: 'USD' }),
}));

// ... (mock other fetchers to return empty per existing cronDaily.test.ts pattern)

describe('Phase A.5 v2 — cronDaily DELETE-then-UPSERT for TikTok', () => {
  it('1. campaigns_daily DELETE fires BEFORE the TikTok UPSERT', async () => {
    // ... (test scaffolding — mirror cronDailyMarksFinalized.test.ts patterns)
    // Assertion: order of DELETE call and UPSERT call on campaigns_daily
    // with the TikTok rows from the fetcher mock.
  });

  it('2. DELETE removes rows whose store_id is NOT in the target set', async () => {
    // Assertion: the DELETE payload includes `store_id NOT IN (usmile360)`
    // (the new target store from the fetcher mock's row.storeId)
  });

  it('3. ads_daily gets the same DELETE-then-UPSERT pattern', async () => {
    // Assertion: ads_daily DELETE call matches ad_id from the fetcher row
  });
});
```

(Reuse the Supabase admin stub factory from `cronDailyMarksFinalized.test.ts` — there's an `.rpc()` spy + `.from(table).upsert/delete()` capture pattern there. Adapt to capture both DELETE and UPSERT calls with their order.)

- [ ] **Step 2: Run targeted tests — confirm RED**

```bash
cd dashboard-web && npm test -- src/inngest/functions/__tests__/cronDailyDeleteOldStoreRowV2.test.ts
```

Expected: 3/3 FAIL.

- [ ] **Step 3: Add DELETE-then-UPSERT to cronDaily.ts**

Open `dashboard-web/src/inngest/functions/cronDaily.ts`. Find the TikTok campaigns_daily upsert (~line 1180 area). The current state (post-rollback) is just the UPSERT.

Add a DELETE block ABOVE the upsert (same shape as Task 3's persistCampaignsLive change):

```typescript
      // Phase A.5 v2 — DELETE other-store TikTok rows for the campaigns being
      // written this tick. Mirrors persistCampaignsLive (Task 3); the same
      // duplicate-row root cause applies to cron-daily's nightly reconcile.
      if (tiktokCampaignRows.length > 0) {
        const ttCampaignIds = [...new Set(tiktokCampaignRows.map(r => r.campaign_id as string))];
        const ttTargetStoreIds = [...new Set(tiktokCampaignRows.map(r => r.store_id as string))];
        const { error: delErr } = await admin
          .from('campaigns_daily')
          .delete()
          .eq('date', dateStr)
          .eq('platform', 'tiktok')
          .in('campaign_id', ttCampaignIds)
          .not('store_id', 'in', `(${ttTargetStoreIds.map(s => `"${s}"`).join(',')})`);
        if (delErr) {
          console.warn(
            `cron-daily ${storeId} ${dateStr}: campaigns_daily tt DELETE failed: ${delErr.message}`,
          );
        }
      }

      const { error } = await admin.from('campaigns_daily').upsert(tiktokCampaignRows, {
        onConflict: 'date,store_id,platform,campaign_id,ad_set_id',
      });
      if (error) {
        throw new Error(`campaigns_daily (tiktok) upsert for ${storeId} ${dateStr}: ${error.message}`);
      }
```

Make sure `tiktokCampaignRows` is built with `store_id: r.storeId ?? storeId` (restore the v1 line — the current post-rollback version uses `storeId`).

Repeat for the ads_daily TikTok upsert in cron-daily (same pattern, keyed on ad_id, no platform column filter — verify ads_daily has no platform column; if it does, add `.eq('platform', 'tiktok')` for safety).

Also re-add the `agg_tiktok_spend_per_store_for_date` RPC call AFTER the TikTok upsert (this was removed in the rollback — Task 6 from v1):

```typescript
      // Phase A.5 v2 — re-aggregate data_daily TikTok columns per store from
      // the freshly-written per-row campaigns_daily slices. SQL function is
      // already in production (migration 20260530120000). Soft-fail.
      const { error: aggErr } = await admin.rpc('agg_tiktok_spend_per_store_for_date', { d: dateStr });
      if (aggErr) {
        console.warn(`cron-daily ${storeId} ${dateStr}: tt agg RPC failed: ${aggErr.message}`);
      }
```

- [ ] **Step 4: Re-run targeted tests — confirm GREEN**

- [ ] **Step 5: Run full node suite + commit**

```bash
cd dashboard-web && npm test && cd .. && \
git add dashboard-web/src/inngest/functions/cronDaily.ts \
        dashboard-web/src/inngest/functions/__tests__/cronDailyDeleteOldStoreRowV2.test.ts && \
git commit -m "feat(phase-a5-v2): cron-daily DELETE-then-UPSERT + re-enable agg RPC

Mirrors Task 3's persistCampaignsLive change. The nightly reconcile path
needs the same protection — without it, a tagged campaign's yesterday-row
would survive under the legacy store after cron-daily runs.

Re-enables the agg_tiktok_spend_per_store_for_date RPC call after the
TikTok upsert (Phase A.5 v1 had this; rollback removed it; v2 restores
it because the duplicate-row root cause is now fixed at the persist layer).

Plan: docs/superpowers/plans/2026-05-29-phase-a5-v2-campaign-store-mapping.md (Task 4)"
```

---

## Task 5: persistCampaignsLive — re-enable the agg RPC call

Same RPC restoration as Task 4 but for the live path (cron-live-heavy stagger). Without it, today's data_daily would not reflect re-tags until tomorrow morning's cron-daily.

**Files:**
- Modify: `dashboard-web/src/lib/inngest/persistCampaignsLive.ts`

- [ ] **Step 1: Re-add the RPC call at the end of `persistCampaignsLive`**

Open `dashboard-web/src/lib/inngest/persistCampaignsLive.ts`. The end of the function (post-rollback) looks like:

```typescript
  // Phase A.5 ROLLED BACK 2026-05-29 — the RPC call to
  // agg_tiktok_spend_per_store_for_date was part of the per-store TikTok
  // attribution path that turned out to corrupt campaigns_daily. The SQL
  // function itself stays in the migration (no harm; unused) until Phase A.5
  // is properly re-shipped with a per-campaign-id PK strategy.
}
```

Replace with:

```typescript
  // Phase A.5 v2 — re-aggregate data_daily TikTok columns per store from the
  // freshly-written per-row campaigns_daily slices. The duplicate-row bug
  // that forced v1's rollback is now fixed at the DELETE-then-UPSERT layer
  // above, so the RPC can run safely. Soft-fail: the per-row campaigns_daily
  // data is correct on its own; only the data_daily aggregate is stale on
  // failure (which the next tick fixes).
  try {
    const { error: aggErr } = await admin.rpc('agg_tiktok_spend_per_store_for_date', { d: dateStr });
    if (aggErr) {
      console.warn(`persistCampaignsLive ${storeId} ${dateStr}: tt agg RPC failed: ${aggErr.message}`);
    }
  } catch (e) {
    console.warn(
      `persistCampaignsLive ${storeId} ${dateStr}: tt agg RPC threw: ${e instanceof Error ? e.message : e}`,
    );
  }
}
```

- [ ] **Step 2: Verify the existing Task 3 tests still pass + tsc clean**

The Task 3 test mock's `admin.rpc = vi.fn().mockResolvedValue({ error: null })` already handles this call — no test change needed.

```bash
cd dashboard-web && npx tsc --noEmit && npm test -- src/lib/inngest/__tests__/persistCampaignsLiveDeleteOldStoreRowV2.test.ts
```

Expected: tsc clean, 5/5 GREEN.

- [ ] **Step 3: Run full suite**

```bash
cd dashboard-web && npm test
```

Expected: same count as Task 4's commit (no new tests added in Task 5).

- [ ] **Step 4: Commit**

```bash
git add dashboard-web/src/lib/inngest/persistCampaignsLive.ts
git commit -m "feat(phase-a5-v2): persistCampaignsLive re-enables agg RPC (live path)

Mirrors Task 4's cron-daily restoration. The RPC was removed in the v1
rollback because the duplicate rows from Task 3's missing DELETE caused
data_daily to be doubled. Now that the DELETE-then-UPSERT is in place
(Task 3), the RPC is safe to re-enable.

Without this, today's data_daily.tt_spend_cad for re-tagged campaigns
would lag until tomorrow morning's cron-daily reconcile.

Plan: docs/superpowers/plans/2026-05-29-phase-a5-v2-campaign-store-mapping.md (Task 5)"
```

---

## Task 6: CampaignDrawer Store mapping section + effectiveStoreId/Name

Re-introduce the drawer-based UI from v1's UX refactor. This is the operator's tagging surface. The implementation is identical to v1's final state (commits `f17c7ee` + `10af16d` + `a141946`) since those UX iterations were correct — the only bug was the data path (Task 3/4), not the UI.

**Files:**
- Modify: `dashboard-web/src/components/CampaignDrawer.tsx`
- Create: `dashboard-web/src/components/__tests__/campaignDrawerStoreMapV2.dom.test.tsx`

- [ ] **Step 1: Restore imports for the campaign-store-map helpers**

In `dashboard-web/src/components/CampaignDrawer.tsx`, find the existing `import { readProductMap, campaignKey, setMappedProducts, ... } from '@/lib/campaignProductMap';` block (around line 67). Insert BEFORE it:

```typescript
import {
  readCampaignStoreMap,
  writeCampaignStoreMap,
  campaignStoreKey,
  type CampaignStoreMap,
} from '@/lib/campaignStoreMap';
```

- [ ] **Step 2: Restore the storeMap state + useEffect**

Find the existing `useState<ProductMap>` block (around line 157). Insert AFTER its useEffect:

```typescript
  // Phase A.5 v2 — campaign↔store mapping (TikTok only). Same cloud-sync
  // pattern as productMap. Read once at mount + subscribe to writes from
  // any tab/component.
  const [storeMap, setStoreMap] = useState<CampaignStoreMap>(() => ({}));
  useEffect(() => {
    setStoreMap(readCampaignStoreMap());
    const onChange = () => setStoreMap(readCampaignStoreMap());
    window.addEventListener('roas-campaign-store-map-changed', onChange);
    return () => window.removeEventListener('roas-campaign-store-map-changed', onChange);
  }, []);
```

- [ ] **Step 3: Add the `effectiveStoreId` + `effectiveStoreName` memos**

Find the `mappedIds` useMemo (around line 393, post-rollback uses `storeId`). Insert ABOVE it:

```typescript
  // Phase A.5 v2 — effectiveStoreId resolves the operator's pending store
  // re-tag for TikTok campaigns BEFORE cron-live-heavy re-buckets the
  // underlying campaigns_daily rows. Once tagged via the drawer's store
  // dropdown, the product picker + product-map writes immediately target
  // the new store so the operator can complete "tag store → tag products"
  // in one session without waiting 30 min for the cron tick.
  //
  // Non-TikTok campaigns: effectiveStoreId === storeId-prop (no mapping).
  // TikTok unmapped: effectiveStoreId === storeId-prop (defaults to uzoshop).
  // TikTok mapped: effectiveStoreId === storeMap[key] (the new store).
  const effectiveStoreId = useMemo(() => {
    if (summary?.platform !== 'TikTok') return storeId;
    const advertiserId = adAccounts[storeId]?.tiktokAdvertiserId ?? '';
    if (!advertiserId) return storeId;
    return storeMap[campaignStoreKey('tiktok', advertiserId, campaignId)] ?? storeId;
  }, [summary?.platform, storeMap, adAccounts, storeId, campaignId]);

  // Phase A.5 v2 — derived display name for the effective store. summary.storeName
  // comes from the campaign's data row which still carries the pre-migration
  // storeId until cron-live-heavy re-attributes (~30 min). Without this derived
  // name, ProductPickerModal's header says "Map UZOSHOP products to campaign"
  // even when the products shown are usmile360's.
  const STORE_DISPLAY_NAMES: Record<string, string> = useMemo(
    () => ({ uzoshop: 'uzoshop', zolplus: 'Zol Plus', usmile360: '360usmile' }),
    [],
  );
  const effectiveStoreName = useMemo(() => {
    return STORE_DISPLAY_NAMES[effectiveStoreId] ?? summary?.storeName ?? effectiveStoreId;
  }, [STORE_DISPLAY_NAMES, effectiveStoreId, summary?.storeName]);
```

Update the `mappedIds` useMemo to use `effectiveStoreId`:

```typescript
  const mappedIds = useMemo(
    () => {
      const platformForCampaign = rows[0]?.platform ?? summary?.platform ?? '';
      return productMap[campaignKey(effectiveStoreId, platformForCampaign, campaignId)] ?? [];
    },
    [productMap, rows, summary?.platform, effectiveStoreId, campaignId],
  );
```

- [ ] **Step 4: Add the Store dropdown section ABOVE the Shopify products section**

Find the existing comment block `{/* Phase A.5 ROLLED BACK 2026-05-29 — the TikTok per-campaign store mapping section lived here. ... */}` (around line 1211). Replace it with the actual section UI:

```typescript
          {/* Phase A.5 v2 — TikTok campaign↔store mapping (drawer-based).
              The TikTok advertiser is shared across stores; this section lets
              the operator tag which store the campaign actually belongs to.
              Tagging applies immediately to the product picker below (so the
              "tag store → tag products" flow works in one session) and to the
              next cron-live-heavy tick which re-buckets campaigns_daily +
              ads_daily under the new store (Task 3's DELETE-then-UPSERT
              guarantees no duplicate rows). */}
          {summary.platform === 'TikTok' && (() => {
            const advertiserId = adAccounts[storeId]?.tiktokAdvertiserId ?? '';
            const key = advertiserId
              ? campaignStoreKey('tiktok', advertiserId, campaignId)
              : '';
            const currentValue = key ? storeMap[key] : undefined;
            const isUnmapped = currentValue === undefined;
            return (
              <section>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <h3 className="text-sm font-semibold text-ink inline-flex items-center gap-1.5">
                    🏪 חנות בעלת הקמפיין
                    {isUnmapped && (
                      <span className="text-[10px] font-medium text-status-orange">
                        (לא ממופה · ברירת מחדל uzoshop)
                      </span>
                    )}
                  </h3>
                </div>
                <p className="text-[11px] text-ink-muted leading-relaxed bg-elevated2/40 rounded-lg px-3 py-2 mb-2">
                  ה-TikTok advertiser שלנו (uzoshop) משרת מספר חנויות. בחר לאיזו חנות הקמפיין שייך —
                  קודם תייג חנות, אח״כ שייך מוצרים. שינוי חל מיידית על מיפוי המוצרים למטה; הסבב הבא של cron-live-heavy (עד 30 דק׳)
                  ירשום את ה-spend תחת החנות הנכונה ב-<code>campaigns_daily</code>. שורות היסטוריות נשארות תחת uzoshop.
                </p>
                <select
                  data-testid="drawer-store-select"
                  disabled={!advertiserId}
                  value={currentValue ?? '__unmapped__'}
                  onChange={(e) => {
                    if (!key) return;
                    const oldEffectiveStoreId = currentValue ?? storeId;
                    const newRawValue = e.target.value;
                    const newEffectiveStoreId = newRawValue === '__unmapped__' ? storeId : newRawValue;

                    // 1. Update the campaign-store-map.
                    const next: CampaignStoreMap = { ...storeMap };
                    if (newRawValue === '__unmapped__') {
                      delete next[key];
                    } else {
                      next[key] = newRawValue;
                    }
                    writeCampaignStoreMap(next);
                    setStoreMap(next);

                    // 2. Phase A.5 v2 (Task 7) — migrate productMap entry from the
                    //    old store's key to the new store's key. Without this,
                    //    products tagged before the store change become orphans
                    //    under the old storeId after cron-live-heavy migrates.
                    if (oldEffectiveStoreId !== newEffectiveStoreId) {
                      const oldProductKey = campaignKey(oldEffectiveStoreId, 'TikTok', campaignId);
                      const newProductKey = campaignKey(newEffectiveStoreId, 'TikTok', campaignId);
                      const existing = productMap[oldProductKey];
                      if (existing && existing.length > 0 && oldProductKey !== newProductKey) {
                        const updatedProductMap = { ...productMap, [newProductKey]: existing };
                        delete updatedProductMap[oldProductKey];
                        // setMappedProducts writes via the campaign-product-map cloud-sync
                        // and dispatches the change event so the local productMap state updates.
                        setMappedProducts(newEffectiveStoreId, 'TikTok', campaignId, existing);
                        // Clear the old key too so it doesn't shadow the new one.
                        setMappedProducts(oldEffectiveStoreId, 'TikTok', campaignId, []);
                      }
                    }
                  }}
                  className="w-full text-sm bg-elevated border border-line rounded px-3 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="__unmapped__">(לא ממופה · ברירת מחדל uzoshop)</option>
                  <option value="uzoshop">uzoshop</option>
                  <option value="zolplus">Zol Plus</option>
                  <option value="usmile360">360usmile</option>
                </select>
                {!isUnmapped && currentValue !== storeId && (
                  <p className="text-[11px] text-status-orange mt-2">
                    ⚠ מיפוי המוצרים למטה כבר מציג את {currentValue}. שאר הפאנלים בכרטיסייה הזו עדיין מציגים נתונים של {storeId} עד שcron-live-heavy יכתוב מחדש (עד 30 דק׳).
                  </p>
                )}
              </section>
            );
          })()}

```

- [ ] **Step 5: Update ProductPickerModal call site to use effectiveStoreId + effectiveStoreName**

Find the existing `<ProductPickerModal>` (around line 1404). The current state (post-rollback) uses `storeId` and `summary.storeName`:

```typescript
      <ProductPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        storeId={storeId}
        storeName={summary.storeName}
        campaignName={summary.campaignName}
        initial={productMap[campaignKey(storeId, summary.platform, campaignId)] ?? []}
        otherCampaignsByProduct={otherCampaignsByProduct}
        onSave={(productIds) => {
          setMappedProducts(storeId, summary.platform, campaignId, productIds);
        }}
      />
```

Replace with:

```typescript
      <ProductPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        storeId={effectiveStoreId}
        storeName={effectiveStoreName}
        campaignName={summary.campaignName}
        initial={productMap[campaignKey(effectiveStoreId, summary.platform, campaignId)] ?? []}
        otherCampaignsByProduct={otherCampaignsByProduct}
        onSave={(productIds) => {
          setMappedProducts(effectiveStoreId, summary.platform, campaignId, productIds);
        }}
      />
```

- [ ] **Step 6: Write the drawer tests (DOM)**

```typescript
// dashboard-web/src/components/__tests__/campaignDrawerStoreMapV2.dom.test.tsx
//
// Phase A.5 v2 — CampaignDrawer Store mapping section. Verifies:
//   - Dropdown only renders for TikTok campaigns
//   - effectiveStoreId resolves storeMap[key] ?? storeId
//   - effectiveStoreName resolves from the display-name map
//   - Changing the dropdown migrates productMap entry from old → new store
//   - The amber stale-panels notice appears when effective != displayed store

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const writeStoreMapMock = vi.fn();
let storeMapState: Record<string, string> = {};

vi.mock('@/lib/campaignStoreMap', () => ({
  readCampaignStoreMap: () => storeMapState,
  writeCampaignStoreMap: (m: Record<string, string>) => {
    writeStoreMapMock(m);
    storeMapState = m;
  },
  campaignStoreKey: (p: string, a: string, c: string) => `${p}::${a}::${c}`,
}));

const setMappedProductsMock = vi.fn();
let productMapState: Record<string, string[]> = {};
vi.mock('@/lib/campaignProductMap', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    readProductMap: () => productMapState,
    setMappedProducts: (storeId: string, platform: string, campaignId: string, productIds: string[]) => {
      setMappedProductsMock(storeId, platform, campaignId, productIds);
      const key = `${storeId}::${platform}::${campaignId}`;
      productMapState = { ...productMapState };
      if (productIds.length === 0) delete productMapState[key];
      else productMapState[key] = productIds;
    },
  };
});

beforeEach(() => {
  storeMapState = {};
  productMapState = {};
  writeStoreMapMock.mockReset();
  setMappedProductsMock.mockReset();
});

describe('Phase A.5 v2 — CampaignDrawer Store mapping section', () => {
  // (Test scaffolding — render the drawer with a fixture campaign row +
  // adAccounts prop with tiktokAdvertiserId. Mock SWR fetchers to return
  // minimal valid data. Inspect by data-testid='drawer-store-select'.)

  it('1. Renders dropdown ONLY for TikTok campaigns', () => {
    // Render drawer for a Meta campaign → expect drawer-store-select NOT in DOM
    // Render drawer for a TikTok campaign → expect drawer-store-select IS in DOM
  });

  it('2. Dropdown is disabled when adAccounts[storeId].tiktokAdvertiserId is missing', () => {
    // Render TikTok drawer with adAccounts.uzoshop.tiktokAdvertiserId = null
    // Expect select to have `disabled` attribute
  });

  it('3. Picking usmile360 calls writeCampaignStoreMap with the new mapping', () => {
    // Render TikTok drawer with valid advertiser
    // fireEvent.change(select, { target: { value: 'usmile360' } })
    // Expect writeStoreMapMock to have been called with object containing
    // `tiktok::<advertiserId>::<campaignId>: 'usmile360'`
  });

  it('4. Picking usmile360 migrates productMap from uzoshop key to usmile360 key', () => {
    // Pre-populate productMapState with `uzoshop::TikTok::C1` -> ['p1', 'p2']
    // Render drawer for campaign C1 (storeId='uzoshop')
    // fireEvent.change(select, { target: { value: 'usmile360' } })
    // Expect setMappedProducts called twice:
    //   1. ('usmile360', 'TikTok', 'C1', ['p1', 'p2'])
    //   2. ('uzoshop', 'TikTok', 'C1', [])
  });

  it('5. Re-picking the same value does NOT call migration', () => {
    // Same setup as test 4, but pick uzoshop (no change)
    // Expect setMappedProducts NOT called
  });
});
```

- [ ] **Step 7: Run targeted tests**

```bash
cd dashboard-web && npm run test:components -- src/components/__tests__/campaignDrawerStoreMapV2.dom.test.tsx
```

Iterate until all 5 pass. The test scaffolding may need a full drawer-rendering helper — model it after `CampaignDrawer` mocking patterns used elsewhere if any test file exists (search for `<CampaignDrawer`). If no template exists, the implementer may simplify the tests to call the drawer with a minimal prop set + verify dropdown + handler behavior without rendering nested panels.

- [ ] **Step 8: Run full DOM + node suites**

```bash
cd dashboard-web && npm run test:components && npm test
```

Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add dashboard-web/src/components/CampaignDrawer.tsx \
        dashboard-web/src/components/__tests__/campaignDrawerStoreMapV2.dom.test.tsx
git commit -m "feat(phase-a5-v2): restore drawer Store section + effectiveStoreId/Name + product-map migration

Restores the operator's tagging surface inside CampaignDrawer. Three
v1 UX fixes are re-applied:

  1. effectiveStoreId resolves storeMap[key] ?? storeId so the product
     picker switches to the new store's products immediately after
     tagging (without waiting 30 min for cron-live-heavy).

  2. effectiveStoreName via STORE_DISPLAY_NAMES so the picker header
     shows the new store name (not the data-side legacy name).

  3. On store change, productMap entry migrates from old key to new key.
     Without this, products tagged before the store change become orphans
     under the old storeId after cron-live-heavy migrates the campaigns_daily
     row.

Plan: docs/superpowers/plans/2026-05-29-phase-a5-v2-campaign-store-mapping.md (Task 6)"
```

---

## Task 7: Acceptance test — end-to-end no-duplicate guarantee

This is the load-bearing test. It simulates the full flow (operator tags → cron-live-heavy runs → assertions) and verifies the campaigns_daily ends with exactly one row.

**Files:**
- Create: `dashboard-web/src/lib/inngest/__tests__/persistCampaignsLiveRetagFlowV2.test.ts`

- [ ] **Step 1: Write the integration-style test**

```typescript
// dashboard-web/src/lib/inngest/__tests__/persistCampaignsLiveRetagFlowV2.test.ts
//
// Phase A.5 v2 — end-to-end test: operator tags campaign C1 to usmile360,
// cron-live-heavy runs, and the in-memory campaigns_daily has EXACTLY
// ONE row for C1 (under usmile360). This is the acceptance test that
// prevents the v1 duplicate-row bug from regressing.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { persistCampaignsLive, type TikTokAdLiveRow } from '../persistCampaignsLive';

// In-memory campaigns_daily store keyed by the PK
const campaignsDaily = new Map<string, Record<string, unknown>>();
const adsDaily = new Map<string, Record<string, unknown>>();

function makeAdminMock() {
  return {
    from: (table: string) => ({
      delete: () => ({
        eq: (col1: string, v1: unknown) => ({
          eq: (col2: string, v2: unknown) => ({
            in: (col3: string, v3: unknown[]) => ({
              not: (col4: string, op: string, v4: string) => {
                // Parse the negated IN value like `("uzoshop","zolplus")`
                const keepStores = v4
                  .replace(/^[\("]+|[\)"]+$/g, '')
                  .split(/"[,]"/);
                const target = table === 'campaigns_daily' ? campaignsDaily : adsDaily;
                for (const [key, row] of target) {
                  if (
                    row.date === v1 &&
                    row.platform === v2 &&
                    (v3 as unknown[]).includes(row[col3]) &&
                    !keepStores.includes(row.store_id as string)
                  ) {
                    target.delete(key);
                  }
                }
                return Promise.resolve({ error: null });
              },
            }),
          }),
        }),
        // ads_daily variant has no .eq('platform') step — different chain depth
        in: (col2: string, v2: unknown[]) => ({
          not: (col3: string, op: string, v3: string) => {
            const keepStores = v3
              .replace(/^[\("]+|[\)"]+$/g, '')
              .split(/"[,]"/);
            for (const [key, row] of adsDaily) {
              if (
                row.date === v1 &&
                (v2 as unknown[]).includes(row[col2]) &&
                !keepStores.includes(row.store_id as string)
              ) {
                adsDaily.delete(key);
              }
            }
            return Promise.resolve({ error: null });
          },
        }),
      }),
      upsert: async (rows: Array<Record<string, unknown>>, opts?: { onConflict?: string }) => {
        const target = table === 'campaigns_daily' ? campaignsDaily : adsDaily;
        for (const row of rows) {
          // Build PK based on onConflict columns
          const conflictCols = (opts?.onConflict ?? '').split(',');
          const pk = conflictCols.map(c => String(row[c.trim()])).join('|');
          target.set(pk, row);
        }
        return { error: null };
      },
    }),
    rpc: vi.fn().mockResolvedValue({ error: null }),
  };
}

beforeEach(() => {
  campaignsDaily.clear();
  adsDaily.clear();
});

describe('Phase A.5 v2 acceptance — no duplicate rows after re-tag flow', () => {
  const baseTtRow = (storeId: string): TikTokAdLiveRow =>
    ({
      storeId,
      campaignId: 'C1',
      campaignName: 'קרוסלות - usmile360',
      adGroupId: 'AG1',
      adId: 'A1',
      spend: 10,
      impressions: 100,
      clicks: 5,
      conversions: 1,
      conversionValue: 50,
      complete_payment_roas: 5,
      last_status_check: '2026-05-29',
    } as TikTokAdLiveRow);

  it('1. Initial tick (campaign under uzoshop) writes exactly 1 row', async () => {
    await persistCampaignsLive({
      storeId: 'uzoshop',
      dateStr: '2026-05-29',
      admin: makeAdminMock() as unknown as ReturnType<typeof import('@supabase/supabase-js').createClient>,
      getFx: async () => 1,
      meta: { adsetRows: [], adRows: [], budgets: { currency: 'USD', campaigns: {}, adSets: {} } },
      google: { adGroupRows: [], adRows: [] },
      tiktok: { adRows: [baseTtRow('uzoshop')] },
    });

    const ttRows = Array.from(campaignsDaily.values()).filter(
      r => r.platform === 'tiktok' && r.campaign_id === 'C1' && r.date === '2026-05-29',
    );
    expect(ttRows).toHaveLength(1);
    expect(ttRows[0].store_id).toBe('uzoshop');
  });

  it('2. Re-tag tick (campaign moved to usmile360) replaces the row — still exactly 1', async () => {
    // Seed: initial state from test 1
    campaignsDaily.set(
      '2026-05-29|uzoshop|tiktok|C1|AG1',
      { date: '2026-05-29', store_id: 'uzoshop', platform: 'tiktok', campaign_id: 'C1', ad_set_id: 'AG1', spend_cad: 10 },
    );

    await persistCampaignsLive({
      storeId: 'uzoshop',
      dateStr: '2026-05-29',
      admin: makeAdminMock() as unknown as ReturnType<typeof import('@supabase/supabase-js').createClient>,
      getFx: async () => 1,
      meta: { adsetRows: [], adRows: [], budgets: { currency: 'USD', campaigns: {}, adSets: {} } },
      google: { adGroupRows: [], adRows: [] },
      tiktok: { adRows: [baseTtRow('usmile360')] },  // re-tagged
    });

    const ttRows = Array.from(campaignsDaily.values()).filter(
      r => r.platform === 'tiktok' && r.campaign_id === 'C1' && r.date === '2026-05-29',
    );
    expect(ttRows).toHaveLength(1);
    expect(ttRows[0].store_id).toBe('usmile360');
  });

  it('3. Re-tag again (usmile360 → zolplus) replaces — still exactly 1', async () => {
    // Seed: post-test-2 state
    campaignsDaily.set(
      '2026-05-29|usmile360|tiktok|C1|AG1',
      { date: '2026-05-29', store_id: 'usmile360', platform: 'tiktok', campaign_id: 'C1', ad_set_id: 'AG1', spend_cad: 10 },
    );

    await persistCampaignsLive({
      storeId: 'uzoshop',
      dateStr: '2026-05-29',
      admin: makeAdminMock() as unknown as ReturnType<typeof import('@supabase/supabase-js').createClient>,
      getFx: async () => 1,
      meta: { adsetRows: [], adRows: [], budgets: { currency: 'USD', campaigns: {}, adSets: {} } },
      google: { adGroupRows: [], adRows: [] },
      tiktok: { adRows: [baseTtRow('zolplus')] },  // re-tagged again
    });

    const ttRows = Array.from(campaignsDaily.values()).filter(
      r => r.platform === 'tiktok' && r.campaign_id === 'C1' && r.date === '2026-05-29',
    );
    expect(ttRows).toHaveLength(1);
    expect(ttRows[0].store_id).toBe('zolplus');
  });

  it('4. ads_daily mirrors the same behavior', async () => {
    adsDaily.set(
      '2026-05-29|uzoshop|A1',
      { date: '2026-05-29', store_id: 'uzoshop', ad_id: 'A1', platform: 'tiktok' },
    );

    await persistCampaignsLive({
      storeId: 'uzoshop',
      dateStr: '2026-05-29',
      admin: makeAdminMock() as unknown as ReturnType<typeof import('@supabase/supabase-js').createClient>,
      getFx: async () => 1,
      meta: { adsetRows: [], adRows: [], budgets: { currency: 'USD', campaigns: {}, adSets: {} } },
      google: { adGroupRows: [], adRows: [] },
      tiktok: { adRows: [baseTtRow('usmile360')] },
    });

    const adRows = Array.from(adsDaily.values()).filter(
      r => r.ad_id === 'A1' && r.date === '2026-05-29',
    );
    expect(adRows).toHaveLength(1);
    expect(adRows[0].store_id).toBe('usmile360');
  });
});
```

The mock here is more sophisticated than Task 3's — it actually simulates the DELETE WHERE/IN matching so the test verifies the WHOLE pipeline (DELETE removes the right rows + UPSERT writes the new row + final state has exactly one row).

- [ ] **Step 2: Run targeted tests — confirm GREEN**

```bash
cd dashboard-web && npm test -- src/lib/inngest/__tests__/persistCampaignsLiveRetagFlowV2.test.ts
```

Expected: 4/4 PASS. If a test fails because the mock's parsing of the `.not('store_id', 'in', '("a","b")')` value is brittle, simplify the parsing — strip non-alphanumeric chars and split on commas; the goal is to test the BEHAVIOR, not exercise the Supabase quoting layer.

- [ ] **Step 3: Full suite**

```bash
cd dashboard-web && npm test
```

- [ ] **Step 4: Commit**

```bash
git add dashboard-web/src/lib/inngest/__tests__/persistCampaignsLiveRetagFlowV2.test.ts
git commit -m "test(phase-a5-v2): end-to-end no-duplicate-rows acceptance test

The load-bearing test for v2's correctness. Simulates the operator's
tag → re-tag → re-tag flow against an in-memory campaigns_daily +
ads_daily store, verifying that EVERY tick results in exactly one
TikTok row per (date, campaign_id, ad_set_id) regardless of how many
re-tags happened.

This is the test that, had it existed for v1, would have caught the
duplicate-row bug before deploy.

Plan: docs/superpowers/plans/2026-05-29-phase-a5-v2-campaign-store-mapping.md (Task 7)"
```

---

## Task 8: User Manual 2.1.18 + Architecture §25.11 v2

**Files:**
- Modify: `docs/ROAS-Dashboard-User-Manual.md`
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: User Manual bump + v2 changelog**

In `docs/ROAS-Dashboard-User-Manual.md`, change the version banner from 2.1.17 to 2.1.18 (around line 10). Add a new section ABOVE the 2.1.17 entry:

```markdown
### 2.1.18 (2026-05-29) — Phase A.5 v2: TikTok campaign↔store mapping (fixed)

Re-shipped Phase A.5 after the 2026-05-29 morning rollback (גרסה 2.1.17). The
duplicate-row bug that forced v1's rollback is fixed at the database write
layer: before every UPSERT batch for TikTok rows, `persistCampaignsLive` and
`cronDaily` execute a `DELETE FROM campaigns_daily WHERE date=... AND
platform='tiktok' AND campaign_id IN (...) AND store_id NOT IN (target_stores)`.
Same for `ads_daily` keyed on `ad_id`. Result: campaigns_daily always has
exactly one row per (date, platform, campaign_id, ad_set_id), regardless of
how many times the operator re-tags a campaign.

**Other v1 bugs fixed in v2:**

- **Dropdown disabled**: `AdAccountMap.tiktokAdvertiserId` is now populated by
  `/api/store-meta` (server-side env enrichment from `${STORE}_TIKTOK_ADVERTISER_ID`).
- **Picker showed wrong store's products**: drawer computes `effectiveStoreId`
  = `storeMap[key] ?? storeId` and passes it (not the data-side storeId) to
  ProductPickerModal.
- **Picker label "Map UZOSHOP products"**: drawer computes `effectiveStoreName`
  from a `STORE_DISPLAY_NAMES` map (uzoshop / Zol Plus / 360usmile) and passes
  it as `storeName` prop.
- **Product map orphans on store change**: when operator changes the dropdown,
  the drawer COPIES the productMap entry from `(oldStoreId, platform, campaignId)`
  to `(newStoreId, platform, campaignId)` and clears the old entry.
- **No column in CampaignsTable**: the tagging surface is in the drawer only
  (the v1 "column" approach was confirmed as an anti-pattern by the operator).

**Workflow** (the same one v1.16 promised — now actually working):

1. Click campaign row in Campaigns tab → drawer opens.
2. For TikTok campaigns: see the new "🏪 חנות בעלת הקמפיין" section at top.
3. Pick store → save immediate (cloud-sync).
4. Open "✎ שייך מוצרים" → picker shows the NEW store's products.
5. Tag products → save.
6. ≤30 min: next cron-live-heavy tick re-buckets campaigns_daily + ads_daily.
7. Next morning: cron-daily reconcile finalizes yesterday under the correct store.

**Other panels in the drawer** (Health Score, attribution, cohort comparison)
still show the OLD store's data until cron-live-heavy migrates — there's an
amber warning chip explaining this.

---

### 2.1.17 (2026-05-29) — Phase A.5 ROLLBACK: TikTok store mapping disabled (DB corruption)
```

- [ ] **Step 2: Architecture §25.11 update**

In `docs/ARCHITECTURE.md`, find the §25.11 "Campaign↔Store mapping" section. After the existing v1 history note + v2 design requirements paragraph, append:

```markdown

**Phase A.5 v2 SHIPPED 2026-05-29.** The duplicate-row bug is fixed at the persist layer (Tasks 3 + 4 in the v2 plan): every TikTok UPSERT batch is preceded by a `DELETE FROM campaigns_daily/ads_daily WHERE store_id NOT IN (target_stores) AND campaign_id|ad_id IN (rows_being_written)`. This guarantees the campaigns_daily PK `(date, store_id, platform, campaign_id, ad_set_id)` has exactly one row per `(date, platform, campaign_id, ad_set_id)` — the store_id column becomes effectively a "current attribution" tag rather than a discriminator. The SQL function `agg_tiktok_spend_per_store_for_date` (migration `20260530120000`) is re-enabled and recomputes `data_daily.tt_spend_cad` + 4 dependents per store from the now-clean campaigns_daily slices.

**UI restored (CampaignDrawer):** the "🏪 חנות בעלת הקמפיין" section, `effectiveStoreId` resolution, `effectiveStoreName` from a 3-store display-name map, product-map migration on store change. Acceptance test [`persistCampaignsLiveRetagFlowV2.test.ts`](../dashboard-web/src/lib/inngest/__tests__/persistCampaignsLiveRetagFlowV2.test.ts) simulates tag → re-tag → re-tag and asserts campaigns_daily ends with exactly one row each time.

**Plan reference:** [`docs/superpowers/plans/2026-05-29-phase-a5-v2-campaign-store-mapping.md`](superpowers/plans/2026-05-29-phase-a5-v2-campaign-store-mapping.md).
```

- [ ] **Step 3: Commit**

```bash
git add docs/ROAS-Dashboard-User-Manual.md docs/ARCHITECTURE.md
git commit -m "docs(phase-a5-v2): User Manual 2.1.18 + Architecture §25.11 v2 update

Documents the v2 fix: DELETE-then-UPSERT in persistCampaignsLive +
cronDaily prevents the duplicate-row bug that forced v1's rollback.
Lists all 5 v1 UX bugs fixed in v2 (dropdown disabled, picker products
wrong, picker label wrong, product map orphans, column anti-pattern).

Operator workflow guide updated to reflect the working flow.

Plan: docs/superpowers/plans/2026-05-29-phase-a5-v2-campaign-store-mapping.md (Task 8)"
```

---

## Task 9: Full verification gate + push + smoke test

- [ ] **Step 1: Run all gates locally**

From `dashboard-web/`:

```bash
npm test
npm run test:components
npx tsc --noEmit
npm run build
```

Expected:
- npm test: ~1397 / ~1398 (1383 baseline + ~14 new from Tasks 3, 4, 6, 7)
- npm run test:components: ~76 / 76 (72 baseline + 4 new from Task 6)
- tsc clean
- build clean (exit 0)

- [ ] **Step 2: Push**

```bash
git push origin main
```

Wait for Vercel deploy (~2 min). Pre-push hooks (docs-currency + lint) should pass since Tasks 8 covered the docs.

- [ ] **Step 3: Production smoke test — drawer flow**

Visit `https://roas-dashboard-smoky.vercel.app/`. Open a TikTok campaign drawer.

Verify:
1. "🏪 חנות בעלת הקמפיין" section visible at top
2. Dropdown is enabled (NOT disabled)
3. Current value is "(לא ממופה · ברירת מחדל uzoshop)"
4. Picking "360usmile" closes the dropdown to that value
5. Open "✎ שייך מוצרים" — picker header says "מציגים רק מוצרים מחנות: 360usmile"
6. Tag a product → save → reopen the picker → the product is checked

- [ ] **Step 4: Production smoke test — duplicate prevention**

After the next cron-live-heavy tick fires (≤30 min from the tag), query Supabase:

```sql
SELECT date, store_id, campaign_id, COUNT(*) AS rows
  FROM campaigns_daily
 WHERE platform = 'tiktok' AND date >= CURRENT_DATE - 2
 GROUP BY date, store_id, campaign_id
 HAVING COUNT(*) > 1;
```

Expected: 0 rows (no duplicates).

```sql
SELECT date, store_id, campaign_id, spend_cad
  FROM campaigns_daily
 WHERE platform = 'tiktok' AND campaign_id = '<the tagged campaign>'
 ORDER BY date DESC;
```

Expected: the tagged campaign's row appears under the new store_id only; old store_id row is absent.

```sql
SELECT date, store_id, tt_spend_cad, total_spend_cad
  FROM data_daily
 WHERE store_id IN ('usmile360', 'uzoshop', 'zolplus')
   AND date >= CURRENT_DATE - 2
 ORDER BY date DESC, store_id;
```

Expected: usmile360's tt_spend_cad > 0 (the tagged campaign's spend), uzoshop's tt_spend_cad reduced accordingly.

- [ ] **Step 5: Update memory**

In `~/.claude/projects/-Users-dorperetz-script-roas/memory/MEMORY.md`, replace the rolled-back entry with the v2 SHIPPED entry:

```markdown
- [Phase A.5 v2 SHIPPED 2026-05-29](project_phase_a5_v2_shipped.md) — TikTok campaign↔store mapping in CampaignDrawer (drawer-based UI). DELETE-then-UPSERT in persistCampaignsLive + cronDaily prevents duplicate campaigns_daily/ads_daily rows. All 9 v1 bugs prevented + tested. HEAD `<final commit SHA>`.
```

Create `project_phase_a5_v2_shipped.md` with:
- Final commit list from this plan
- The 9-bug verification checklist with ✅ on each
- The DB cleanup state (no leftover duplicates)
- Links to the v1 rolled-back memory + spec + plan

---

## Acceptance summary (Phase A.5 v2 complete when)

1. ✅ All 9 bugs from v1 prevented (verification table at top of plan)
2. ✅ Tests: ~14 new (Tasks 2 + 3 + 4 + 6 + 7) + existing 1383 baseline still green
3. ✅ tsc + build clean
4. ✅ Production deploy live; `/api/health` 200
5. ✅ Drawer dropdown enabled + functional for TikTok campaigns
6. ✅ Product picker shows effective store's products + correct label
7. ✅ ≤30 min after tag: campaigns_daily has exactly one row per `(date, platform, campaign_id, ad_set_id)` for the tagged campaign (under the new store_id)
8. ✅ data_daily.tt_spend_cad correctly reflects per-store attribution after the agg RPC
9. ✅ User Manual 2.1.18 + Architecture §25.11 v2 published
10. ✅ MEMORY.md updated; old v1 rolled-back entry replaced by v2 SHIPPED entry
