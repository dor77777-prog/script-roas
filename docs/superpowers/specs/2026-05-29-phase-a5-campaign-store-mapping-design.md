# Phase A.5 — Campaign↔Store mapping for shared-advertiser platforms

**Date:** 2026-05-29
**Status:** Approved (awaiting plan)
**Slots between:** Phase A (foundation) and Phase B (registries + workers) of the freshness redesign
**Parent spec:** [`2026-05-29-freshness-contract-incremental-sync-design.md`](2026-05-29-freshness-contract-incremental-sync-design.md)

## Problem

The current data model assumes **one ad account == one store**. Per the codebase: `STORES_WITH_TIKTOK = new Set(['uzoshop'])` — the TikTok fetcher only runs for uzoshop, and all rows from the uzoshop TikTok advertiser flow into the `(store_id='uzoshop')` bucket regardless of which pixel the campaign targets.

In reality, **one TikTok advertiser runs campaigns for multiple stores** (uzoshop + usmile360). The operator selects the appropriate Shopify pixel when creating each campaign — so each TikTok campaign is naturally "owned" by one store, but the data model doesn't reflect this. Consequence: usmile's TikTok spend, revenue, and ROAS are silently bucketed under uzoshop. The dashboard's per-store views are wrong for any tab driven by `data_daily.tt_*` or `campaigns_daily WHERE platform='tiktok' AND store_id='uzoshop'`.

## Goals

1. Operator can tag each TikTok campaign with its target `store_id` via a dropdown in CampaignsTable.
2. Going forward, TikTok rows in `campaigns_daily` / `ads_daily` / `data_daily` are written under the correctly tagged store.
3. Unmapped TikTok campaigns fall back to a per-platform default store (uzoshop, to preserve current behavior).
4. The mapping mechanism is generic enough to apply to any shared-advertiser platform in the future (Meta, Google) without schema change.

## Non-goals

- Historical re-attribution. All TikTok rows up to the deploy date stay under uzoshop. /operator gains a one-line disclaimer chip explaining this.
- Automatic pixel-based detection. The operator's manual tagging is the canonical source of truth.
- Schema changes. Reuses `dashboard_state` JSONB (same pattern as `campaign-product-map`).
- Meta/Google application of the same model. They use 1:1 advertiser:store today; this mechanism is forward-compatible if that changes.

## Design

### 1. Storage — `dashboard_state[key='campaign-store-map']`

JSONB shape (string → string map):

```json
{
  "tiktok::1234567890123456789::987654321": "uzoshop",
  "tiktok::1234567890123456789::987654322": "usmile360",
  "tiktok::1234567890123456789::987654323": "uzoshop"
}
```

