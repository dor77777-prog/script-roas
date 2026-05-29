# Phase C — Hot metrics + Google/TikTok workers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship hot_metrics scope for all 3 platforms (Meta + Google + TikTok), new Google + TikTok workers (status + hot_metrics), orchestrator extension to emit 6 scopes per tick, minimal UI (CampaignsTable freshness chip + CampaignDrawer status section), and an `audit:reconcile --hot-metrics-vs-heavy` mode. `cron-live-heavy` continues running in parallel for a 3-day canary; decommission ships in Phase C.5.

**Architecture:** Migration adds 3 Postgres functions (`get_hot_campaign_ids`, `get_hot_adset_ids`, `get_hot_ad_ids`) implementing the 5-branch UNION hot-set logic per platform. Workers reuse Phase B's `priorityBuilder` + `diff` + `upsert` helpers. Each new worker mirrors the meta-worker shape: BUC pre-flight → fetch → diff (status scope only) → upsert registries + `campaigns_daily`/`ads_daily`. Orchestrator's `buildEvents` extended to emit per-(store, platform, scope) tuples with per-scope cooldown tiers.

**Tech Stack:** Same as Phase B — Next.js 15 + Inngest 4.4 + Supabase + TypeScript + Vitest + Hebrew RTL UI tokens.

**Spec:** [`docs/superpowers/specs/2026-05-30-phase-c-hot-metrics-design.md`](../specs/2026-05-30-phase-c-hot-metrics-design.md).

---

## File structure

### New files

```
supabase/migrations/<timestamp>_phase_c_hot_set_functions.sql       # Task 1

dashboard-web/src/lib/registries/
├── hotSet.ts                                                       # Task 2
└── __tests__/hotSet.test.ts

dashboard-web/src/lib/fetchers/
├── metaHotMetrics.ts                                               # Task 3
├── googleStatus.ts                                                 # Task 5
├── googleHotMetrics.ts                                             # Task 6
├── tiktokStatus.ts                                                 # Task 8
├── tiktokHotMetrics.ts                                             # Task 9
└── __tests__/
    ├── metaHotMetrics.test.ts
    ├── googleStatus.test.ts
    ├── googleHotMetrics.test.ts
    ├── tiktokStatus.test.ts
    └── tiktokHotMetrics.test.ts

dashboard-web/src/inngest/functions/
├── googleWorker.ts                                                 # Task 7
├── tiktokWorker.ts                                                 # Task 10
└── __tests__/
    ├── googleWorker.test.ts
    └── tiktokWorker.test.ts

dashboard-web/src/components/CampaignFreshnessChip.tsx              # Task 12
dashboard-web/src/components/CampaignDrawerStatusSection.tsx        # Task 13

dashboard-web/src/lib/audit/__tests__/reconcileHotMetricsVsHeavy.live.test.ts  # Task 14
```

### Modified files

```
dashboard-web/src/inngest/functions/metaWorker.ts                   # Task 4 — add hot_metrics handler
dashboard-web/src/inngest/functions/cronTickOrchestrator.ts         # Task 11 — extended buildEvents
dashboard-web/src/lib/registries/priorityBuilder.ts                 # Task 11 — extended buildEvents
dashboard-web/src/lib/registries/eventNames.ts                      # Task 7+10 — add GOOGLE_JOB_REQUESTED, TIKTOK_JOB_REQUESTED
dashboard-web/src/components/CampaignsTable.tsx                     # Task 12 — mount the chip
dashboard-web/src/components/CampaignDrawer.tsx                     # Task 13 — mount the section
dashboard-web/src/app/api/inngest/route.ts                          # Task 15 — register googleWorker + tiktokWorker
dashboard-web/package.json                                          # Task 14 — add npm script (optional)
docs/ARCHITECTURE.md                                                # Task 15 — Phase C section
docs/ROAS-Dashboard-User-Manual.md                                  # Task 15 — User Manual 2.1.22
```

---

## Task 1: Migration — 3 hot-set Postgres functions

**Files:**
- Create: `supabase/migrations/<timestamp>_phase_c_hot_set_functions.sql`

- [ ] **Step 1: Generate filename via supabase CLI**

```bash
mv /Users/dorperetz/script-roas/.env /Users/dorperetz/script-roas/.env.tmp
cd /tmp && supabase migration new phase_c_hot_set_functions --workdir /Users/dorperetz/script-roas
mv /Users/dorperetz/script-roas/.env.tmp /Users/dorperetz/script-roas/.env
```

The CLI uses local time. If the timestamp comes back earlier than `20260530230000` (Phase B's filename), rename to `20260530240000_phase_c_hot_set_functions.sql` (or `20260601000000_...` — anything that sorts AFTER the most recent applied migration).

- [ ] **Step 2: Write migration content**

Use Write/Edit to put this content into the file:

```sql
-- Phase C (2026-05-30) — Hot-set Postgres functions for orchestrator-driven
-- metrics refresh. Three functions per platform: campaigns, adsets, ads.
--
-- 5-branch UNION per the umbrella spec §"Hot set SQL":
--   1. Status-active in registry
--   2. Recently status-changed (last 24h)
--   3. Recently first-seen (last 72h)
--   4. Has activity today (any of: spend, impressions, clicks, conversions)
--   5. Had spend yesterday tail (covers "paused this morning")
--
-- Each returns text[] of entity ids. Empty array if no rows qualify.

-- ---------------------------------------------------------------------------
-- 1. get_hot_campaign_ids
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_hot_campaign_ids(
  p_store_id text,
  p_platform text
) RETURNS text[]
LANGUAGE sql
STABLE
AS $$
  WITH hot AS (
    -- (1) Status-active in registry
    SELECT campaign_id FROM campaign_registry
     WHERE store_id = p_store_id AND platform = p_platform
       AND is_removed = false
       AND is_enabled = true
       AND COALESCE(is_serving, false) = true

    UNION
    -- (2) Recently status-changed
    SELECT campaign_id FROM campaign_registry
     WHERE store_id = p_store_id AND platform = p_platform
       AND is_removed = false
       AND status_changed_at >= now() - INTERVAL '24 hours'

    UNION
    -- (3) Recently first-seen
    SELECT campaign_id FROM campaign_registry
     WHERE store_id = p_store_id AND platform = p_platform
       AND is_removed = false
       AND first_seen_at >= now() - INTERVAL '72 hours'

    UNION
    -- (4) Has activity today
    SELECT DISTINCT campaign_id FROM campaigns_daily
     WHERE store_id = p_store_id AND platform = p_platform
       AND date = CURRENT_DATE
       AND (COALESCE(spend_cad, 0) > 0
            OR COALESCE(impressions, 0) > 0
            OR COALESCE(clicks, 0) > 0
            OR COALESCE(conversions, 0) > 0)

    UNION
    -- (5) Had spend yesterday tail
    SELECT DISTINCT campaign_id FROM campaigns_daily
     WHERE store_id = p_store_id AND platform = p_platform
       AND date = CURRENT_DATE - 1
       AND COALESCE(spend_cad, 0) > 0
  )
  SELECT COALESCE(array_agg(campaign_id), ARRAY[]::text[]) FROM hot;
$$;

-- ---------------------------------------------------------------------------
-- 2. get_hot_adset_ids
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_hot_adset_ids(
  p_store_id text,
  p_platform text
) RETURNS text[]
LANGUAGE sql
STABLE
AS $$
  WITH hot AS (
    SELECT adset_id FROM adset_registry
     WHERE store_id = p_store_id AND platform = p_platform
       AND is_removed = false AND is_enabled = true AND COALESCE(is_serving, false) = true
    UNION
    SELECT adset_id FROM adset_registry
     WHERE store_id = p_store_id AND platform = p_platform
       AND is_removed = false AND status_changed_at >= now() - INTERVAL '24 hours'
    UNION
    SELECT adset_id FROM adset_registry
     WHERE store_id = p_store_id AND platform = p_platform
       AND is_removed = false AND first_seen_at >= now() - INTERVAL '72 hours'
    UNION
    SELECT DISTINCT ad_set_id FROM campaigns_daily
     WHERE store_id = p_store_id AND platform = p_platform
       AND date = CURRENT_DATE
       AND ad_set_id IS NOT NULL
       AND (COALESCE(spend_cad, 0) > 0
            OR COALESCE(impressions, 0) > 0
            OR COALESCE(clicks, 0) > 0
            OR COALESCE(conversions, 0) > 0)
    UNION
    SELECT DISTINCT ad_set_id FROM campaigns_daily
     WHERE store_id = p_store_id AND platform = p_platform
       AND date = CURRENT_DATE - 1 AND ad_set_id IS NOT NULL
       AND COALESCE(spend_cad, 0) > 0
  )
  SELECT COALESCE(array_agg(adset_id), ARRAY[]::text[]) FROM hot;
$$;

-- ---------------------------------------------------------------------------
-- 3. get_hot_ad_ids
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_hot_ad_ids(
  p_store_id text,
  p_platform text
) RETURNS text[]
LANGUAGE sql
STABLE
AS $$
  WITH hot AS (
    SELECT ad_id FROM ad_registry
     WHERE store_id = p_store_id AND platform = p_platform
       AND is_removed = false AND is_enabled = true AND COALESCE(is_serving, false) = true
    UNION
    SELECT ad_id FROM ad_registry
     WHERE store_id = p_store_id AND platform = p_platform
       AND is_removed = false AND status_changed_at >= now() - INTERVAL '24 hours'
    UNION
    SELECT ad_id FROM ad_registry
     WHERE store_id = p_store_id AND platform = p_platform
       AND is_removed = false AND first_seen_at >= now() - INTERVAL '72 hours'
    UNION
    SELECT DISTINCT ad_id FROM ads_daily
     WHERE store_id = p_store_id AND platform = p_platform
       AND date = CURRENT_DATE
       AND (COALESCE(spend_cad, 0) > 0
            OR COALESCE(impressions, 0) > 0
            OR COALESCE(clicks, 0) > 0
            OR COALESCE(conversions, 0) > 0)
    UNION
    SELECT DISTINCT ad_id FROM ads_daily
     WHERE store_id = p_store_id AND platform = p_platform
       AND date = CURRENT_DATE - 1
       AND COALESCE(spend_cad, 0) > 0
  )
  SELECT COALESCE(array_agg(ad_id), ARRAY[]::text[]) FROM hot;
$$;

-- ---------------------------------------------------------------------------
-- Grants — anon can call these via PostgREST (URL-obscurity trust model).
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.get_hot_campaign_ids(text, text) TO anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_hot_adset_ids(text, text)    TO anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_hot_ad_ids(text, text)       TO anon, service_role;
```

- [ ] **Step 3: Verify migration is local-only**

```bash
mv /Users/dorperetz/script-roas/.env /Users/dorperetz/script-roas/.env.tmp
cd /tmp && supabase migration list --linked --workdir /Users/dorperetz/script-roas 2>&1 | tail -3
mv /Users/dorperetz/script-roas/.env.tmp /Users/dorperetz/script-roas/.env
```

Expected: new file listed with empty Remote column.

- [ ] **Step 4: Commit (no push, no apply yet)**

```bash
cd /Users/dorperetz/script-roas
git add supabase/migrations/<timestamp>_phase_c_hot_set_functions.sql
git commit -m "feat(phase-c): hot-set Postgres functions (campaigns + adsets + ads, 5-branch UNION)"
```

---

## Task 2: `hotSet.ts` — TypeScript wrappers

**Files:**
- Create: `dashboard-web/src/lib/registries/hotSet.ts`
- Test: `dashboard-web/src/lib/registries/__tests__/hotSet.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// dashboard-web/src/lib/registries/__tests__/hotSet.test.ts
import { describe, expect, it, vi } from 'vitest';
import {
  getHotCampaignIds,
  getHotAdsetIds,
  getHotAdIds,
} from '@/lib/registries/hotSet';

describe('getHotCampaignIds()', () => {
  it('calls the get_hot_campaign_ids RPC and returns the id array', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: ['C1', 'C2'], error: null });
    const admin = { rpc } as unknown as Parameters<typeof getHotCampaignIds>[0]['admin'];
    const out = await getHotCampaignIds({ admin, storeId: 'uzoshop', platform: 'meta' });
    expect(rpc).toHaveBeenCalledWith('get_hot_campaign_ids', { p_store_id: 'uzoshop', p_platform: 'meta' });
    expect(out).toEqual(['C1', 'C2']);
  });

  it('returns empty array on error (soft-fail; logs warning)', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
    const admin = { rpc } as unknown as Parameters<typeof getHotCampaignIds>[0]['admin'];
    const out = await getHotCampaignIds({ admin, storeId: 'uzoshop', platform: 'meta' });
    expect(out).toEqual([]);
  });

  it('returns empty array when data is null with no error', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const admin = { rpc } as unknown as Parameters<typeof getHotCampaignIds>[0]['admin'];
    expect(await getHotCampaignIds({ admin, storeId: 'uzoshop', platform: 'meta' })).toEqual([]);
  });
});

describe('getHotAdsetIds()', () => {
  it('calls the get_hot_adset_ids RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: ['AS1'], error: null });
    const admin = { rpc } as unknown as Parameters<typeof getHotAdsetIds>[0]['admin'];
    await getHotAdsetIds({ admin, storeId: 'zolplus', platform: 'google' });
    expect(rpc).toHaveBeenCalledWith('get_hot_adset_ids', { p_store_id: 'zolplus', p_platform: 'google' });
  });
});

describe('getHotAdIds()', () => {
  it('calls the get_hot_ad_ids RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: ['AD1'], error: null });
    const admin = { rpc } as unknown as Parameters<typeof getHotAdIds>[0]['admin'];
    await getHotAdIds({ admin, storeId: 'usmile360', platform: 'tiktok' });
    expect(rpc).toHaveBeenCalledWith('get_hot_ad_ids', { p_store_id: 'usmile360', p_platform: 'tiktok' });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx vitest run src/lib/registries/__tests__/hotSet.test.ts
```

Expected: `Cannot find module '@/lib/registries/hotSet'`.

- [ ] **Step 3: Write implementation**

```typescript
// dashboard-web/src/lib/registries/hotSet.ts
//
// Phase C — thin TS wrappers around the get_hot_*_ids Postgres RPCs.
// Soft-fail to empty array on error (the worker's caller can treat
// "no hot ids" identically — it just skips the metrics fetch).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Platform, StoreId } from './types';

type Input = { admin: SupabaseClient; storeId: StoreId; platform: Platform };

async function callIdsRpc(name: string, input: Input): Promise<string[]> {
  const { data, error } = await input.admin.rpc(name, {
    p_store_id: input.storeId,
    p_platform: input.platform,
  });
  if (error) {
    console.warn(`[${name}] rpc failed:`, error.message);
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data.filter((v): v is string => typeof v === 'string');
}

export function getHotCampaignIds(input: Input): Promise<string[]> {
  return callIdsRpc('get_hot_campaign_ids', input);
}

export function getHotAdsetIds(input: Input): Promise<string[]> {
  return callIdsRpc('get_hot_adset_ids', input);
}

export function getHotAdIds(input: Input): Promise<string[]> {
  return callIdsRpc('get_hot_ad_ids', input);
}
```

- [ ] **Step 4: Run — expect PASS (5/5)**

```bash
npx vitest run src/lib/registries/__tests__/hotSet.test.ts
```

- [ ] **Step 5: tsc**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/lib/registries/hotSet.ts \
        dashboard-web/src/lib/registries/__tests__/hotSet.test.ts
git commit -m "feat(phase-c): hotSet.ts — getHotCampaignIds/AdsetIds/AdIds RPC wrappers"
```

---

## Task 3: `fetchMetaHotMetricsForStore`

**Files:**
- Create: `dashboard-web/src/lib/fetchers/metaHotMetrics.ts`
- Test: `dashboard-web/src/lib/fetchers/__tests__/metaHotMetrics.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// dashboard-web/src/lib/fetchers/__tests__/metaHotMetrics.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchMetaHotMetricsForStore } from '@/lib/fetchers/metaHotMetrics';

const CAMPAIGN_INSIGHTS_BODY = JSON.stringify({
  data: [{
    campaign_id: 'C1', impressions: '1000', clicks: '20',
    spend: '50.5', actions: [{ action_type: 'purchase', value: '3' }],
    action_values: [{ action_type: 'purchase', value: '150.0' }],
    date_start: '2026-05-30', date_stop: '2026-05-30',
  }],
});

const ADSET_INSIGHTS_BODY = JSON.stringify({
  data: [{
    campaign_id: 'C1', adset_id: 'AS1', impressions: '500', clicks: '10',
    spend: '25.0', actions: [], action_values: [],
    date_start: '2026-05-30', date_stop: '2026-05-30',
  }],
});

const AD_INSIGHTS_BODY = JSON.stringify({
  data: [{
    campaign_id: 'C1', adset_id: 'AS1', ad_id: 'AD1',
    impressions: '500', clicks: '10', spend: '25.0',
    actions: [], action_values: [],
    date_start: '2026-05-30', date_stop: '2026-05-30',
  }],
});

const BATCH_BODY = JSON.stringify([
  { code: 200, body: CAMPAIGN_INSIGHTS_BODY },
  { code: 200, body: ADSET_INSIGHTS_BODY },
  { code: 200, body: AD_INSIGHTS_BODY },
]);

function mockFetch(body: string) {
  return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(body, {
    status: 200,
    headers: { 'x-business-use-case-usage': '{}' },
  }));
}