Key format: `<platform>::<advertiser_id>::<campaign_id>`. Composite to namespace across platforms + advertiser accounts (so a future second TikTok advertiser doesn't collide).

Same write pattern as `campaign-product-map`: cloud-synced via `pushCloudKey()`, local-first reads via `readCampaignStoreMap()`, mutations broadcast via the `roas-campaign-store-map-changed` window event.

### 2. New file — `dashboard-web/src/lib/campaignStoreMap.ts`

Mirror the structure of `campaignProductMap.ts`:

```typescript
import { pushCloudKey } from './cloudSync';

const STORAGE_KEY = 'roas-dashboard:campaign-store-map' as const;

export type CampaignStoreMap = Record<string, string>;

export function campaignStoreKey(
  platform: 'meta' | 'google' | 'tiktok',
  advertiserId: string,
  campaignId: string,
): string {
  return `${platform}::${advertiserId}::${campaignId}`;
}

export function readCampaignStoreMap(): CampaignStoreMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const clean: CampaignStoreMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string') clean[k] = v;
    }
    return clean;
  } catch {
    return {};
  }
}

export function writeCampaignStoreMap(map: CampaignStoreMap): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    window.dispatchEvent(new CustomEvent('roas-campaign-store-map-changed'));
    pushCloudKey(STORAGE_KEY, map, { immediate: true });
  } catch { /* quota / private mode — ignore */ }
}

export function resolveStoreForCampaign(
  map: CampaignStoreMap,
  platform: 'meta' | 'google' | 'tiktok',
  advertiserId: string,
  campaignId: string,
  defaultStoreId: string,
): string {
  return map[campaignStoreKey(platform, advertiserId, campaignId)] ?? defaultStoreId;
}
```

### 3. Server-side mapping reader

The Inngest fetchers need a server-side read path (Supabase, not localStorage). Add to `dashboard-web/src/lib/inngest/campaignStoreMap.ts`:

```typescript
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export async function loadCampaignStoreMapFromSupabase(): Promise<Record<string, string>> {
  try {
    const sb = getSupabaseAdmin();
    const { data } = await sb
      .from('dashboard_state')
      .select('value')
      .eq('key', 'campaign-store-map')
      .maybeSingle();
    if (!data?.value) return {};
    const parsed = data.value as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(([, v]) => typeof v === 'string')
    ) as Record<string, string>;
  } catch (e) {
    console.warn('[loadCampaignStoreMapFromSupabase] read failed:', e);
    return {};
  }
}
```

### 4. TikTok fetcher rewrite

Today (in `dashboard-web/src/lib/fetchers/tiktok.ts`):
- Fetch loops via `STORES_WITH_TIKTOK = new Set(['uzoshop'])`.
- Each fetch returns rows that include `campaign_id`; all rows attributed to the looping `storeId`.

After:
- Fetch ONCE per advertiser (today: `UZOSHOP_TIKTOK_ADVERTISER_ID` only).
- After receiving rows, attach a `store_id` field to each row via:
  ```typescript
  const storeMap = await loadCampaignStoreMapFromSupabase();
  for (const row of rows) {
    row.store_id = resolveStoreForCampaign(
      storeMap, 'tiktok', advertiserId, row.campaign_id, /* default */ 'uzoshop'
    );
  }
  ```
- Rows can now have `store_id` ∈ `{'uzoshop', 'usmile360', ...}` from a single advertiser fetch.

### 5. Persistence layer split

`persistCampaignsLive` in `dashboard-web/src/lib/inngest/persistCampaignsLive.ts` currently writes per `(date, store_id, platform, campaign_id, ad_set_id)`. The key already supports multi-store output — the only change needed is **stop assuming `storeId` is uniform**:

- Before: `await sb.from('campaigns_daily').upsert(rows.map(r => ({ store_id: storeId, ... })));`
- After: `await sb.from('campaigns_daily').upsert(rows.map(r => ({ store_id: r.store_id ?? storeId, ... })));`

(Use the row's `store_id` if present; fall back to the function-arg `storeId` for non-shared-advertiser platforms.)

Same change for `ads_daily`.

For `data_daily.tt_spend_cad`: cron-daily aggregates TikTok rows per `(date, store_id)`, summing spend across campaigns belonging to that store. Code path: after the per-campaign rows are written, recompute `tt_spend_cad` per `(date, store_id)` via SQL:

```sql
UPDATE data_daily dd
   SET tt_spend_cad = sub.s
  FROM (
    SELECT date, store_id, SUM(spend_cad) AS s
      FROM campaigns_daily
     WHERE date = '<DATE>' AND platform = 'tiktok'
     GROUP BY date, store_id
  ) sub
 WHERE dd.date = sub.date AND dd.store_id = sub.store_id;
```

### 6. CampaignsTable UI — "Store" column for TikTok rows

For TikTok rows (only), add a `Store` cell at the end of the row:

```
| Name | Configured | Effective | … | Spend | ROAS | Store           |
| ABC  | ACTIVE     | DELIVERING | … | $123  | 2.4  | uzoshop ▼      |
| DEF  | ACTIVE     | DELIVERING | … | $45   | 1.8  | (unmapped) ▼   |
```

- Default value: read from `readCampaignStoreMap()` keyed by `campaignStoreKey('tiktok', advertiserId, campaignId)`.
- If no entry: render as "(unmapped) ▼" with amber tint.
- Dropdown options: `uzoshop`, `Zol Plus`, `360usmile`, `(unmap)`.
- On change: `writeCampaignStoreMap({ ...current, [key]: newStoreId })`. Broadcasts the window event so other components refresh. Cloud-syncs immediately (matches `campaign-product-map` pattern — operator clicks Save, value goes to cloud before refresh).

For Meta / Google rows: no Store column (they're 1:1).

### 7. /operator disclaimer chip

Add a small chip near the freshness panel:

> "Historical TikTok rows (before YYYY-MM-DD) are all attributed to uzoshop — this is the legacy assumption from before per-campaign store mapping shipped. Use the Store column in CampaignsTable to tag campaigns going forward."

(Where YYYY-MM-DD is the Phase A.5 deploy date.)

### 8. Tests

- `campaignStoreMap.test.ts` — readMap parses JSONB, filters non-string values; resolveStoreForCampaign falls back to default when key missing; key format byte-correct.
- `loadCampaignStoreMapFromSupabase.test.ts` — reads from `dashboard_state`, handles null + bad JSON gracefully.
- `tiktokFetcherSplitsPerStore.test.ts` — mock TikTok response with 3 campaigns mapped to 3 different stores → fetcher returns rows with correctly-set `store_id`.
- `tiktokFetcherFallbackToUzoshop.test.ts` — unmapped campaign → row has `store_id='uzoshop'`.
- `persistCampaignsLiveUsesRowStoreId.test.ts` — rows with row-level `store_id` are upserted under that store, not the function-arg store.
- `dataDailyAggregatesTiktokPerStore.test.ts` — cron-daily's `tt_spend_cad` aggregation correctly splits per-store.
- `campaignsTableStoreColumnTikTok.dom.test.tsx` — Store dropdown renders for TikTok rows, NOT for Meta/Google rows; changing the dropdown calls writeCampaignStoreMap.

## File touchpoints

```
docs/superpowers/specs/
  2026-05-29-phase-a5-campaign-store-mapping-design.md   NEW (this file)

dashboard-web/src/lib/
  campaignStoreMap.ts                                     NEW (~75 lines)

dashboard-web/src/lib/inngest/
  campaignStoreMap.ts                                     NEW (~30 lines server-side reader)

dashboard-web/src/lib/fetchers/
  tiktok.ts                                               ~20 lines edit (single fetch + per-row store_id)

dashboard-web/src/lib/inngest/
  persistCampaignsLive.ts                                ~5 lines edit (row.store_id || storeId)

dashboard-web/src/inngest/functions/
  cronDaily.ts                                           ~15 lines edit (data_daily aggregation SQL)

dashboard-web/src/components/
  CampaignsTable.tsx                                     ~80 lines edit (Store column + dropdown for TikTok rows)

dashboard-web/src/lib/sheets.ts                          ~3 lines edit (add 'campaign-store-map' to ALLOWED_STATE_KEYS)

dashboard-web/src/app/operator/
  page.tsx                                               ~10 lines edit (disclaimer chip)

dashboard-web/src/lib/__tests__/
  campaignStoreMap.test.ts                               NEW (~80 lines)

dashboard-web/src/lib/inngest/__tests__/
  loadCampaignStoreMapFromSupabase.test.ts               NEW (~50 lines)

dashboard-web/src/lib/fetchers/__tests__/
  tiktokFetcherSplitsPerStore.test.ts                    NEW (~80 lines)
  tiktokFetcherFallbackToUzoshop.test.ts                 NEW (~50 lines)

dashboard-web/src/lib/inngest/__tests__/
  persistCampaignsLiveUsesRowStoreId.test.ts             NEW (~60 lines)

dashboard-web/src/inngest/functions/__tests__/
  dataDailyAggregatesTiktokPerStore.test.ts              NEW (~80 lines)

dashboard-web/src/components/__tests__/
  campaignsTableStoreColumnTikTok.dom.test.tsx           NEW (~120 lines)

docs/ROAS-Dashboard-User-Manual.md                       Bump 2.1.15 → 2.1.16 + Phase A.5 changelog
```

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Operator forgets to tag a new TikTok campaign | (Unmapped) chip is amber-tinted in CampaignsTable. A future enhancement (Phase B+) can fire a daily Sentry alert listing unmapped TikTok campaigns with active spend. Not in MVP. |
| Operator tags a campaign mid-day → `campaigns_daily.store_id` for earlier rows of that campaign stays at uzoshop until cron-daily rewrites | cron-daily re-fetches and rewrites yesterday's rows (per the parent spec's reconcile contract). Same-day rows correct themselves on the next cron-live-heavy tick after the tag. Document explicitly. |
| Future second TikTok advertiser collides with current one in key format | `campaignStoreKey` includes `advertiser_id`, so different advertisers' campaigns get distinct keys. Already namespaced. |
| `data_daily.tt_spend_cad` aggregation runs after individual rows are persisted → race if same Inngest function retries | cron-daily's aggregation runs inside the same `step.run('persist-batch')` as the per-row writes. Re-run is idempotent (UPDATE with WHERE produces same final value). |
| Historical disclaimer chip annoys operator after a year | Has an "X" close button that pushes a `dismissedAt` flag to localStorage. Chip suppressed for that browser. Re-shows on different machine — by design (new operator should see it). |
| Hot SQL queries (Phase C) need to know about this mapping | After Phase A.5, `campaign_registry.store_id` is the authoritative store for TikTok campaigns. Phase B's status discovery looks up the map and assigns accordingly. Phase C's hot SQL reads `campaign_registry.store_id` — no change needed at the SQL layer. |

## Out of scope

- Pixel-based auto-detection (revisit if operator finds manual tagging tedious after a month).
- Backfilling 6+ months of historical TikTok rows to the correct store (explicitly rejected — current values are not "wrong" historically, they're the pre-mapping aggregation).
- Applying the same mechanism to Meta or Google (today not needed; the mapping module is generic-keyed so it's a 1-line addition when needed).
- A bulk-tagger UI (operator drags multiple campaigns to a store). Not in MVP; each campaign gets its own dropdown.
- Reattribution of orders attributed to TikTok-paid via `orders_attribution.source='tiktok-paid'` — these are already store-scoped because the Shopify order is per-store. Orders never cross stores.

## Estimated effort

- 2-3 days focused work (~7 modified files + 7 new test files + 1 spec + UI work).
- Ships after Phase A and before Phase B starts.
- After Phase B, the mapping naturally extends to the registries (no rework).

## Acceptance

1. ✅ Operator can tag any TikTok campaign in CampaignsTable via Store dropdown.
2. ✅ A campaign tagged "usmile360" produces a `campaigns_daily` row with `store_id='usmile360'` from the next cron-live-heavy tick onward.
3. ✅ The `data_daily.tt_spend_cad` for usmile360 reflects the sum of `tt_spend` from campaigns tagged to usmile.
4. ✅ All 7 new tests pass + the ~1,320 baseline tests still pass.
5. ✅ /operator shows the historical disclaimer chip.
6. ✅ User Manual 2.1.16 published.