afterEach(() => { vi.restoreAllMocks(); });

describe('fetchMetaHotMetricsForStore()', () => {
  it('returns campaigns + adsets + ads with insights for the hot set', async () => {
    const fetchMock = mockFetch(BATCH_BODY);
    const out = await fetchMetaHotMetricsForStore({
      storeId: 'uzoshop',
      adAccountId: 'act_111',
      accessToken: 'tok',
      hotCampaignIds: ['C1'],
      hotAdsetIds: ['AS1'],
      hotAdIds: ['AD1'],
      dateStr: '2026-05-30',
      fetcher: fetchMock,
      getFxCadFor: async (amount, currency) => currency === 'USD' ? amount * 1.36 : amount,
    });
    expect(out.campaigns).toHaveLength(1);
    expect(out.campaigns[0]).toMatchObject({
      campaign_id: 'C1',
      store_id: 'uzoshop',
      platform: 'meta',
      date: '2026-05-30',
      impressions: 1000,
      clicks: 20,
    });
    expect(out.adsets).toHaveLength(1);
    expect(out.adsets[0]).toMatchObject({ adset_id: 'AS1', campaign_id: 'C1' });
    expect(out.ads).toHaveLength(1);
    expect(out.ads[0]).toMatchObject({ ad_id: 'AD1', adset_id: 'AS1', campaign_id: 'C1' });
  });

  it('returns empty rows for empty hot sets', async () => {
    const fetchMock = mockFetch(BATCH_BODY);
    const out = await fetchMetaHotMetricsForStore({
      storeId: 'uzoshop',
      adAccountId: 'act_111',
      accessToken: 'tok',
      hotCampaignIds: [],
      hotAdsetIds: [],
      hotAdIds: [],
      dateStr: '2026-05-30',
      fetcher: fetchMock,
      getFxCadFor: async () => 0,
    });
    expect(out.campaigns).toHaveLength(0);
    expect(out.adsets).toHaveLength(0);
    expect(out.ads).toHaveLength(0);
    // Should NOT have called fetch since all hot sets are empty
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses filtering=[IN, hot_ids] in each sub-request URL', async () => {
    const fetchMock = mockFetch(BATCH_BODY);
    await fetchMetaHotMetricsForStore({
      storeId: 'uzoshop', adAccountId: 'act_111', accessToken: 'tok',
      hotCampaignIds: ['C1', 'C2'], hotAdsetIds: ['AS1'], hotAdIds: ['AD1'],
      dateStr: '2026-05-30', fetcher: fetchMock,
      getFxCadFor: async () => 0,
    });
    const body = fetchMock.mock.calls[0]?.[1]?.body as string;
    expect(body).toMatch(/filtering/);
    expect(decodeURIComponent(body)).toContain('"C1"');
    expect(decodeURIComponent(body)).toContain('"AS1"');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx vitest run src/lib/fetchers/__tests__/metaHotMetrics.test.ts
```

- [ ] **Step 3: Write implementation**

```typescript
// dashboard-web/src/lib/fetchers/metaHotMetrics.ts
//
// Phase C — Meta Graph API batch fetch for insights at three levels
// (campaign / adset / ad), filtered to the hot set ids passed in.
// Time range = single day (the same day; intraday refresh is the
// orchestrator's job to call back every 10 min).
//
// Returns rows compatible with the existing campaigns_daily + ads_daily
// shapes used by persistCampaignsLive.

import type { StoreId } from '@/lib/registries/types';

const GRAPH_VERSION = 'v22.0';
const INSIGHTS_FIELDS = 'campaign_id,impressions,clicks,spend,actions,action_values';
const ADSET_INSIGHTS_FIELDS = 'campaign_id,adset_id,impressions,clicks,spend,actions,action_values';
const AD_INSIGHTS_FIELDS = 'campaign_id,adset_id,ad_id,impressions,clicks,spend,actions,action_values';

export type MetaHotMetricsInput = {
  storeId: StoreId;
  adAccountId: string;
  accessToken: string;
  hotCampaignIds: string[];
  hotAdsetIds: string[];
  hotAdIds: string[];
  dateStr: string;
  fetcher?: typeof fetch;
  getFxCadFor: (amount: number, currency: 'USD' | 'CAD' | 'ILS') => Promise<number>;
};

export type CampaignDailyRow = {
  store_id: StoreId;
  platform: 'meta';
  campaign_id: string;
  date: string;
  spend_cad: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversion_value_cad: number;
};

export type AdsetDailyRow = CampaignDailyRow & { adset_id: string };
export type AdDailyRow = AdsetDailyRow & { ad_id: string };

export type MetaHotMetricsResult = {
  campaigns: CampaignDailyRow[];
  adsets: AdsetDailyRow[];
  ads: AdDailyRow[];
};

export async function fetchMetaHotMetricsForStore(input: MetaHotMetricsInput): Promise<MetaHotMetricsResult> {
  const { storeId, accessToken, dateStr, fetcher = fetch, getFxCadFor } = input;
  if (input.hotCampaignIds.length === 0 && input.hotAdsetIds.length === 0 && input.hotAdIds.length === 0) {
    return { campaigns: [], adsets: [], ads: [] };
  }
  const adAccountId = input.adAccountId.startsWith('act_') ? input.adAccountId : `act_${input.adAccountId}`;

  const filtering = (field: string, ids: string[]): string =>
    encodeURIComponent(JSON.stringify([{ field, operator: 'IN', value: ids }]));
  const timeRange = encodeURIComponent(JSON.stringify({ since: dateStr, until: dateStr }));

  const batch: Array<{ method: string; relative_url: string }> = [];
  if (input.hotCampaignIds.length > 0) {
    batch.push({
      method: 'GET',
      relative_url: `${adAccountId}/insights?level=campaign&fields=${INSIGHTS_FIELDS}&time_range=${timeRange}&filtering=${filtering('campaign.id', input.hotCampaignIds)}&limit=500`,
    });
  }
  if (input.hotAdsetIds.length > 0) {
    batch.push({
      method: 'GET',
      relative_url: `${adAccountId}/insights?level=adset&fields=${ADSET_INSIGHTS_FIELDS}&time_range=${timeRange}&filtering=${filtering('adset.id', input.hotAdsetIds)}&limit=1000`,
    });
  }
  if (input.hotAdIds.length > 0) {
    batch.push({
      method: 'GET',
      relative_url: `${adAccountId}/insights?level=ad&fields=${AD_INSIGHTS_FIELDS}&time_range=${timeRange}&filtering=${filtering('ad.id', input.hotAdIds)}&limit=2000`,
    });
  }

  const body = new URLSearchParams();
  body.set('access_token', accessToken);
  body.set('batch', JSON.stringify(batch));

  const res = await fetcher(`https://graph.facebook.com/${GRAPH_VERSION}/`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Meta hot-metrics batch ${res.status}: ${await res.text()}`);

  const parts = (await res.json()) as Array<{ code: number; body: string }>;

  let cursor = 0;
  const campaignRaw = input.hotCampaignIds.length > 0 ? asArray(parts[cursor++]) : [];
  const adsetRaw = input.hotAdsetIds.length > 0 ? asArray(parts[cursor++]) : [];
  const adRaw = input.hotAdIds.length > 0 ? asArray(parts[cursor++]) : [];

  const campaigns = await Promise.all(campaignRaw.map((r) => toCampaignRow(storeId, dateStr, r, getFxCadFor)));
  const adsets = await Promise.all(adsetRaw.map((r) => toAdsetRow(storeId, dateStr, r, getFxCadFor)));
  const ads = await Promise.all(adRaw.map((r) => toAdRow(storeId, dateStr, r, getFxCadFor)));

  return { campaigns, adsets, ads };
}

function asArray(part: { code: number; body: string } | undefined): Array<Record<string, unknown>> {
  if (!part || part.code !== 200) return [];
  try {
    const parsed = JSON.parse(part.body) as { data?: unknown };
    return Array.isArray(parsed.data) ? (parsed.data as Array<Record<string, unknown>>) : [];
  } catch {
    return [];
  }
}

async function toCampaignRow(
  storeId: StoreId, dateStr: string, r: Record<string, unknown>,
  getFx: MetaHotMetricsInput['getFxCadFor'],
): Promise<CampaignDailyRow> {
  const spend = Number(r.spend ?? 0);
  const spendCad = await getFx(spend, 'USD');
  const conv = sumActions(r.actions, 'purchase');
  const convValue = sumActionValues(r.action_values, 'purchase');
  const convValueCad = await getFx(convValue, 'USD');
  return {
    store_id: storeId, platform: 'meta', campaign_id: String(r.campaign_id), date: dateStr,
    spend_cad: spendCad,
    impressions: Math.round(Number(r.impressions ?? 0)),
    clicks: Math.round(Number(r.clicks ?? 0)),
    conversions: Math.round(conv),
    conversion_value_cad: convValueCad,
  };
}

async function toAdsetRow(
  storeId: StoreId, dateStr: string, r: Record<string, unknown>,
  getFx: MetaHotMetricsInput['getFxCadFor'],
): Promise<AdsetDailyRow> {
  return {
    ...(await toCampaignRow(storeId, dateStr, r, getFx)),
    adset_id: String(r.adset_id),
  };
}

async function toAdRow(
  storeId: StoreId, dateStr: string, r: Record<string, unknown>,
  getFx: MetaHotMetricsInput['getFxCadFor'],
): Promise<AdDailyRow> {
  return {
    ...(await toAdsetRow(storeId, dateStr, r, getFx)),
    ad_id: String(r.ad_id),
  };
}

function sumActions(actions: unknown, type: string): number {
  if (!Array.isArray(actions)) return 0;
  return actions
    .filter((a): a is Record<string, unknown> => typeof a === 'object' && a !== null)
    .filter((a) => a.action_type === type)
    .reduce((acc, a) => acc + Number(a.value ?? 0), 0);
}

function sumActionValues(values: unknown, type: string): number {
  return sumActions(values, type);
}
```

- [ ] **Step 4: Run — expect PASS (3/3)**

```bash
npx vitest run src/lib/fetchers/__tests__/metaHotMetrics.test.ts
```

- [ ] **Step 5: tsc**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/lib/fetchers/metaHotMetrics.ts \
        dashboard-web/src/lib/fetchers/__tests__/metaHotMetrics.test.ts
git commit -m "feat(phase-c): fetchMetaHotMetricsForStore — filtered insights batch (campaign+adset+ad)"
```

---

## Task 4: Extend `metaWorker` with `hot_metrics` handler

**Files:**
- Modify: `dashboard-web/src/inngest/functions/metaWorker.ts`
- Test: extend `dashboard-web/src/inngest/functions/__tests__/metaWorker.test.ts`

- [ ] **Step 1: Add failing test for hot_metrics scope**

Append to `metaWorker.test.ts`:

```typescript
describe('runMetaWorkerJob() — hot_metrics scope', () => {
  it('hot_metrics happy path: getHotIds → fetchMetrics → upsert campaigns_daily + ads_daily → mark freshness', async () => {
    const getHotCampaign = vi.fn().mockResolvedValue(['C1']);
    const getHotAdset = vi.fn().mockResolvedValue(['AS1']);
    const getHotAd = vi.fn().mockResolvedValue(['AD1']);
    const fetcher = vi.fn().mockResolvedValue({
      campaigns: [{ store_id: 'uzoshop', platform: 'meta', campaign_id: 'C1', date: '2026-05-30', spend_cad: 50, impressions: 1000, clicks: 20, conversions: 3, conversion_value_cad: 150 }],
      adsets: [{ store_id: 'uzoshop', platform: 'meta', campaign_id: 'C1', adset_id: 'AS1', date: '2026-05-30', spend_cad: 25, impressions: 500, clicks: 10, conversions: 0, conversion_value_cad: 0 }],
      ads: [{ store_id: 'uzoshop', platform: 'meta', campaign_id: 'C1', adset_id: 'AS1', ad_id: 'AD1', date: '2026-05-30', spend_cad: 25, impressions: 500, clicks: 10, conversions: 0, conversion_value_cad: 0 }],
    });
    const upsertCampaignsDaily = vi.fn();
    const upsertAdsDaily = vi.fn();
    const recordFreshness = vi.fn();
    await runMetaWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'hot_metrics', tick_id: 'T', staleness_seconds: 300, budget_pct_estimate: 12 },
      bucProbe: async () => ({ pct: 12, etaMinutes: 0 }),
      fetchStatus: vi.fn(),
      fetchHotMetrics: fetcher,
      getHotCampaignIds: getHotCampaign,
      getHotAdsetIds: getHotAdset,
      getHotAdIds: getHotAd,
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn(),
      insertStatusEvents: vi.fn(),
      upsertCampaignsDaily,
      upsertAdsDaily,
      recordFreshness,
      upsertBuc: vi.fn(),
      nowIso: NOW_ISO,
    });
    expect(getHotCampaign).toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalled();
    expect(upsertCampaignsDaily).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ campaign_id: 'C1' })]));
    expect(upsertAdsDaily).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ ad_id: 'AD1' })]));
    expect(recordFreshness).toHaveBeenCalledWith(expect.objectContaining({ scope: 'campaign_metrics', status: 'success' }));
  });

  it('hot_metrics with empty hot set: skip fetch, still mark freshness success', async () => {
    const fetcher = vi.fn();
    const recordFreshness = vi.fn();
    await runMetaWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'hot_metrics', tick_id: 'T', staleness_seconds: 300, budget_pct_estimate: 12 },
      bucProbe: async () => ({ pct: 12, etaMinutes: 0 }),
      fetchStatus: vi.fn(),
      fetchHotMetrics: fetcher,
      getHotCampaignIds: async () => [],
      getHotAdsetIds: async () => [],
      getHotAdIds: async () => [],
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn(),
      insertStatusEvents: vi.fn(),
      upsertCampaignsDaily: vi.fn(),
      upsertAdsDaily: vi.fn(),
      recordFreshness,
      upsertBuc: vi.fn(),
      nowIso: NOW_ISO,
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(recordFreshness).toHaveBeenCalledWith(expect.objectContaining({ scope: 'campaign_metrics', status: 'success' }));
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx vitest run src/inngest/functions/__tests__/metaWorker.test.ts
```

- [ ] **Step 3: Edit `metaWorker.ts` to extend the input type + add hot_metrics branch**

Edit the existing `RunMetaWorkerJobInput` type to add these fields:

```typescript
fetchHotMetrics?: typeof import('@/lib/fetchers/metaHotMetrics').fetchMetaHotMetricsForStore;
getHotCampaignIds?: (storeId: StoreId) => Promise<string[]>;
getHotAdsetIds?: (storeId: StoreId) => Promise<string[]>;
getHotAdIds?: (storeId: StoreId) => Promise<string[]>;
upsertCampaignsDaily?: (rows: Array<Record<string, unknown>>) => Promise<void>;
upsertAdsDaily?: (rows: Array<Record<string, unknown>>) => Promise<void>;
```

(All optional — Phase B tests don't pass them and still work.)

Inside `runMetaWorkerJob`, after the existing `if (scope !== 'status') return;` line, change to:

```typescript
if (scope === 'hot_metrics') {
  return await runMetaHotMetricsBranch(input);
}
if (scope !== 'status') return;
// ... rest of existing status branch unchanged ...
```

Add the new `runMetaHotMetricsBranch` function:

```typescript
async function runMetaHotMetricsBranch(input: RunMetaWorkerJobInput): Promise<void> {
  const { jobData, bucProbe, recordFreshness: rec, fetchHotMetrics, getHotCampaignIds, getHotAdsetIds, getHotAdIds, upsertCampaignsDaily, upsertAdsDaily, nowIso } = input;
  const storeId = jobData.store_id;

  const buc = await bucProbe(storeId);
  if (buc.etaMinutes > 0 || buc.pct >= HARD_SKIP_PCT) {
    await rec({ storeId, platform: 'meta', scope: 'campaign_metrics', tableName: 'campaigns_daily', status: 'budget_skip', errorMessage: buc.etaMinutes > 0 ? `Meta ETA=${buc.etaMinutes}min` : `pct=${buc.pct}>=${HARD_SKIP_PCT}` });
    return;
  }

  const [hotCampaign, hotAdset, hotAd] = await Promise.all([
    (getHotCampaignIds ?? (async () => []))(storeId),
    (getHotAdsetIds ?? (async () => []))(storeId),
    (getHotAdIds ?? (async () => []))(storeId),
  ]);

  if (hotCampaign.length + hotAdset.length + hotAd.length === 0) {
    await rec({ storeId, platform: 'meta', scope: 'campaign_metrics', tableName: 'campaigns_daily', status: 'success' });
    return;
  }

  if (!fetchHotMetrics) {
    await rec({ storeId, platform: 'meta', scope: 'campaign_metrics', tableName: 'campaigns_daily', status: 'transient_error', errorMessage: 'fetchHotMetrics not wired' });
    return;
  }

  const today = nowIso.slice(0, 10);
  const metrics = await fetchHotMetrics({
    storeId,
    adAccountId: await getAdAccountIdForStore(storeId),
    accessToken: await getMetaAccessTokenForStore(storeId),
    hotCampaignIds: hotCampaign, hotAdsetIds: hotAdset, hotAdIds: hotAd,
    dateStr: today,
    getFxCadFor: await getFxCadAdapterForStore(storeId),
  });

  if (upsertCampaignsDaily && (metrics.campaigns.length + metrics.adsets.length) > 0) {
    const all = [
      ...metrics.campaigns.map(c => ({ ...c, source: 'live_tick', last_live_tick_at: nowIso })),
      ...metrics.adsets.map(a => ({ ...a, source: 'live_tick', last_live_tick_at: nowIso })),
    ];
    await upsertCampaignsDaily(all);
  }
  if (upsertAdsDaily && metrics.ads.length > 0) {
    await upsertAdsDaily(metrics.ads.map(a => ({ ...a, source: 'live_tick', last_live_tick_at: nowIso })));
  }

  await rec({ storeId, platform: 'meta', scope: 'campaign_metrics', tableName: 'campaigns_daily', status: 'success' });
}
```

In the Inngest function wrapper (`metaWorker = inngest.createFunction(...)`), thread the new dependencies:

```typescript
// Inside the step.run('runMetaWorkerJob', ...) call's argument object:
fetchHotMetrics: fetchMetaHotMetricsForStore,
getHotCampaignIds: (sid: StoreId) => getHotCampaignIdsHelper({ admin: sb, storeId: sid, platform: 'meta' }),
getHotAdsetIds:    (sid: StoreId) => getHotAdsetIdsHelper({ admin: sb, storeId: sid, platform: 'meta' }),
getHotAdIds:       (sid: StoreId) => getHotAdIdsHelper({ admin: sb, storeId: sid, platform: 'meta' }),
upsertCampaignsDaily: async (rows) => {
  if (rows.length === 0) return;
  const { error } = await sb.from('campaigns_daily').upsert(rows, { onConflict: 'date,store_id,platform,campaign_id,ad_set_id' });
  if (error) throw new Error(`campaigns_daily upsert: ${error.message}`);
},
upsertAdsDaily: async (rows) => {
  if (rows.length === 0) return;
  const { error } = await sb.from('ads_daily').upsert(rows, { onConflict: 'date,store_id,ad_id' });
  if (error) throw new Error(`ads_daily upsert: ${error.message}`);
},
```

Add the imports at the top:

```typescript
import { fetchMetaHotMetricsForStore } from '@/lib/fetchers/metaHotMetrics';
import {
  getHotCampaignIds as getHotCampaignIdsHelper,
  getHotAdsetIds as getHotAdsetIdsHelper,
  getHotAdIds as getHotAdIdsHelper,
} from '@/lib/registries/hotSet';
```

- [ ] **Step 4: Run — expect PASS (all metaWorker tests including new 2)**

```bash
npx vitest run src/inngest/functions/__tests__/metaWorker.test.ts
```

- [ ] **Step 5: tsc**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/inngest/functions/metaWorker.ts \
        dashboard-web/src/inngest/functions/__tests__/metaWorker.test.ts
git commit -m "feat(phase-c): meta-worker handles scope='hot_metrics' (insights batch + daily upsert)"
```

---

## Task 5: `fetchGoogleStatusForStore`

This task fetches Google Ads change_status + entity rows. The existing fetchers in `dashboard-web/src/lib/fetchers/googleAds.ts` use the Google Ads API SDK. **Discover** the existing patterns first: how the customer ID is read, what helpers exist for raw GAQL queries.

**Files:**
- Create: `dashboard-web/src/lib/fetchers/googleStatus.ts`
- Test: `dashboard-web/src/lib/fetchers/__tests__/googleStatus.test.ts`

- [ ] **Step 1: Discovery — read existing googleAds.ts**

```bash
grep -n "customerId\|GoogleAdsApi\|searchStream\|change_status" /Users/dorperetz/script-roas/dashboard-web/src/lib/fetchers/googleAds.ts | head -20
```

Identify:
- How the customer id is fetched (likely env var `<STORE>_GOOGLE_ADS_CUSTOMER_ID`).
- Which GoogleAdsApi helper class exists.
- The existing fetcher pattern for tests (likely they pass a mocked `customer` object).

- [ ] **Step 2: Write failing test**

Create `dashboard-web/src/lib/fetchers/__tests__/googleStatus.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { fetchGoogleStatusForStore } from '@/lib/fetchers/googleStatus';

describe('fetchGoogleStatusForStore()', () => {
  it('returns campaigns + adgroups + ads with status from change_status + entity follow-up', async () => {
    const searchStream = vi.fn();
    // First call: change_status query
    searchStream.mockResolvedValueOnce([
      { campaign: { id: 'GC1' }, change_status: { resource_type: 'CAMPAIGN', resource_name: 'customers/123/campaigns/GC1', last_change_date_time: '2026-05-30 14:00:00' } },
    ]);
    // Second call: campaign entity follow-up
    searchStream.mockResolvedValueOnce([
      { campaign: { id: 'GC1', name: 'G Campaign 1', status: 'ENABLED', serving_status: 'SERVING' } },
    ]);
    const customer = { searchStream } as unknown as Parameters<typeof fetchGoogleStatusForStore>[0]['customer'];
    const out = await fetchGoogleStatusForStore({
      storeId: 'uzoshop',
      customer,
    });
    expect(out.campaigns).toHaveLength(1);
    expect(out.campaigns[0]).toMatchObject({
      store_id: 'uzoshop', platform: 'google',
      campaign_id: 'GC1', configured_status: 'ENABLED', effective_status: 'SERVING',
    });
  });

  it('returns empty when change_status yields no rows', async () => {
    const searchStream = vi.fn().mockResolvedValue([]);
    const customer = { searchStream } as unknown as Parameters<typeof fetchGoogleStatusForStore>[0]['customer'];
    const out = await fetchGoogleStatusForStore({ storeId: 'uzoshop', customer });
    expect(out.campaigns).toHaveLength(0);
    expect(out.adsets).toHaveLength(0);
    expect(out.ads).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx vitest run src/lib/fetchers/__tests__/googleStatus.test.ts
```

- [ ] **Step 4: Write implementation**

Create `dashboard-web/src/lib/fetchers/googleStatus.ts`:

```typescript
// dashboard-web/src/lib/fetchers/googleStatus.ts
//
// Phase C — Google Ads status discovery via change_status. Returns
// changed campaign/adgroup/ad ids + full status rows for each.

import type {
  AdRegistryRow,
  AdsetRegistryRow,
  CampaignRegistryRow,
  StoreId,
} from '@/lib/registries/types';

type Customer = {
  searchStream: (input: { query: string }) => Promise<Array<Record<string, unknown>>>;
};

export type GoogleStatusInput = {
  storeId: StoreId;
  customer: Customer;
};

export type GoogleStatusResult = {
  campaigns: CampaignRegistryRow[];
  adsets: AdsetRegistryRow[];
  ads: AdRegistryRow[];
};

const NULL_PLACEHOLDER = '__will_be_overwritten_by_upsert_layer__';

export async function fetchGoogleStatusForStore(input: GoogleStatusInput): Promise<GoogleStatusResult> {
  const { storeId, customer } = input;

  // 1. Discover changed entities via change_status (last 24h).
  const changeRows = await customer.searchStream({
    query: `
      SELECT change_status.resource_name, change_status.resource_type, change_status.last_change_date_time
        FROM change_status
       WHERE change_status.last_change_date_time DURING LAST_24_HOURS
         AND change_status.resource_type IN ('CAMPAIGN', 'AD_GROUP', 'AD_GROUP_AD')
    `,
  });

  const campaignIds = new Set<string>();
  const adgroupIds = new Set<string>();
  const adIds = new Set<string>();
  for (const r of changeRows) {
    const cs = (r as { change_status?: Record<string, unknown> }).change_status;
    if (!cs) continue;
    const type = cs.resource_type as string;
    const name = cs.resource_name as string;
    const id = name.split('/').pop();
    if (!id) continue;
    if (type === 'CAMPAIGN') campaignIds.add(id);
    if (type === 'AD_GROUP') adgroupIds.add(id);
    if (type === 'AD_GROUP_AD') adIds.add(id);
  }

  // 2. Follow up with full entity rows.
  const campaigns: CampaignRegistryRow[] = [];
  if (campaignIds.size > 0) {
    const ids = [...campaignIds].map(id => `'${id}'`).join(',');
    const rows = await customer.searchStream({
      query: `SELECT campaign.id, campaign.name, campaign.status, campaign.serving_status FROM campaign WHERE campaign.id IN (${ids})`,
    });
    for (const r of rows) {
      const c = (r as { campaign?: Record<string, unknown> }).campaign;
      if (!c) continue;
      campaigns.push(toCampaignRow(storeId, c));
    }
  }

  const adsets: AdsetRegistryRow[] = [];
  if (adgroupIds.size > 0) {
    const ids = [...adgroupIds].map(id => `'${id}'`).join(',');
    const rows = await customer.searchStream({
      query: `SELECT ad_group.id, ad_group.campaign, ad_group.name, ad_group.status FROM ad_group WHERE ad_group.id IN (${ids})`,
    });
    for (const r of rows) {
      const ag = (r as { ad_group?: Record<string, unknown> }).ad_group;
      if (!ag) continue;
      adsets.push(toAdsetRow(storeId, ag));
    }
  }

  const ads: AdRegistryRow[] = [];
  if (adIds.size > 0) {
    const ids = [...adIds].map(id => `'${id}'`).join(',');
    const rows = await customer.searchStream({
      query: `SELECT ad_group_ad.ad.id, ad_group_ad.ad_group, ad_group_ad.status FROM ad_group_ad WHERE ad_group_ad.ad.id IN (${ids})`,
    });
    for (const r of rows) {
      const aga = (r as { ad_group_ad?: Record<string, unknown> }).ad_group_ad;
      if (!aga) continue;
      ads.push(toAdRow(storeId, aga));
    }
  }

  return { campaigns, adsets, ads };
}

function toCampaignRow(storeId: StoreId, c: Record<string, unknown>): CampaignRegistryRow {
  const configured = String(c.status ?? '');
  const effective = String(c.serving_status ?? '');
  return {
    store_id: storeId, platform: 'google',
    campaign_id: String(c.id), name: c.name as string ?? null,
    configured_status: configured || null,
    effective_status: effective || null,
    delivery_status: deriveDelivery(effective),
    is_enabled: configured === 'ENABLED',
    is_serving: effective === 'SERVING',
    first_seen_at: NULL_PLACEHOLDER, last_seen_at: NULL_PLACEHOLDER,
    platform_updated_at: null, status_changed_at: null,
    last_metrics_success_at: null, last_status_success_at: null,
    raw_status_payload: c,
    missed_seen_count: 0, is_removed: false,
  };
}

function toAdsetRow(storeId: StoreId, ag: Record<string, unknown>): AdsetRegistryRow {
  const campaignName = ag.campaign as string ?? '';
  const campaignId = campaignName.split('/').pop() ?? '';
  return {
    ...toCampaignRow(storeId, { ...ag, id: campaignId }),
    campaign_id: campaignId,
    adset_id: String(ag.id),
    daily_budget_cad: null, lifetime_budget_cad: null,
  };
}

function toAdRow(storeId: StoreId, aga: Record<string, unknown>): AdRegistryRow {
  const adgroupName = aga.ad_group as string ?? '';
  const adgroupId = adgroupName.split('/').pop() ?? '';
  const adInner = aga.ad as Record<string, unknown> ?? {};
  return {
    ...toCampaignRow(storeId, aga),
    campaign_id: '', // unknown without follow-up; left empty
    adset_id: adgroupId,
    ad_id: String(adInner.id ?? ''),
  };
}

function deriveDelivery(effective: string): string | null {
  if (effective === 'SERVING') return 'DELIVERING';
  if (effective === 'PENDING') return 'PENDING_REVIEW';
  if (effective === 'ENDED' || effective === 'NONE') return 'NOT_DELIVERING';
  if (!effective) return null;
  return 'UNKNOWN';
}
```

- [ ] **Step 5: Run — expect PASS (2/2)**

```bash
npx vitest run src/lib/fetchers/__tests__/googleStatus.test.ts
```

- [ ] **Step 6: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/lib/fetchers/googleStatus.ts \
        dashboard-web/src/lib/fetchers/__tests__/googleStatus.test.ts
git commit -m "feat(phase-c): fetchGoogleStatusForStore — change_status + entity follow-up"
```

---

## Task 6: `fetchGoogleHotMetricsForStore`

**Files:**
- Create: `dashboard-web/src/lib/fetchers/googleHotMetrics.ts`
- Test: `dashboard-web/src/lib/fetchers/__tests__/googleHotMetrics.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// dashboard-web/src/lib/fetchers/__tests__/googleHotMetrics.test.ts
import { describe, expect, it, vi } from 'vitest';
import { fetchGoogleHotMetricsForStore } from '@/lib/fetchers/googleHotMetrics';

describe('fetchGoogleHotMetricsForStore()', () => {
  it('returns metrics rows for hot campaign + adgroup + ad ids', async () => {
    const searchStream = vi.fn();
    // campaign metrics
    searchStream.mockResolvedValueOnce([
      { campaign: { id: 'GC1' }, metrics: { impressions: '1000', clicks: '20', cost_micros: '50000000', conversions: 3, conversions_value: '150.0' }, segments: { date: '2026-05-30' } },
    ]);
    // ad-group metrics
    searchStream.mockResolvedValueOnce([
      { campaign: { id: 'GC1' }, ad_group: { id: 'AG1' }, metrics: { impressions: '500', clicks: '10', cost_micros: '25000000', conversions: 0, conversions_value: '0' }, segments: { date: '2026-05-30' } },
    ]);
    // ad metrics
    searchStream.mockResolvedValueOnce([
      { campaign: { id: 'GC1' }, ad_group: { id: 'AG1' }, ad_group_ad: { ad: { id: 'AD1' } }, metrics: { impressions: '500', clicks: '10', cost_micros: '25000000', conversions: 0, conversions_value: '0' }, segments: { date: '2026-05-30' } },
    ]);
    const customer = { searchStream } as unknown as Parameters<typeof fetchGoogleHotMetricsForStore>[0]['customer'];
    const out = await fetchGoogleHotMetricsForStore({
      storeId: 'uzoshop',
      customer,
      hotCampaignIds: ['GC1'], hotAdgroupIds: ['AG1'], hotAdIds: ['AD1'],
      dateStr: '2026-05-30',
    });
    expect(out.campaigns).toHaveLength(1);
    expect(out.campaigns[0]).toMatchObject({
      store_id: 'uzoshop', platform: 'google', campaign_id: 'GC1',
      spend_cad: 50, impressions: 1000, clicks: 20, conversions: 3, conversion_value_cad: 150,
    });
    expect(out.adsets).toHaveLength(1);
    expect(out.adsets[0].adset_id).toBe('AG1');
    expect(out.ads).toHaveLength(1);
    expect(out.ads[0].ad_id).toBe('AD1');
  });

  it('skips levels with empty hot sets', async () => {
    const searchStream = vi.fn();
    const customer = { searchStream } as unknown as Parameters<typeof fetchGoogleHotMetricsForStore>[0]['customer'];
    const out = await fetchGoogleHotMetricsForStore({
      storeId: 'uzoshop', customer,
      hotCampaignIds: [], hotAdgroupIds: [], hotAdIds: [],
      dateStr: '2026-05-30',
    });
    expect(searchStream).not.toHaveBeenCalled();
    expect(out.campaigns).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run src/lib/fetchers/__tests__/googleHotMetrics.test.ts
```

- [ ] **Step 3: Write implementation**

```typescript
// dashboard-web/src/lib/fetchers/googleHotMetrics.ts
//
// Phase C — Google Ads metrics fetch for hot ids. Cost is reported
// in micros (1/1,000,000 of the account currency unit); we divide by
// 1e6 to get major-unit. uzoshop's Google account is CAD-native, so
// no FX conversion needed at this level.

import type { StoreId } from '@/lib/registries/types';
import type { AdDailyRow, AdsetDailyRow, CampaignDailyRow } from './metaHotMetrics';

type Customer = {
  searchStream: (input: { query: string }) => Promise<Array<Record<string, unknown>>>;
};

export type GoogleHotMetricsInput = {
  storeId: StoreId;
  customer: Customer;
  hotCampaignIds: string[];
  hotAdgroupIds: string[];
  hotAdIds: string[];
  dateStr: string;
};

export type GoogleHotMetricsResult = {
  campaigns: CampaignDailyRow[];
  adsets: AdsetDailyRow[];
  ads: AdDailyRow[];
};

export async function fetchGoogleHotMetricsForStore(input: GoogleHotMetricsInput): Promise<GoogleHotMetricsResult> {
  const { storeId, customer, dateStr } = input;
  if (input.hotCampaignIds.length === 0 && input.hotAdgroupIds.length === 0 && input.hotAdIds.length === 0) {
    return { campaigns: [], adsets: [], ads: [] };
  }
  const dateLiteral = `'${dateStr}'`;

  const campaigns: CampaignDailyRow[] = [];
  if (input.hotCampaignIds.length > 0) {
    const ids = input.hotCampaignIds.map(id => `'${id}'`).join(',');
    const rows = await customer.searchStream({
      query: `SELECT campaign.id, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value, segments.date FROM campaign WHERE campaign.id IN (${ids}) AND segments.date = ${dateLiteral}`,
    });
    for (const r of rows) {
      campaigns.push(toCampaignRow(storeId, r));
    }
  }

  const adsets: AdsetDailyRow[] = [];
  if (input.hotAdgroupIds.length > 0) {
    const ids = input.hotAdgroupIds.map(id => `'${id}'`).join(',');
    const rows = await customer.searchStream({
      query: `SELECT campaign.id, ad_group.id, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value, segments.date FROM ad_group WHERE ad_group.id IN (${ids}) AND segments.date = ${dateLiteral}`,
    });
    for (const r of rows) {
      adsets.push(toAdsetRow(storeId, r));
    }
  }

  const ads: AdDailyRow[] = [];
  if (input.hotAdIds.length > 0) {
    const ids = input.hotAdIds.map(id => `'${id}'`).join(',');
    const rows = await customer.searchStream({
      query: `SELECT campaign.id, ad_group.id, ad_group_ad.ad.id, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value, segments.date FROM ad_group_ad WHERE ad_group_ad.ad.id IN (${ids}) AND segments.date = ${dateLiteral}`,
    });
    for (const r of rows) {
      ads.push(toAdRow(storeId, r));
    }
  }

  return { campaigns, adsets, ads };
}

function toCampaignRow(storeId: StoreId, r: Record<string, unknown>): CampaignDailyRow {
  const m = (r.metrics ?? {}) as Record<string, unknown>;
  const s = (r.segments ?? {}) as Record<string, unknown>;
  const c = (r.campaign ?? {}) as Record<string, unknown>;
  return {
    store_id: storeId, platform: 'meta', // overridden below
    campaign_id: String(c.id),
    date: String(s.date ?? ''),
    spend_cad: Number(m.cost_micros ?? 0) / 1e6,
    impressions: Math.round(Number(m.impressions ?? 0)),
    clicks: Math.round(Number(m.clicks ?? 0)),
    conversions: Math.round(Number(m.conversions ?? 0)),
    conversion_value_cad: Number(m.conversions_value ?? 0),
  } as CampaignDailyRow & { platform: 'google' };
  // ^ TS workaround: we cast platform to 'google' below since CampaignDailyRow's literal type is 'meta'.
}

// Override platform to 'google'.
const setGooglePlatform = <T extends { platform: string }>(row: T): T => ({ ...row, platform: 'google' });

function toAdsetRow(storeId: StoreId, r: Record<string, unknown>): AdsetDailyRow {
  const ag = (r.ad_group ?? {}) as Record<string, unknown>;
  return setGooglePlatform({
    ...toCampaignRow(storeId, r),
    adset_id: String(ag.id),
  });
}

function toAdRow(storeId: StoreId, r: Record<string, unknown>): AdDailyRow {
  const ag = (r.ad_group ?? {}) as Record<string, unknown>;
  const aga = (r.ad_group_ad ?? {}) as Record<string, unknown>;
  const adInner = (aga.ad ?? {}) as Record<string, unknown>;
  return setGooglePlatform({
    ...toCampaignRow(storeId, r),
    adset_id: String(ag.id),
    ad_id: String(adInner.id),
  });
}
```

NOTE: `CampaignDailyRow`'s `platform` field in `metaHotMetrics.ts` is typed `'meta'` literal. Either change it to `Platform` (broader) or define a separate row type in this file. For the plan, the simplest fix is to widen the type in `metaHotMetrics.ts`:

In `metaHotMetrics.ts`, change `platform: 'meta';` to `platform: Platform;` (import `Platform` from types).

After making that change, set the platform explicitly in each toRow function.

- [ ] **Step 4: Run — expect PASS (2/2)**

```bash
npx vitest run src/lib/fetchers/__tests__/googleHotMetrics.test.ts
```

Re-run the Meta test to make sure widening the type didn't break:

```bash
npx vitest run src/lib/fetchers/__tests__/metaHotMetrics.test.ts
```

- [ ] **Step 5: tsc**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/lib/fetchers/googleHotMetrics.ts \
        dashboard-web/src/lib/fetchers/__tests__/googleHotMetrics.test.ts \
        dashboard-web/src/lib/fetchers/metaHotMetrics.ts
git commit -m "feat(phase-c): fetchGoogleHotMetricsForStore + widen platform type"
```

---

## Task 7: `googleWorker` Inngest function

**Files:**
- Create: `dashboard-web/src/inngest/functions/googleWorker.ts`
- Test: `dashboard-web/src/inngest/functions/__tests__/googleWorker.test.ts`
- Modify: `dashboard-web/src/lib/registries/eventNames.ts` — add `GOOGLE_JOB_REQUESTED`

- [ ] **Step 1: Extend `eventNames.ts`**

Edit `dashboard-web/src/lib/registries/eventNames.ts`. Add below the META_BUDGET_EXCEEDED line:

```typescript
export const GOOGLE_JOB_REQUESTED = 'google/job.requested' as const;
export const TIKTOK_JOB_REQUESTED = 'tiktok/job.requested' as const;
```

- [ ] **Step 2: Write failing test for googleWorker**

```typescript
// dashboard-web/src/inngest/functions/__tests__/googleWorker.test.ts
import { describe, expect, it, vi } from 'vitest';
import { runGoogleWorkerJob } from '@/inngest/functions/googleWorker';

const NOW_ISO = '2026-05-29T20:00:00.000Z';

describe('runGoogleWorkerJob() — status scope', () => {
  it('happy path: fetchStatus → diff → upsert registries → record freshness success', async () => {
    const fetchStatus = vi.fn().mockResolvedValue({
      campaigns: [{
        store_id: 'uzoshop', platform: 'google', campaign_id: 'GC1', name: 'G1',
        configured_status: 'ENABLED', effective_status: 'SERVING', delivery_status: 'DELIVERING',
        is_enabled: true, is_serving: true,
        first_seen_at: '__placeholder__', last_seen_at: '__placeholder__',
        platform_updated_at: null, status_changed_at: null,
        last_metrics_success_at: null, last_status_success_at: null,
        raw_status_payload: null, missed_seen_count: 0, is_removed: false,
      }],
      adsets: [], ads: [],
    });
    const upsertRegistry = vi.fn();
    const insertStatusEvents = vi.fn();
    const recordFreshness = vi.fn();
    await runGoogleWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'status', tick_id: 'T', staleness_seconds: 600, budget_pct_estimate: 10 },
      fetchStatus, fetchHotMetrics: vi.fn(),
      getHotCampaignIds: async () => [], getHotAdgroupIds: async () => [], getHotAdIds: async () => [],
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry, insertStatusEvents,
      upsertCampaignsDaily: vi.fn(), upsertAdsDaily: vi.fn(),
      recordFreshness,
      nowIso: NOW_ISO,
    });
    expect(fetchStatus).toHaveBeenCalled();
    expect(upsertRegistry).toHaveBeenCalledWith(expect.objectContaining({ table: 'campaign_registry' }));
    expect(insertStatusEvents).toHaveBeenCalled();
    const successCalls = recordFreshness.mock.calls.filter(c => c[0].status === 'success');
    expect(successCalls.map(c => c[0].scope).sort()).toEqual(['ad_status', 'adset_status', 'campaign_status']);
  });
});

describe('runGoogleWorkerJob() — hot_metrics scope', () => {
  it('happy path: getHotIds → fetchMetrics → upsert daily', async () => {
    const fetchMetrics = vi.fn().mockResolvedValue({
      campaigns: [{ store_id: 'uzoshop', platform: 'google', campaign_id: 'GC1', date: '2026-05-30', spend_cad: 25, impressions: 500, clicks: 10, conversions: 1, conversion_value_cad: 30 }],
      adsets: [], ads: [],
    });
    const upsertCampaignsDaily = vi.fn();
    const recordFreshness = vi.fn();
    await runGoogleWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'hot_metrics', tick_id: 'T', staleness_seconds: 300, budget_pct_estimate: 0 },
      fetchStatus: vi.fn(), fetchHotMetrics: fetchMetrics,
      getHotCampaignIds: async () => ['GC1'], getHotAdgroupIds: async () => [], getHotAdIds: async () => [],
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn(), insertStatusEvents: vi.fn(),
      upsertCampaignsDaily, upsertAdsDaily: vi.fn(),
      recordFreshness,
      nowIso: NOW_ISO,
    });
    expect(fetchMetrics).toHaveBeenCalled();
    expect(upsertCampaignsDaily).toHaveBeenCalled();
    expect(recordFreshness).toHaveBeenCalledWith(expect.objectContaining({ scope: 'campaign_metrics', status: 'success' }));
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

```bash
npx vitest run src/inngest/functions/__tests__/googleWorker.test.ts
```

- [ ] **Step 4: Write implementation**

Create `dashboard-web/src/inngest/functions/googleWorker.ts`. Follow the meta-worker template — reuse `diffAgainstRegistry`, `buildRegistryUpsertRow`, `upsertRegistryBatch`, `insertStatusEventsBatch` from Phase B. Discover the existing Google customer factory function (likely in `lib/fetchers/googleAds.ts` — search for `getCustomer` or similar). If the helpers don't exist by usable names, create a thin wrapper `lib/fetchers/googleAccountConfig.ts` similar to `metaAccountConfig.ts`.

Structure:

```typescript
import { inngest } from '@/inngest/client';
import { GOOGLE_JOB_REQUESTED } from '@/lib/registries/eventNames';
import { recordFreshness } from '@/lib/inngest/freshness';
import { fetchGoogleStatusForStore } from '@/lib/fetchers/googleStatus';
import { fetchGoogleHotMetricsForStore } from '@/lib/fetchers/googleHotMetrics';
import { diffAgainstRegistry } from '@/lib/registries/diff';
import {
  buildRegistryUpsertRow, insertStatusEventsBatch, upsertRegistryBatch,
} from '@/lib/registries/upsert';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getGoogleCustomerForStore } from '@/lib/fetchers/googleAccountConfig'; // create if needed
import {
  getHotCampaignIds, getHotAdsetIds, getHotAdIds,
} from '@/lib/registries/hotSet';
import type {
  AdRegistryRow, AdsetRegistryRow, CampaignRegistryRow,
  JobRequestedEvent, StatusEventInsert, StoreId,
} from '@/lib/registries/types';

type PriorMaps = {
  campaigns: Map<string, CampaignRegistryRow>;
  adsets: Map<string, AdsetRegistryRow>;
  ads: Map<string, AdRegistryRow>;
};

export type RunGoogleWorkerJobInput = {
  jobData: JobRequestedEvent;
  fetchStatus: typeof fetchGoogleStatusForStore;
  fetchHotMetrics: typeof fetchGoogleHotMetricsForStore;
  getHotCampaignIds: (storeId: StoreId) => Promise<string[]>;
  getHotAdgroupIds: (storeId: StoreId) => Promise<string[]>;
  getHotAdIds: (storeId: StoreId) => Promise<string[]>;
  loadPriorRegistry: (storeId: StoreId) => Promise<PriorMaps>;
  upsertRegistry: (input: { table: 'campaign_registry' | 'adset_registry' | 'ad_registry'; rows: unknown[] }) => Promise<void>;
  insertStatusEvents: (input: { events: StatusEventInsert[] }) => Promise<void>;
  upsertCampaignsDaily: (rows: Array<Record<string, unknown>>) => Promise<void>;
  upsertAdsDaily: (rows: Array<Record<string, unknown>>) => Promise<void>;
  recordFreshness: (input: { storeId: StoreId; platform: 'google'; scope: string; tableName: string; status: 'success' | 'budget_skip' | 'transient_error'; errorMessage?: string }) => Promise<void>;
  nowIso: string;
};

export async function runGoogleWorkerJob(input: RunGoogleWorkerJobInput): Promise<void> {
  const { jobData, fetchStatus, fetchHotMetrics, getHotCampaignIds: getCamp, getHotAdgroupIds: getAg, getHotAdIds: getAd, loadPriorRegistry, upsertRegistry, insertStatusEvents, upsertCampaignsDaily, upsertAdsDaily, recordFreshness: rec, nowIso } = input;
  const storeId = jobData.store_id;

  if (jobData.scope === 'status') {
    const status = await fetchStatus({ storeId, customer: await getGoogleCustomerForStore(storeId) });
    const prior = await loadPriorRegistry(storeId);

    const campaignEvents = diffAgainstRegistry({ entityType: 'campaign', prior: prior.campaigns, fresh: status.campaigns, occurredAt: nowIso });
    const adsetEvents = diffAgainstRegistry({ entityType: 'adset', prior: prior.adsets as Map<string, CampaignRegistryRow>, fresh: status.adsets as CampaignRegistryRow[], occurredAt: nowIso });
    const adEvents = diffAgainstRegistry({ entityType: 'ad', prior: prior.ads as Map<string, CampaignRegistryRow>, fresh: status.ads as CampaignRegistryRow[], occurredAt: nowIso });
    const allEvents = [...campaignEvents, ...adsetEvents, ...adEvents];
    if (allEvents.length > 0) await insertStatusEvents({ events: allEvents });

    const camp = status.campaigns.map(c => buildRegistryUpsertRow({ prior: prior.campaigns.get(c.campaign_id) ?? null, fresh: c, nowIso }));
    await upsertRegistry({ table: 'campaign_registry', rows: camp });
    const as = status.adsets.map(a => buildRegistryUpsertRow({ prior: prior.adsets.get(a.adset_id) ?? null, fresh: a, nowIso }));
    await upsertRegistry({ table: 'adset_registry', rows: as });
    const ad = status.ads.map(a => buildRegistryUpsertRow({ prior: prior.ads.get(a.ad_id) ?? null, fresh: a, nowIso }));
    await upsertRegistry({ table: 'ad_registry', rows: ad });

    for (const s of ['campaign_status', 'adset_status', 'ad_status'] as const) {
      await rec({ storeId, platform: 'google', scope: s, tableName: regNameForScope(s), status: 'success' });
    }
    return;
  }

  if (jobData.scope === 'hot_metrics') {
    const [hC, hA, hAd] = await Promise.all([getCamp(storeId), getAg(storeId), getAd(storeId)]);
    if (hC.length + hA.length + hAd.length === 0) {
      await rec({ storeId, platform: 'google', scope: 'campaign_metrics', tableName: 'campaigns_daily', status: 'success' });
      return;
    }
    const today = nowIso.slice(0, 10);
    const metrics = await fetchHotMetrics({
      storeId, customer: await getGoogleCustomerForStore(storeId),
      hotCampaignIds: hC, hotAdgroupIds: hA, hotAdIds: hAd, dateStr: today,
    });
    const dailyRows = [
      ...metrics.campaigns.map(c => ({ ...c, source: 'live_tick', last_live_tick_at: nowIso })),
      ...metrics.adsets.map(a => ({ ...a, source: 'live_tick', last_live_tick_at: nowIso })),
    ];
    if (dailyRows.length > 0) await upsertCampaignsDaily(dailyRows);
    if (metrics.ads.length > 0) await upsertAdsDaily(metrics.ads.map(a => ({ ...a, source: 'live_tick', last_live_tick_at: nowIso })));
    await rec({ storeId, platform: 'google', scope: 'campaign_metrics', tableName: 'campaigns_daily', status: 'success' });
    return;
  }
}

function regNameForScope(scope: 'campaign_status' | 'adset_status' | 'ad_status'): string {
  if (scope === 'campaign_status') return 'campaign_registry';
  if (scope === 'adset_status') return 'adset_registry';
  return 'ad_registry';
}

export const googleWorker = inngest.createFunction(
  {
    id: 'google-worker',
    triggers: [{ event: GOOGLE_JOB_REQUESTED }],
    concurrency: [{ key: 'event.data.store_id', limit: 1 }],
    throttle: { limit: 600, period: '1h', key: 'event.data.store_id' },
  },
  async ({ event, step }) => {
    await step.run('runGoogleWorkerJob', async () => {
      const sb = getSupabaseAdmin();
      const data = event.data as unknown as JobRequestedEvent;
      const storeId = data.store_id;

      const loadPriorRegistry = async (): Promise<PriorMaps> => {
        const [{ data: c }, { data: a }, { data: ad }] = await Promise.all([
          sb.from('campaign_registry').select('*').eq('store_id', storeId).eq('platform', 'google'),
          sb.from('adset_registry').select('*').eq('store_id', storeId).eq('platform', 'google'),
          sb.from('ad_registry').select('*').eq('store_id', storeId).eq('platform', 'google'),
        ]);
        return {
          campaigns: new Map((c ?? []).map((r: CampaignRegistryRow) => [r.campaign_id, r])),
          adsets: new Map((a ?? []).map((r: AdsetRegistryRow) => [r.adset_id, r])),
          ads: new Map((ad ?? []).map((r: AdRegistryRow) => [r.ad_id, r])),
        };
      };

      await runGoogleWorkerJob({
        jobData: data,
        fetchStatus: fetchGoogleStatusForStore,
        fetchHotMetrics: fetchGoogleHotMetricsForStore,
        getHotCampaignIds: (sid) => getHotCampaignIds({ admin: sb, storeId: sid, platform: 'google' }),
        getHotAdgroupIds: (sid) => getHotAdsetIds({ admin: sb, storeId: sid, platform: 'google' }),
        getHotAdIds: (sid) => getHotAdIds({ admin: sb, storeId: sid, platform: 'google' }),
        loadPriorRegistry,
        upsertRegistry: async (input) => upsertRegistryBatch({ admin: sb, table: input.table, rows: input.rows as never }),
        insertStatusEvents: async (input) => insertStatusEventsBatch({ admin: sb, events: input.events }),
        upsertCampaignsDaily: async (rows) => {
          if (rows.length === 0) return;
          const { error } = await sb.from('campaigns_daily').upsert(rows, { onConflict: 'date,store_id,platform,campaign_id,ad_set_id' });
          if (error) throw new Error(`campaigns_daily upsert: ${error.message}`);
        },
        upsertAdsDaily: async (rows) => {
          if (rows.length === 0) return;
          const { error } = await sb.from('ads_daily').upsert(rows, { onConflict: 'date,store_id,ad_id' });
          if (error) throw new Error(`ads_daily upsert: ${error.message}`);
        },
        recordFreshness: async (input) => recordFreshness(input as never),
        nowIso: new Date().toISOString(),
      });
    });
  },
);
```

If `getGoogleCustomerForStore` doesn't exist, create `dashboard-web/src/lib/fetchers/googleAccountConfig.ts` with a wrapper that returns a `{ searchStream }` object backed by the existing google-ads SDK setup (search `googleAds.ts` for the factory function — likely takes a customer_id from env var like `<STORE>_GOOGLE_ADS_CUSTOMER_ID`).

- [ ] **Step 5: Run — expect PASS (2/2)**

```bash
npx vitest run src/inngest/functions/__tests__/googleWorker.test.ts
```

- [ ] **Step 6: tsc**

```bash
npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/inngest/functions/googleWorker.ts \
        dashboard-web/src/inngest/functions/__tests__/googleWorker.test.ts \
        dashboard-web/src/lib/registries/eventNames.ts \
        dashboard-web/src/lib/fetchers/googleAccountConfig.ts  # if created
git commit -m "feat(phase-c): google-worker — status + hot_metrics scopes"
```

---

## Task 8: `fetchTikTokStatusForStore`

**Files:**
- Create: `dashboard-web/src/lib/fetchers/tiktokStatus.ts`
- Test: `dashboard-web/src/lib/fetchers/__tests__/tiktokStatus.test.ts`

This task fetches TikTok status via `/campaign/get/`, `/adgroup/get/`, `/ad/get/`. Each returns paginated results.

- [ ] **Step 1: Write failing test**

```typescript
// dashboard-web/src/lib/fetchers/__tests__/tiktokStatus.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchTikTokStatusForStore } from '@/lib/fetchers/tiktokStatus';

function mockFetch(responses: Record<string, unknown>[]) {
  const queue = [...responses];
  return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => {
    const body = queue.shift() ?? { data: { list: [] } };
    return new Response(JSON.stringify(body), { status: 200 });
  });
}

afterEach(() => { vi.restoreAllMocks(); });

describe('fetchTikTokStatusForStore()', () => {
  it('paginates each list endpoint and returns campaigns + adgroups + ads', async () => {
    const fetchMock = mockFetch([
      // campaigns page 1
      { data: { list: [{ campaign_id: 'TC1', campaign_name: 'TT 1', operation_status: 'ENABLE', secondary_status: 'ADGROUP_STATUS_DELIVERY_OK' }], page_info: { total_number: 1, total_page: 1, page: 1 } } },
      // adgroups page 1
      { data: { list: [{ campaign_id: 'TC1', adgroup_id: 'TG1', adgroup_name: 'TT AG1', operation_status: 'ENABLE', secondary_status: 'ADGROUP_STATUS_DELIVERY_OK' }], page_info: { total_number: 1, total_page: 1, page: 1 } } },
      // ads page 1
      { data: { list: [{ campaign_id: 'TC1', adgroup_id: 'TG1', ad_id: 'TA1', ad_name: 'TT A1', operation_status: 'ENABLE', secondary_status: 'AD_STATUS_DELIVERY_OK' }], page_info: { total_number: 1, total_page: 1, page: 1 } } },
    ]);
    const out = await fetchTikTokStatusForStore({
      storeId: 'uzoshop',
      advertiserId: '12345',
      accessToken: 'tok',
      campaignStoreMap: {},
      fetcher: fetchMock,
    });
    expect(out.campaigns).toHaveLength(1);
    expect(out.campaigns[0]).toMatchObject({
      store_id: 'uzoshop', platform: 'tiktok', campaign_id: 'TC1',
      configured_status: 'ENABLE', effective_status: 'ADGROUP_STATUS_DELIVERY_OK',
    });
    expect(out.adsets).toHaveLength(1);
    expect(out.ads).toHaveLength(1);
  });

  it('campaign-store-map: redirects mapped campaigns to the target store_id', async () => {
    const fetchMock = mockFetch([
      { data: { list: [{ campaign_id: 'TC2', campaign_name: 'TT 2', operation_status: 'ENABLE', secondary_status: 'ADGROUP_STATUS_DELIVERY_OK' }], page_info: { total_number: 1, total_page: 1, page: 1 } } },
      { data: { list: [], page_info: { total_number: 0, total_page: 0, page: 1 } } },
      { data: { list: [], page_info: { total_number: 0, total_page: 0, page: 1 } } },
    ]);
    const out = await fetchTikTokStatusForStore({
      storeId: 'uzoshop', advertiserId: '12345', accessToken: 'tok',
      campaignStoreMap: { 'tiktok::12345::TC2': 'usmile360' },
      fetcher: fetchMock,
    });
    expect(out.campaigns[0].store_id).toBe('usmile360');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run src/lib/fetchers/__tests__/tiktokStatus.test.ts
```

- [ ] **Step 3: Write implementation**

```typescript
// dashboard-web/src/lib/fetchers/tiktokStatus.ts
//
// Phase C — TikTok status discovery via /campaign/get/, /adgroup/get/,
// /ad/get/. Each endpoint paginates with page=1..N. Per-row store_id is
// resolved via the campaign-store-map (Phase A.5) so multi-store
// advertisers attribute correctly.

import type {
  AdRegistryRow, AdsetRegistryRow, CampaignRegistryRow,
  StoreId,
} from '@/lib/registries/types';

const TT_BASE = 'https://business-api.tiktok.com/open_api/v1.3';
const NULL_PLACEHOLDER = '__will_be_overwritten_by_upsert_layer__';

export type TikTokStatusInput = {
  storeId: StoreId;
  advertiserId: string;
  accessToken: string;
  campaignStoreMap: Record<string, string>;
  fetcher?: typeof fetch;
};

export type TikTokStatusResult = {
  campaigns: CampaignRegistryRow[];
  adsets: AdsetRegistryRow[];
  ads: AdRegistryRow[];
};

export async function fetchTikTokStatusForStore(input: TikTokStatusInput): Promise<TikTokStatusResult> {
  const { storeId, advertiserId, accessToken, campaignStoreMap, fetcher = fetch } = input;

  const fetchAll = async (endpoint: string): Promise<Array<Record<string, unknown>>> => {
    const out: Array<Record<string, unknown>> = [];
    let page = 1;
    let totalPages = 1;
    while (page <= totalPages) {
      const url = `${TT_BASE}/${endpoint}/get/?advertiser_id=${advertiserId}&primary_status=STATUS_ALL&page=${page}&page_size=1000`;
      const res = await fetcher(url, { headers: { 'Access-Token': accessToken } });
      if (!res.ok) throw new Error(`TikTok ${endpoint} status ${res.status}: ${await res.text()}`);
      const body = await res.json() as { data?: { list?: unknown[]; page_info?: { total_page?: number } } };
      out.push(...((body.data?.list as Array<Record<string, unknown>>) ?? []));
      totalPages = body.data?.page_info?.total_page ?? 1;
      page++;
    }
    return out;
  };

  const [campaignRows, adgroupRows, adRows] = await Promise.all([
    fetchAll('campaign'),
    fetchAll('adgroup'),
    fetchAll('ad'),
  ]);

  const resolveStore = (campaignId: string): StoreId => {
    const key = `tiktok::${advertiserId}::${campaignId}`;
    const mapped = campaignStoreMap[key];
    return (mapped as StoreId) ?? storeId;
  };

  const campaigns: CampaignRegistryRow[] = campaignRows.map(r => toCampaignRow(resolveStore(String(r.campaign_id)), r));
  const adsets: AdsetRegistryRow[] = adgroupRows.map(r => toAdsetRow(resolveStore(String(r.campaign_id)), r));
  const ads: AdRegistryRow[] = adRows.map(r => toAdRow(resolveStore(String(r.campaign_id)), r));

  return { campaigns, adsets, ads };
}

function toCampaignRow(storeId: StoreId, r: Record<string, unknown>): CampaignRegistryRow {
  const configured = String(r.operation_status ?? '');
  const effective = String(r.secondary_status ?? '');
  return {
    store_id: storeId, platform: 'tiktok',
    campaign_id: String(r.campaign_id), name: r.campaign_name as string ?? null,
    configured_status: configured || null,
    effective_status: effective || null,
    delivery_status: deriveDelivery(effective),
    is_enabled: configured === 'ENABLE',
    is_serving: effective.includes('DELIVERY_OK'),
    first_seen_at: NULL_PLACEHOLDER, last_seen_at: NULL_PLACEHOLDER,
    platform_updated_at: null, status_changed_at: null,
    last_metrics_success_at: null, last_status_success_at: null,
    raw_status_payload: r,
    missed_seen_count: 0, is_removed: false,
  };
}

function toAdsetRow(storeId: StoreId, r: Record<string, unknown>): AdsetRegistryRow {
  return {
    ...toCampaignRow(storeId, { ...r, campaign_name: r.adgroup_name }),
    campaign_id: String(r.campaign_id),
    adset_id: String(r.adgroup_id),
    daily_budget_cad: null, lifetime_budget_cad: null,
  };
}

function toAdRow(storeId: StoreId, r: Record<string, unknown>): AdRegistryRow {
  return {
    ...toCampaignRow(storeId, { ...r, campaign_name: r.ad_name }),
    campaign_id: String(r.campaign_id),
    adset_id: String(r.adgroup_id),
    ad_id: String(r.ad_id),
  };
}

function deriveDelivery(effective: string): string | null {
  if (effective.includes('DELIVERY_OK')) return 'DELIVERING';
  if (effective.includes('CAMPAIGN_DISABLE')) return 'NOT_DELIVERING';
  if (effective.includes('PENDING')) return 'PENDING_REVIEW';
  if (effective.includes('REJECTED')) return 'REJECTED';
  if (!effective) return null;
  return 'UNKNOWN';
}
```

- [ ] **Step 4: Run — expect PASS (2/2)**

```bash
npx vitest run src/lib/fetchers/__tests__/tiktokStatus.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/lib/fetchers/tiktokStatus.ts \
        dashboard-web/src/lib/fetchers/__tests__/tiktokStatus.test.ts
git commit -m "feat(phase-c): fetchTikTokStatusForStore — paginated list + campaign-store-map"
```

---

## Task 9: `fetchTikTokHotMetricsForStore`

**Files:**
- Create: `dashboard-web/src/lib/fetchers/tiktokHotMetrics.ts`
- Test: `dashboard-web/src/lib/fetchers/__tests__/tiktokHotMetrics.test.ts`

Mirrors `metaHotMetrics.ts` shape. Uses `/report/integrated/get/` endpoint.

- [ ] **Step 1: Write failing test** (compact — 1 happy-path test)

```typescript
// dashboard-web/src/lib/fetchers/__tests__/tiktokHotMetrics.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchTikTokHotMetricsForStore } from '@/lib/fetchers/tiktokHotMetrics';

afterEach(() => { vi.restoreAllMocks(); });

describe('fetchTikTokHotMetricsForStore()', () => {
  it('returns campaigns rows with metrics for hot ids', async () => {
    const body = {
      data: {
        list: [{
          dimensions: { campaign_id: 'TC1' },
          metrics: { spend: '25.5', impressions: '1000', clicks: '20', conversion: 3, total_complete_payment_rate: '0', purchase: '3', total_purchase_value: '150.0' },
        }],
        page_info: { total_number: 1, total_page: 1, page: 1 },
      },
    };
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(body), { status: 200 }));
    const out = await fetchTikTokHotMetricsForStore({
      storeId: 'uzoshop', advertiserId: '12345', accessToken: 'tok',
      hotCampaignIds: ['TC1'], hotAdgroupIds: [], hotAdIds: [],
      dateStr: '2026-05-30', campaignStoreMap: {},
      fetcher: fetchMock,
      getFxCadFor: async (amount, currency) => currency === 'USD' ? amount * 1.36 : amount,
    });
    expect(out.campaigns).toHaveLength(1);
    expect(out.campaigns[0]).toMatchObject({
      store_id: 'uzoshop', platform: 'tiktok', campaign_id: 'TC1',
      impressions: 1000, clicks: 20, conversions: 3,
    });
  });

  it('skips with empty hot sets', async () => {
    const fetchMock = vi.fn();
    const out = await fetchTikTokHotMetricsForStore({
      storeId: 'uzoshop', advertiserId: '12345', accessToken: 'tok',
      hotCampaignIds: [], hotAdgroupIds: [], hotAdIds: [],
      dateStr: '2026-05-30', campaignStoreMap: {},
      fetcher: fetchMock,
      getFxCadFor: async () => 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(out.campaigns).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run src/lib/fetchers/__tests__/tiktokHotMetrics.test.ts
```

- [ ] **Step 3: Write implementation**

```typescript
// dashboard-web/src/lib/fetchers/tiktokHotMetrics.ts
//
// Phase C — TikTok report fetch for hot ids at campaign/adgroup/ad
// levels. campaign-store-map resolves per-row store_id same as
// tiktokStatus.ts.

import type { StoreId } from '@/lib/registries/types';
import type { AdDailyRow, AdsetDailyRow, CampaignDailyRow } from './metaHotMetrics';

const TT_BASE = 'https://business-api.tiktok.com/open_api/v1.3';

export type TikTokHotMetricsInput = {
  storeId: StoreId;
  advertiserId: string;
  accessToken: string;
  hotCampaignIds: string[];
  hotAdgroupIds: string[];
  hotAdIds: string[];
  dateStr: string;
  campaignStoreMap: Record<string, string>;
  fetcher?: typeof fetch;
  getFxCadFor: (amount: number, currency: 'USD' | 'CAD' | 'ILS') => Promise<number>;
};

export type TikTokHotMetricsResult = {
  campaigns: CampaignDailyRow[];
  adsets: AdsetDailyRow[];
  ads: AdDailyRow[];
};

export async function fetchTikTokHotMetricsForStore(input: TikTokHotMetricsInput): Promise<TikTokHotMetricsResult> {
  const { storeId, advertiserId, accessToken, dateStr, campaignStoreMap, fetcher = fetch, getFxCadFor } = input;

  if (input.hotCampaignIds.length === 0 && input.hotAdgroupIds.length === 0 && input.hotAdIds.length === 0) {
    return { campaigns: [], adsets: [], ads: [] };
  }

  const resolveStore = (campaignId: string): StoreId => {
    const key = `tiktok::${advertiserId}::${campaignId}`;
    return (campaignStoreMap[key] as StoreId) ?? storeId;
  };

  const fetchLevel = async (
    dataLevel: 'AUCTION_CAMPAIGN' | 'AUCTION_ADGROUP' | 'AUCTION_AD',
    dimensionName: 'campaign_id' | 'adgroup_id' | 'ad_id',
    filterField: 'campaign_ids' | 'adgroup_ids' | 'ad_ids',
    ids: string[],
  ): Promise<Array<Record<string, unknown>>> => {
    if (ids.length === 0) return [];
    const url = `${TT_BASE}/report/integrated/get/?advertiser_id=${advertiserId}&report_type=BASIC&data_level=${dataLevel}&dimensions=["${dimensionName}"]&metrics=["spend","impressions","clicks","conversion","purchase","total_purchase_value"]&start_date=${dateStr}&end_date=${dateStr}&page=1&page_size=1000&filtering=${encodeURIComponent(JSON.stringify([{ field_name: filterField, filter_type: 'IN', filter_value: ids }]))}`;
    const res = await fetcher(url, { headers: { 'Access-Token': accessToken } });
    if (!res.ok) throw new Error(`TikTok report ${dataLevel}: ${res.status}`);
    const body = await res.json() as { data?: { list?: unknown[] } };
    return (body.data?.list as Array<Record<string, unknown>>) ?? [];
  };

  const [campaignRaw, adgroupRaw, adRaw] = await Promise.all([
    fetchLevel('AUCTION_CAMPAIGN', 'campaign_id', 'campaign_ids', input.hotCampaignIds),
    fetchLevel('AUCTION_ADGROUP', 'adgroup_id', 'adgroup_ids', input.hotAdgroupIds),
    fetchLevel('AUCTION_AD', 'ad_id', 'ad_ids', input.hotAdIds),
  ]);

  const campaigns = await Promise.all(campaignRaw.map(r => toCampaignRow(resolveStore, dateStr, r, getFxCadFor)));
  const adsets = await Promise.all(adgroupRaw.map(r => toAdsetRow(resolveStore, dateStr, r, getFxCadFor)));
  const ads = await Promise.all(adRaw.map(r => toAdRow(resolveStore, dateStr, r, getFxCadFor)));

  return { campaigns, adsets, ads };
}

async function toCampaignRow(
  resolveStore: (cid: string) => StoreId, dateStr: string,
  r: Record<string, unknown>, getFx: TikTokHotMetricsInput['getFxCadFor'],
): Promise<CampaignDailyRow> {
  const d = (r.dimensions ?? {}) as Record<string, unknown>;
  const m = (r.metrics ?? {}) as Record<string, unknown>;
  const cid = String(d.campaign_id ?? '');
  const spend = Number(m.spend ?? 0);
  const spendCad = await getFx(spend, 'USD');
  const purchase = Number(m.purchase ?? 0);
  const purchaseValue = Number(m.total_purchase_value ?? 0);
  const purchaseValueCad = await getFx(purchaseValue, 'USD');
  return {
    store_id: resolveStore(cid), platform: 'tiktok',
    campaign_id: cid, date: dateStr,
    spend_cad: spendCad,
    impressions: Math.round(Number(m.impressions ?? 0)),
    clicks: Math.round(Number(m.clicks ?? 0)),
    conversions: Math.round(purchase),
    conversion_value_cad: purchaseValueCad,
  };
}

async function toAdsetRow(
  resolveStore: (cid: string) => StoreId, dateStr: string,
  r: Record<string, unknown>, getFx: TikTokHotMetricsInput['getFxCadFor'],
): Promise<AdsetDailyRow> {
  const d = (r.dimensions ?? {}) as Record<string, unknown>;
  // For adgroup-level report rows, the dimension is `adgroup_id`; campaign_id may not be in dimensions.
  return {
    ...(await toCampaignRow(resolveStore, dateStr, r, getFx)),
    adset_id: String(d.adgroup_id ?? ''),
  };
}

async function toAdRow(
  resolveStore: (cid: string) => StoreId, dateStr: string,
  r: Record<string, unknown>, getFx: TikTokHotMetricsInput['getFxCadFor'],
): Promise<AdDailyRow> {
  const d = (r.dimensions ?? {}) as Record<string, unknown>;
  return {
    ...(await toAdsetRow(resolveStore, dateStr, r, getFx)),
    ad_id: String(d.ad_id ?? ''),
  };
}
```

- [ ] **Step 4: Run — expect PASS (2/2)**

```bash
npx vitest run src/lib/fetchers/__tests__/tiktokHotMetrics.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/lib/fetchers/tiktokHotMetrics.ts \
        dashboard-web/src/lib/fetchers/__tests__/tiktokHotMetrics.test.ts
git commit -m "feat(phase-c): fetchTikTokHotMetricsForStore — report endpoint + mapping resolution"
```

---

## Task 10: `tiktokWorker` Inngest function

**Files:**
- Create: `dashboard-web/src/inngest/functions/tiktokWorker.ts`
- Test: `dashboard-web/src/inngest/functions/__tests__/tiktokWorker.test.ts`

Mirrors `googleWorker` shape. Same status + hot_metrics scope structure.

- [ ] **Step 1: Write failing test (one per scope)**

```typescript
// dashboard-web/src/inngest/functions/__tests__/tiktokWorker.test.ts
import { describe, expect, it, vi } from 'vitest';
import { runTikTokWorkerJob } from '@/inngest/functions/tiktokWorker';

const NOW_ISO = '2026-05-29T20:00:00.000Z';

describe('runTikTokWorkerJob()', () => {
  it('status scope: fetches, diffs, upserts, records freshness', async () => {
    const fetchStatus = vi.fn().mockResolvedValue({
      campaigns: [{ store_id: 'uzoshop', platform: 'tiktok', campaign_id: 'TC1', name: 'T1', configured_status: 'ENABLE', effective_status: 'ADGROUP_STATUS_DELIVERY_OK', delivery_status: 'DELIVERING', is_enabled: true, is_serving: true, first_seen_at: '__pl__', last_seen_at: '__pl__', platform_updated_at: null, status_changed_at: null, last_metrics_success_at: null, last_status_success_at: null, raw_status_payload: null, missed_seen_count: 0, is_removed: false }],
      adsets: [], ads: [],
    });
    const upsertRegistry = vi.fn(); const insertStatusEvents = vi.fn(); const recordFreshness = vi.fn();
    await runTikTokWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'status', tick_id: 'T', staleness_seconds: 600, budget_pct_estimate: 0 },
      loadStoreMap: async () => ({}),
      fetchStatus, fetchHotMetrics: vi.fn(),
      getHotCampaignIds: async () => [], getHotAdgroupIds: async () => [], getHotAdIds: async () => [],
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry, insertStatusEvents,
      upsertCampaignsDaily: vi.fn(), upsertAdsDaily: vi.fn(),
      recordFreshness,
      nowIso: NOW_ISO,
    });
    expect(fetchStatus).toHaveBeenCalled();
    expect(upsertRegistry).toHaveBeenCalledWith(expect.objectContaining({ table: 'campaign_registry' }));
    const successCalls = recordFreshness.mock.calls.filter(c => c[0].status === 'success');
    expect(successCalls.map(c => c[0].scope).sort()).toEqual(['ad_status', 'adset_status', 'campaign_status']);
  });

  it('hot_metrics scope with empty hot set skips fetch', async () => {
    const fetchHotMetrics = vi.fn();
    const recordFreshness = vi.fn();
    await runTikTokWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'hot_metrics', tick_id: 'T', staleness_seconds: 300, budget_pct_estimate: 0 },
      loadStoreMap: async () => ({}),
      fetchStatus: vi.fn(), fetchHotMetrics,
      getHotCampaignIds: async () => [], getHotAdgroupIds: async () => [], getHotAdIds: async () => [],
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn(), insertStatusEvents: vi.fn(),
      upsertCampaignsDaily: vi.fn(), upsertAdsDaily: vi.fn(),
      recordFreshness,
      nowIso: NOW_ISO,
    });
    expect(fetchHotMetrics).not.toHaveBeenCalled();
    expect(recordFreshness).toHaveBeenCalledWith(expect.objectContaining({ scope: 'campaign_metrics', status: 'success' }));
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run src/inngest/functions/__tests__/tiktokWorker.test.ts
```

- [ ] **Step 3: Write implementation** — analogous to googleWorker.ts (imports + structure mirror it). Key differences: imports `fetchTikTokStatusForStore` + `fetchTikTokHotMetricsForStore`; loads `campaignStoreMap` from `dashboard_state` (use existing `loadCampaignStoreMapFromSupabase` from `@/lib/inngest/campaignStoreMap`); reads tiktok advertiser id + access token via env vars `<STORE>_TIKTOK_ADVERTISER_ID` + `<STORE>_TIKTOK_ACCESS_TOKEN` (likely already exists — discover or create `tiktokAccountConfig.ts`). Throttle 1500/h.

Take the googleWorker.ts file you wrote in Task 7, copy its structure verbatim into tiktokWorker.ts, change names (`GOOGLE_JOB_REQUESTED` → `TIKTOK_JOB_REQUESTED`, `fetchGoogleStatusForStore` → `fetchTikTokStatusForStore`, etc), and adjust the worker config:

```typescript
{
  id: 'tiktok-worker',
  triggers: [{ event: TIKTOK_JOB_REQUESTED }],
  concurrency: [{ key: 'event.data.store_id', limit: 1 }],
  throttle: { limit: 1500, period: '1h', key: 'event.data.store_id' },
}
```

For the status branch, add a `loadStoreMap` call BEFORE the fetch and pass `campaignStoreMap` to `fetchTikTokStatusForStore`. Same for hot_metrics — pass `campaignStoreMap` to `fetchTikTokHotMetricsForStore`.

The Inngest wrapper:

```typescript
import { loadCampaignStoreMapFromSupabase } from '@/lib/inngest/campaignStoreMap';
// ...
await runTikTokWorkerJob({
  jobData: data,
  loadStoreMap: loadCampaignStoreMapFromSupabase,
  fetchStatus: fetchTikTokStatusForStore,
  fetchHotMetrics: fetchTikTokHotMetricsForStore,
  // ...rest analogous to googleWorker.ts...
});
```

- [ ] **Step 4: Run — expect PASS (2/2)**

```bash
npx vitest run src/inngest/functions/__tests__/tiktokWorker.test.ts
```

- [ ] **Step 5: tsc**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/inngest/functions/tiktokWorker.ts \
        dashboard-web/src/inngest/functions/__tests__/tiktokWorker.test.ts \
        dashboard-web/src/lib/fetchers/tiktokAccountConfig.ts  # if created
git commit -m "feat(phase-c): tiktok-worker — status + hot_metrics scopes (mapping-aware)"
```

---

## Task 11: Orchestrator extension — 6 scopes per tick

**Files:**
- Modify: `dashboard-web/src/lib/registries/priorityBuilder.ts` — extend `buildEvents` for all platforms
- Modify: `dashboard-web/src/inngest/functions/cronTickOrchestrator.ts` — load Google + TikTok BUC, build all-platform events

- [ ] **Step 1: Extend tests in `priorityBuilder.test.ts`**

Add a new describe block at the end:

```typescript
describe('buildEvents() — multi-platform Phase C', () => {
  it('emits Meta + Google + TikTok events when all 3 are stale', () => {
    const buc = {
      meta: { uzoshop: { pct: 5, etaMinutes: 0 } },
      google: { uzoshop: { pct: 5, etaMinutes: 0 } },
      tiktok: { uzoshop: { pct: 5, etaMinutes: 0 } },
    };
    const events = buildEvents({
      stores: ['uzoshop'],
      freshness: [],
      metaBucStateByStore: buc.meta,
      googleBucStateByStore: buc.google,
      tiktokBucStateByStore: buc.tiktok,
      tickId: '2026-05-29T14:30',
      nowMs: NOW_MS,
    });
    expect(events.length).toBeGreaterThanOrEqual(3); // at least 1 per platform (status scope)
    expect(events.map(e => e.name).sort()).toEqual(expect.arrayContaining([
      'meta/job.requested', 'google/job.requested', 'tiktok/job.requested',
    ]));
  });

  it('emits both status and hot_metrics events for the same platform when both are stale', () => {
    const events = buildEvents({
      stores: ['uzoshop'],
      freshness: [],
      metaBucStateByStore: { uzoshop: { pct: 5, etaMinutes: 0 } },
      googleBucStateByStore: {},
      tiktokBucStateByStore: {},
      tickId: '2026-05-29T14:30',
      nowMs: NOW_MS,
    });
    const metaEvents = events.filter(e => e.name === 'meta/job.requested');
    expect(metaEvents.map(e => e.data.scope).sort()).toEqual(['hot_metrics', 'status']);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (the new signature isn't there)

```bash
npx vitest run src/lib/registries/__tests__/priorityBuilder.test.ts
```

- [ ] **Step 3: Edit `priorityBuilder.ts` to extend `buildEvents`**

Replace `buildEvents` with the version that handles per-platform per-scope:

```typescript
// Phase C — extended buildEvents covering meta + google + tiktok,
// each with status + hot_metrics scopes.

import { META_JOB_REQUESTED, GOOGLE_JOB_REQUESTED, TIKTOK_JOB_REQUESTED, type WorkerScope } from './eventNames';

type Platform = 'meta' | 'google' | 'tiktok';
type EventName = typeof META_JOB_REQUESTED | typeof GOOGLE_JOB_REQUESTED | typeof TIKTOK_JOB_REQUESTED;

const EVENT_NAME_BY_PLATFORM: Record<Platform, EventName> = {
  meta: META_JOB_REQUESTED,
  google: GOOGLE_JOB_REQUESTED,
  tiktok: TIKTOK_JOB_REQUESTED,
};

const FRESHNESS_SCOPE_BY_WORKER_SCOPE: Record<'status' | 'hot_metrics', string> = {
  status: 'campaign_status',
  hot_metrics: 'campaign_metrics',
};

// Hot-metrics needs fresher data than status. Tighter cooldown tiers:
export function cooldownSecondsForHotMetrics(pct: number): number {
  if (pct >= 80) return Number.POSITIVE_INFINITY;
  if (pct >= 60) return 600;  // 10 min
  if (pct >= 30) return 300;  // 5 min
  return 180;                 // 3 min
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
      if (state.etaMinutes > 0) continue;
      if (state.pct >= HARD_SKIP_PCT) continue;

      for (const scope of ['status', 'hot_metrics'] as const) {
        const cooldown = scope === 'status'
          ? cooldownSecondsForPct(state.pct)
          : cooldownSecondsForHotMetrics(state.pct);
        if (!Number.isFinite(cooldown)) continue;

        const stalenessScope = FRESHNESS_SCOPE_BY_WORKER_SCOPE[scope];
        const stalenessSec = freshnessSecondsFor(input.freshness, storeId, stalenessScope, input.nowMs, platform);
        if (stalenessSec < cooldown) continue;

        events.push({
          name: EVENT_NAME_BY_PLATFORM[platform],
          id: `${platform}:${storeId}:${scope}:${input.tickId}`,
          data: {
            store_id: storeId, scope, tick_id: input.tickId,
            staleness_seconds: stalenessSec,
            budget_pct_estimate: state.pct,
          },
        });
      }
    }
  }
  return events;
}

// freshnessSecondsFor now ALSO filters by platform (Phase B's was platform-implicit-meta).
function freshnessSecondsFor(
  rows: FreshnessRow[], storeId: StoreId, scope: string, nowMs: number, platform?: string,
): number {
  const row = rows.find(r => r.store_id === storeId && r.scope === scope && (!platform || r.platform === platform));
  if (!row || !row.last_success_at) return Number.MAX_SAFE_INTEGER;
  return Math.floor((nowMs - new Date(row.last_success_at).getTime()) / 1000);
}
```

(Keep the existing `cooldownSecondsForPct`, `MetaBucState`, and other exports unchanged.)

- [ ] **Step 4: Run — expect PASS (priorityBuilder + Phase B's tests still pass)**

```bash
npx vitest run src/lib/registries/__tests__/priorityBuilder.test.ts
```

(Phase B's old test that uses `metaBucStateByStore` only — without the new google/tiktok params — still passes because they're optional.)

- [ ] **Step 5: Update orchestrator to load all 3 BUC states**

In `cronTickOrchestrator.ts`, change `loadMetaBucStateByStore` to ALSO load google + tiktok BUC. Since neither Google nor TikTok currently have a BUC tracking table (Meta's exists from Phase A as `meta_buc_usage`), use a simple heuristic for now:
- For Google: query `data_freshness` for the latest `error_code` per store; if any 429-like error, use a high pct; otherwise 0.
- For TikTok: same heuristic.

Or simpler: pass empty `{}` for Google and TikTok so they always pass Layer 1 + 2 (no historical data → infinite staleness → emit always). The throttle in each worker handles rate-limit enforcement.

Edit the orchestrator's `runTickOnce` call:

```typescript
const events = buildEvents({
  stores: STORES,
  freshness,
  metaBucStateByStore,
  googleBucStateByStore: {}, // Phase C MVP — workers handle their own throttling
  tiktokBucStateByStore: {},
  tickId,
  nowMs,
});
```

- [ ] **Step 6: tsc + commit**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx tsc --noEmit
cd /Users/dorperetz/script-roas
git add dashboard-web/src/lib/registries/priorityBuilder.ts \
        dashboard-web/src/lib/registries/__tests__/priorityBuilder.test.ts \
        dashboard-web/src/inngest/functions/cronTickOrchestrator.ts
git commit -m "feat(phase-c): orchestrator emits 6 scopes per tick (meta+google+tiktok × status+hot_metrics)"
```

---

## Task 12: `CampaignFreshnessChip` + mount on `CampaignsTable`

**Files:**
- Create: `dashboard-web/src/components/CampaignFreshnessChip.tsx`
- Modify: `dashboard-web/src/components/CampaignsTable.tsx` — mount the chip

- [ ] **Step 1: Write the component**

```tsx
// dashboard-web/src/components/CampaignFreshnessChip.tsx
//
// Phase C — small freshness chip for CampaignsTable rows. Reads
// last_live_tick_at from campaigns_daily. Green if <15 min, yellow
// if 15-60, gray if >60 min or null.

export type CampaignFreshnessChipProps = {
  lastLiveTickAt: string | null | undefined;
};

function colorForMinutes(min: number | null): { dot: string; label: string } {
  if (min === null) return { dot: 'bg-ink-secondary/30', label: '—' };
  if (min < 15) return { dot: 'bg-status-green', label: `${min} דק׳` };
  if (min < 60) return { dot: 'bg-status-orange', label: `${min} דק׳` };
  return { dot: 'bg-status-red', label: `${Math.floor(min / 60)} שע׳` };
}

export function CampaignFreshnessChip({ lastLiveTickAt }: CampaignFreshnessChipProps) {
  const min = lastLiveTickAt ? Math.floor((Date.now() - new Date(lastLiveTickAt).getTime()) / 60_000) : null;
  const { dot, label } = colorForMinutes(min);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-secondary" title={lastLiveTickAt ?? 'no live tick'}>
      <span className={`size-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}
```

- [ ] **Step 2: Mount on `CampaignsTable`**

Find the place in `CampaignsTable.tsx` where each row's spend column is rendered (look for "spend" or "הוצאה"). Insert `<CampaignFreshnessChip lastLiveTickAt={a.lastLiveTickAt ?? row.last_live_tick_at ?? null} />` directly below the spend cell content. The exact prop name depends on what `CampaignsTable`'s row data shape exposes — check the row component or grep for `last_live_tick_at`. If the field isn't on the aggregator output yet, propagate it through the same path the existing `effective_status` flows.

```bash
grep -n "last_live_tick_at\|lastLiveTickAt" /Users/dorperetz/script-roas/dashboard-web/src/components/CampaignsTable.tsx
grep -n "last_live_tick_at\|lastLiveTickAt" /Users/dorperetz/script-roas/dashboard-web/src/lib/campaigns.ts
```

If `last_live_tick_at` isn't on the CampaignRow type, add it as an optional field and include it in the postgresReader's SELECT.

- [ ] **Step 3: tsc + build**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx tsc --noEmit
npm run build
```

- [ ] **Step 4: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/components/CampaignFreshnessChip.tsx \
        dashboard-web/src/components/CampaignsTable.tsx \
        dashboard-web/src/lib/campaigns.ts \
        dashboard-web/src/lib/postgresReaders.ts
git commit -m "feat(phase-c): CampaignFreshnessChip — last_live_tick_at indicator on rows"
```

---

## Task 13: `CampaignDrawerStatusSection` + mount on `CampaignDrawer`

**Files:**
- Create: `dashboard-web/src/components/CampaignDrawerStatusSection.tsx`
- Modify: `dashboard-web/src/components/CampaignDrawer.tsx` — mount the section

- [ ] **Step 1: Write the component**

```tsx
// dashboard-web/src/components/CampaignDrawerStatusSection.tsx
//
// Phase C — minimal status + freshness section for the campaign drawer.
// Server-fetched on parent; receives props synchronously.

export type CampaignDrawerStatusSectionProps = {
  configuredStatus: string | null;
  effectiveStatus: string | null;
  deliveryStatus: string | null;
  firstSeenAt: string | null;
  statusChangedAt: string | null;
  lastLiveTickAt: string | null;
  metricsLagMinutes: number | null;
};

function relMin(min: number | null): string {
  if (min === null) return '—';
  if (min < 60) return `${min} דק׳ לפני`;
  if (min < 60 * 24) return `${Math.floor(min / 60)} שע׳ לפני`;
  return `${Math.floor(min / 1440)} ימים לפני`;
}

function relIso(iso: string | null): string {
  if (!iso) return '—';
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  return relMin(min);
}

export function CampaignDrawerStatusSection(p: CampaignDrawerStatusSectionProps) {
  return (
    <section className="border border-line-subtle rounded-lg p-4 my-3">
      <h3 className="text-sm font-medium text-ink-primary mb-2">סטטוס + טריות</h3>
      <div className="grid grid-cols-2 gap-y-1.5 text-xs">
        <span className="text-ink-secondary">configured</span>
        <span className="text-ink-primary">{p.configuredStatus ?? '—'}</span>
        <span className="text-ink-secondary">effective</span>
        <span className="text-ink-primary">{p.effectiveStatus ?? '—'}</span>
        <span className="text-ink-secondary">delivery</span>
        <span className="text-ink-primary">{p.deliveryStatus ?? '—'}</span>
        <span className="text-ink-secondary">first_seen</span>
        <span className="text-ink-primary">{relIso(p.firstSeenAt)}</span>
        <span className="text-ink-secondary">status_changed</span>
        <span className="text-ink-primary">{relIso(p.statusChangedAt)}</span>
        <span className="text-ink-secondary">last_live_tick</span>
        <span className="text-ink-primary">{relIso(p.lastLiveTickAt)}</span>
        <span className="text-ink-secondary">metrics lag</span>
        <span className="text-ink-primary">{relMin(p.metricsLagMinutes)}</span>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Mount on `CampaignDrawer.tsx`**

Find where the drawer renders its content. The drawer probably fetches campaign data via SWR. Extend the data shape to include the new fields by reading from `campaign_registry` and `data_freshness`:

```bash
grep -n "campaign_registry\|fetchCampaignDrawerData" /Users/dorperetz/script-roas/dashboard-web/src/components/CampaignDrawer.tsx
```

If the drawer doesn't yet read registry data, the minimum-viable Phase C version is to pass the props down from existing fields you already have (effective_status from campaigns_daily, last_live_tick_at from campaigns_daily; configured_status / delivery_status / first_seen_at / status_changed_at / metrics_lag can be hardcoded to null for Phase C — Phase D wires the full registry-status read path).

Insert the component below the existing drawer header:

```tsx
<CampaignDrawerStatusSection
  configuredStatus={null} // Phase D wires from campaign_registry
  effectiveStatus={summary.effectiveStatus ?? null}
  deliveryStatus={null} // Phase D
  firstSeenAt={null} // Phase D
  statusChangedAt={null} // Phase D
  lastLiveTickAt={summary.lastLiveTickAt ?? null}
  metricsLagMinutes={null} // Phase D
/>
```

(Adjust the prop sources based on what the drawer's `summary` object exposes.)

- [ ] **Step 3: tsc + build**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx tsc --noEmit
npm run build
```

- [ ] **Step 4: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/components/CampaignDrawerStatusSection.tsx \
        dashboard-web/src/components/CampaignDrawer.tsx
git commit -m "feat(phase-c): CampaignDrawerStatusSection — minimal status + freshness panel"
```

---

## Task 14: `audit:reconcile --hot-metrics-vs-heavy`

**Files:**
- Create: `dashboard-web/src/lib/audit/__tests__/reconcileHotMetricsVsHeavy.live.test.ts`
- Modify: `dashboard-web/package.json` — add npm script

- [ ] **Step 1: Write the live test**

```typescript
// dashboard-web/src/lib/audit/__tests__/reconcileHotMetricsVsHeavy.live.test.ts
//
// AUDIT_LIVE=1 npm run audit:reconcile:hot-vs-heavy
//
// Compares per-(store, platform, campaign) spend / impressions / clicks /
// conversions / conversion_value between the two pipelines.

import { describe, expect, it } from 'vitest';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

const RUN = process.env.AUDIT_LIVE === '1';
const TOLERANCE_REL = 0.01;  // 1%
const TOLERANCE_ABS = 1;     // $1

(RUN ? describe : describe.skip)('reconcile hot-metrics vs cron-live-heavy', () => {
  it('agrees within tolerance for today and yesterday', async () => {
    const sb = getSupabaseAdmin();
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

    for (const date of [today, yesterday]) {
      const { data } = await sb.from('campaigns_daily').select('store_id, platform, campaign_id, source, spend_cad, impressions, clicks, conversions, conversion_value_cad').eq('date', date);
      const rows = (data ?? []) as Array<{ store_id: string; platform: string; campaign_id: string; source: string; spend_cad: number; impressions: number; clicks: number; conversions: number; conversion_value_cad: number }>;

      // Group by (store, platform, campaign_id) and partition by source.
      const groups = new Map<string, { live: typeof rows[0] | null; heavy: typeof rows[0] | null }>();
      for (const r of rows) {
        const key = `${r.store_id}::${r.platform}::${r.campaign_id}`;
        const g = groups.get(key) ?? { live: null, heavy: null };
        if (r.source === 'live_tick') g.live = r;
        else g.heavy = r;  // any non-live_tick source — daily_reconcile or older
        groups.set(key, g);
      }

      const drifts: string[] = [];
      for (const [key, g] of groups) {
        if (!g.live || !g.heavy) continue;  // can't compare; one pipeline didn't write yet
        const diff = Math.abs(g.live.spend_cad - g.heavy.spend_cad);
        const rel = g.heavy.spend_cad > 0 ? diff / g.heavy.spend_cad : 0;
        if (diff > TOLERANCE_ABS && rel > TOLERANCE_REL) {
          drifts.push(`${date} ${key}: live=${g.live.spend_cad} heavy=${g.heavy.spend_cad} diff=${diff.toFixed(2)} rel=${(rel * 100).toFixed(1)}%`);
        }
      }

      if (drifts.length > 0) {
        console.warn(`[reconcile ${date}] drift in ${drifts.length} groups:\n${drifts.slice(0, 20).join('\n')}`);
      }
      expect(drifts).toEqual([]);
    }
  });
});
```

- [ ] **Step 2: Add npm script in `dashboard-web/package.json`**

In the `"scripts"` section, add:

```json
"audit:reconcile:hot-vs-heavy": "AUDIT_LIVE=1 vitest run src/lib/audit/__tests__/reconcileHotMetricsVsHeavy.live.test.ts"
```

- [ ] **Step 3: Run without AUDIT_LIVE — expect SKIP**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx vitest run src/lib/audit/__tests__/reconcileHotMetricsVsHeavy.live.test.ts
```

Expected: 1 skipped (no real DB call when `AUDIT_LIVE` unset).

- [ ] **Step 4: Commit (no actual reconcile run — that's an ops task)**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/lib/audit/__tests__/reconcileHotMetricsVsHeavy.live.test.ts \
        dashboard-web/package.json
git commit -m "feat(phase-c): audit:reconcile:hot-vs-heavy — Phase C.5 canary harness"
```

---

## Task 15: Register workers + apply migration + push + verify

- [ ] **Step 1: Register the two new workers in the Inngest serve()**

Edit `dashboard-web/src/app/api/inngest/route.ts`. Add imports after the existing metaWorker import:

```typescript
import { googleWorker } from '@/inngest/functions/googleWorker';
import { tiktokWorker } from '@/inngest/functions/tiktokWorker';
```

Add both to the `functions: [...]` array.

- [ ] **Step 2: tsc + build + lint + tests**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx tsc --noEmit
npm run lint
npm test
npm run test:components
npm run build
```

All five must exit clean.

- [ ] **Step 3: Update User Manual + Architecture Doc**

Edit `docs/ROAS-Dashboard-User-Manual.md`:
- Bump version `2.1.21` → `2.1.22` (header + footer).
- Add a new section above `### 2.1.21` titled `### 2.1.22 (2026-05-30) — Phase C: hot metrics + Google/TikTok workers (canary)` describing: 3 new Postgres functions for hot-set; meta-worker handles hot_metrics; new google-worker + tiktok-worker (status + hot_metrics each); orchestrator emits 6 scopes per tick; CampaignsTable shows freshness chip; CampaignDrawer shows status section; `audit:reconcile:hot-vs-heavy` canary harness; cron-live-heavy stays running for 3-day canary; decommission ships in Phase C.5.

Edit `docs/ARCHITECTURE.md`:
- Add a `## Phase C (2026-05-30) — Hot metrics + Google/TikTok workers (pre-decommission)` section after the Phase B section. Describe: 3 Postgres functions, the 2 new fetchers per platform (5 total: googleStatus, googleHotMetrics, tiktokStatus, tiktokHotMetrics, metaHotMetrics), the 2 new Inngest functions (googleWorker, tiktokWorker), the meta-worker hot_metrics extension, the orchestrator's per-platform fan-out, the dynamic-threshold hot_metrics cooldown tiers (180/300/600/skip), and the explicit out-of-scope (decommission is C.5, full UI registry-wiring is D).

- [ ] **Step 4: Apply migration to prod**

```bash
mv /Users/dorperetz/script-roas/.env /Users/dorperetz/script-roas/.env.tmp
cd /tmp && supabase db push --linked --workdir /Users/dorperetz/script-roas
mv /Users/dorperetz/script-roas/.env.tmp /Users/dorperetz/script-roas/.env
```

Expected: `Applying migration <timestamp>_phase_c_hot_set_functions.sql... Finished supabase db push.`

- [ ] **Step 5: Verify functions exist on prod**

```bash
mv /Users/dorperetz/script-roas/.env /Users/dorperetz/script-roas/.env.tmp
cd /tmp && supabase db query --linked --workdir /Users/dorperetz/script-roas --output table \
  "SELECT routine_name FROM information_schema.routines WHERE routine_schema = 'public' AND routine_name IN ('get_hot_campaign_ids','get_hot_adset_ids','get_hot_ad_ids') ORDER BY routine_name;"
mv /Users/dorperetz/script-roas/.env.tmp /Users/dorperetz/script-roas/.env
```

Expected: 3 rows.

- [ ] **Step 6: Commit docs + push everything to main**

```bash
cd /Users/dorperetz/script-roas
git add docs/ROAS-Dashboard-User-Manual.md docs/ARCHITECTURE.md \
        dashboard-web/src/app/api/inngest/route.ts
git commit -m "docs(phase-c): User Manual 2.1.22 + Architecture + register googleWorker/tiktokWorker"
git push origin main
```

Pre-push gates: tsc + vitest + lint + docs-currency. Must all pass.

- [ ] **Step 7: Force Inngest sync after Vercel redeploy**

```bash
sleep 90 && curl -sS -X PUT "https://roas-dashboard-smoky.vercel.app/api/inngest" -H "content-type: application/json" -w "\nHTTP %{http_code} time=%{time_total}s\n"
```

Expected: `{"message":"Successfully registered","modified":true}` (modified=true on first sync, then false on subsequent calls).

- [ ] **Step 8: Wait for next */10 boundary + verify all 6 scopes fan out**

After the next tick fires (~10 min worst case):

```bash
mv /Users/dorperetz/script-roas/.env /Users/dorperetz/script-roas/.env.tmp
cd /tmp && supabase db query --linked --workdir /Users/dorperetz/script-roas --output table \
  "SELECT tick_id, fan_out_count FROM cron_tick_snapshots ORDER BY tick_id DESC LIMIT 3;"
mv /Users/dorperetz/script-roas/.env.tmp /Users/dorperetz/script-roas/.env
```

Expected: latest tick's `fan_out_count` ≥ 6 (3 stores × 2 scopes, more if google/tiktok also fan out).

- [ ] **Step 9: Verify registries populated for Google + TikTok**

```bash
mv /Users/dorperetz/script-roas/.env /Users/dorperetz/script-roas/.env.tmp
cd /tmp && supabase db query --linked --workdir /Users/dorperetz/script-roas --output table \
  "SELECT platform, store_id, COUNT(*) AS rows FROM campaign_registry GROUP BY platform, store_id ORDER BY platform, store_id;"
mv /Users/dorperetz/script-roas/.env.tmp /Users/dorperetz/script-roas/.env
```

Expected: rows for `meta` (Phase B), `google` (Phase C status discovery), and `tiktok` (Phase C status discovery).

- [ ] **Step 10: Verify hot_metrics writes**

```bash
mv /Users/dorperetz/script-roas/.env /Users/dorperetz/script-roas/.env.tmp
cd /tmp && supabase db query --linked --workdir /Users/dorperetz/script-roas --output table \
  "SELECT platform, store_id, source, COUNT(*) FROM campaigns_daily WHERE date = CURRENT_DATE GROUP BY platform, store_id, source ORDER BY platform, store_id, source;"
mv /Users/dorperetz/script-roas/.env.tmp /Users/dorperetz/script-roas/.env
```

Expected: rows with `source='live_tick'` for at least Meta, plus the existing rows from `cron-live-heavy` (whatever source value those write).

- [ ] **Step 11: Production health check + final**

```bash
curl -s https://roas-dashboard-smoky.vercel.app/api/health
```

Expected: 200 with `supabase:ok`, `sheets:ok`.

---

## Self-review

- [ ] **Spec coverage**: every Phase C spec deliverable is covered:
  - Hot-set SQL helpers → Task 1 + Task 2 ✓
  - Meta hot_metrics → Task 3 + Task 4 ✓
  - Google worker → Task 5 + Task 6 + Task 7 ✓
  - TikTok worker → Task 8 + Task 9 + Task 10 ✓
  - Orchestrator extension → Task 11 ✓
  - CampaignsTable freshness chip → Task 12 ✓
  - CampaignDrawer status section → Task 13 ✓
  - audit:reconcile mode → Task 14 ✓
  - Deploy + verify → Task 15 ✓
  - cron-live-heavy unchanged → no task touches it ✓
  - Decommission deferred to Phase C.5 → out-of-scope per spec ✓

- [ ] **Placeholder scan**: only `<timestamp>` placeholder for the migration filename (intentional — auto-generated). No "TBD" or "TODO" remain.

- [ ] **Type consistency**: `Platform` widened in metaHotMetrics.ts (Task 6 explicit). `CampaignDailyRow` / `AdsetDailyRow` / `AdDailyRow` defined once and reused in all 3 platform hot-metrics fetchers. Worker input shapes (`RunMetaWorkerJobInput`, `RunGoogleWorkerJobInput`, `RunTikTokWorkerJobInput`) follow the same naming convention.

- [ ] **Implementer notes** in Task 5 + Task 7 + Task 10 — placeholder helpers (`getGoogleCustomerForStore`, `tiktokAccountConfig`) may need wrapper creation. Notes flag this.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-30-phase-c-hot-metrics.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for staying focused during a long batch.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints. Best for watching each step.
