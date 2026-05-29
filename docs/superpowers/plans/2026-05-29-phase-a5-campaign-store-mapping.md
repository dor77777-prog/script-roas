# Phase A.5 — Campaign↔Store mapping for shared-advertiser platforms — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the operator tag each TikTok campaign with its target `store_id` so revenue/spend/ROAS are written under the correctly-attributed store rather than silently bucketed under `'uzoshop'` (the legacy single-advertiser assumption).

**Architecture:** Reuse the existing `campaign-product-map` pattern — JSONB blob in `dashboard_state`, cloud-synced via `pushCloudKey`, local-first reads via a `lib/campaignStoreMap.ts` helper. The TikTok fetcher attaches a per-row `store_id` from the map (default `'uzoshop'`); persistCampaignsLive switches to using `row.store_id` instead of the function-arg `storeId`. CampaignsTable gets a Store dropdown for TikTok rows only.

**Tech Stack:** Next.js 15 + React 19, Inngest, Supabase Postgres, Vitest, OKLCH design tokens.

**Reference spec:** [docs/superpowers/specs/2026-05-29-phase-a5-campaign-store-mapping-design.md](../specs/2026-05-29-phase-a5-campaign-store-mapping-design.md)

---

## File Structure

**New (8 files):**
- `dashboard-web/src/lib/campaignStoreMap.ts` — client-side helpers (read/write/resolve, ~80 lines)
- `dashboard-web/src/lib/__tests__/campaignStoreMap.test.ts` — ~6 unit tests
- `dashboard-web/src/lib/inngest/campaignStoreMap.ts` — server-side Supabase reader (~30 lines)
- `dashboard-web/src/lib/inngest/__tests__/campaignStoreMap.test.ts` — ~4 unit tests
- `dashboard-web/src/lib/fetchers/__tests__/tiktokFetcherStoreMapping.test.ts` — 2 tests (split + fallback)
- `dashboard-web/src/lib/inngest/__tests__/persistCampaignsLiveUsesRowStoreId.test.ts` — 1 focused test
- `dashboard-web/src/inngest/functions/__tests__/dataDailyAggregatesTiktokPerStore.test.ts` — 1 focused test
- `dashboard-web/src/components/__tests__/campaignsTableStoreColumnTikTok.dom.test.tsx` — 3 tests

**Modified (8 files):**
- `dashboard-web/src/lib/dashboardStateKeys.ts` — add `'campaign-store-map'` to `ALLOWED_STATE_KEYS`
- `dashboard-web/src/lib/cloudSync.ts` — add `STATE_KEYS` entry + `CHANGE_EVENTS` entry
- `dashboard-web/src/lib/fetchers/tiktok.ts` — attach `store_id` to each returned row from the map
- `dashboard-web/src/lib/inngest/persistCampaignsLive.ts` — prefer `row.store_id` over arg `storeId`
- `dashboard-web/src/inngest/functions/cronDaily.ts` — recompute `data_daily.tt_spend_cad` per-(date, store_id) after persist
- `dashboard-web/src/components/CampaignsTable.tsx` — new Store column for TikTok rows
- `dashboard-web/src/app/operator/page.tsx` — historical-attribution disclaimer chip
- `docs/ROAS-Dashboard-User-Manual.md` — bump 2.1.15 → 2.1.16 + Phase A.5 changelog
- `docs/ARCHITECTURE.md` — extend §25 with §25.11 (Phase A.5)

---

## Task 1: Allowlist + cloud-sync wiring

The new key must be accepted by `/api/dashboard-state` POST + auto-sync round-trips. Without this, `pushCloudKey` silently drops the write.

**Files:**
- Modify: `dashboard-web/src/lib/dashboardStateKeys.ts`
- Modify: `dashboard-web/src/lib/cloudSync.ts`

- [ ] **Step 1: Add the key to the server-side allowlist**

In `dashboardStateKeys.ts`, append `'campaign-store-map'` to `ALLOWED_STATE_KEYS` (the as-const array around line 26):

```typescript
export const ALLOWED_STATE_KEYS = [
  'billing-recurring',
  'billing-onetime',
  'annotations',
  'monthly-revenue-goal',
  'insight-states',
  'campaign-optimized',
  'campaign-product-map',
  'campaigns-column-visibility',
  'campaign-store-map',
] as const;
```

- [ ] **Step 2: Add to client-side STATE_KEYS + CHANGE_EVENTS**

In `cloudSync.ts` around line 47 (STATE_KEYS) + line 60 (CHANGE_EVENTS):

```typescript
const STATE_KEYS = [
  'roas-dashboard:billing-recurring',
  'roas-dashboard:billing-onetime',
  'roas-dashboard:annotations',
  'roas-dashboard:monthly-revenue-goal',
  'roas-dashboard:insight-states',
  'roas-dashboard:campaign-optimized',
  'roas-dashboard:campaign-product-map',
  'roas-dashboard:campaigns-column-visibility',
  'roas-dashboard:campaign-store-map',
] as const;
```

```typescript
const CHANGE_EVENTS: Record<StateKey, string> = {
  // ... existing entries ...
  'roas-dashboard:campaign-store-map': 'roas-campaign-store-map-changed',
};
```

- [ ] **Step 3: Run full suite to confirm no regression**

```bash
cd dashboard-web && npm test
```

Expected: 1370/1370 (matches baseline post-Phase-A).

- [ ] **Step 4: Commit**

```bash
git add dashboard-web/src/lib/dashboardStateKeys.ts dashboard-web/src/lib/cloudSync.ts
git commit -m "feat(state): allowlist 'campaign-store-map' for cloud-sync + API

Foundation for Phase A.5 — TikTok campaign↔store mapping. The new
dashboard_state key joins the existing campaign-product-map / billing /
annotations pattern: same allowlist gate at the API boundary, same
auto-sync STATE_KEYS roster on the client, same CHANGE_EVENTS broadcast.

Spec: docs/superpowers/specs/2026-05-29-phase-a5-campaign-store-mapping-design.md (Phase A.5)"
```

---

## Task 2: Client helpers (TDD) — `campaignStoreMap.ts`

Mirror `campaignProductMap.ts` — same shape, same patterns. The map is `Record<string, string>` (key → storeId).

**Files:**
- Create: `dashboard-web/src/lib/campaignStoreMap.ts`
- Create: `dashboard-web/src/lib/__tests__/campaignStoreMap.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// dashboard-web/src/lib/__tests__/campaignStoreMap.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  campaignStoreKey,
  readCampaignStoreMap,
  writeCampaignStoreMap,
  resolveStoreForCampaign,
} from '../campaignStoreMap';

vi.mock('../cloudSync', () => ({ pushCloudKey: vi.fn() }));

describe('campaignStoreKey', () => {
  it('returns `<platform>::<advertiser>::<campaign>`', () => {
    expect(campaignStoreKey('tiktok', '12345', '67890')).toBe('tiktok::12345::67890');
  });

  it('different platforms produce different keys for same campaign id', () => {
    expect(campaignStoreKey('tiktok', '1', '99')).not.toBe(campaignStoreKey('meta', '1', '99'));
  });
});

describe('readCampaignStoreMap', () => {
  beforeEach(() => window.localStorage.clear());

  it('returns {} when nothing stored', () => {
    expect(readCampaignStoreMap()).toEqual({});
  });

  it('parses valid JSON and filters non-string values', () => {
    window.localStorage.setItem(
      'roas-dashboard:campaign-store-map',
      JSON.stringify({ 'tiktok::1::2': 'uzoshop', 'tiktok::1::3': 42, 'tiktok::1::4': null }),
    );
    expect(readCampaignStoreMap()).toEqual({ 'tiktok::1::2': 'uzoshop' });
  });

  it('returns {} for malformed JSON', () => {
    window.localStorage.setItem('roas-dashboard:campaign-store-map', '{not json');
    expect(readCampaignStoreMap()).toEqual({});
  });

  it('returns {} for non-object JSON (e.g. array)', () => {
    window.localStorage.setItem('roas-dashboard:campaign-store-map', JSON.stringify(['uzoshop']));
    expect(readCampaignStoreMap()).toEqual({});
  });
});

describe('writeCampaignStoreMap', () => {
  beforeEach(() => window.localStorage.clear());

  it('writes to localStorage AND dispatches roas-campaign-store-map-changed', async () => {
    const dispatched: string[] = [];
    const listener = (e: Event) => dispatched.push(e.type);
    window.addEventListener('roas-campaign-store-map-changed', listener);
    writeCampaignStoreMap({ 'tiktok::1::2': 'usmile360' });
    const raw = window.localStorage.getItem('roas-dashboard:campaign-store-map');
    expect(raw).toBe(JSON.stringify({ 'tiktok::1::2': 'usmile360' }));
    expect(dispatched).toContain('roas-campaign-store-map-changed');
    window.removeEventListener('roas-campaign-store-map-changed', listener);
  });
});

describe('resolveStoreForCampaign', () => {
  it('returns mapped store when key exists', () => {
    expect(
      resolveStoreForCampaign({ 'tiktok::1::2': 'usmile360' }, 'tiktok', '1', '2', 'uzoshop'),
    ).toBe('usmile360');
  });

  it('falls back to default when key missing', () => {
    expect(resolveStoreForCampaign({}, 'tiktok', '1', '99', 'uzoshop')).toBe('uzoshop');
  });
});
```

- [ ] **Step 2: Run targeted tests — confirm RED**

```bash
cd dashboard-web && npm run test:components -- src/lib/__tests__/campaignStoreMap.test.ts
```

Expected: all tests FAIL (module not found).

(Note: the test uses `window.localStorage` so it goes through the DOM config — `test:components`. Confirm by checking `vitest.config.dom.ts` matches `src/lib/**/__tests__/*.test.ts` — if it doesn't, move tests under a `.dom.test.ts` suffix or use the node config and skip DOM bits via `globalThis as any`.)

If the dom config doesn't pick up `src/lib/__tests__/` paths, switch the filename to `campaignStoreMap.dom.test.ts` and re-run via `test:components`.

- [ ] **Step 3: Implement `campaignStoreMap.ts`**

```typescript
// dashboard-web/src/lib/campaignStoreMap.ts
//
// Phase A.5 — TikTok campaign↔store mapping helpers (client-side).
// Mirrors campaignProductMap.ts: localStorage + pushCloudKey + window event.

import { pushCloudKey } from './cloudSync';

const STORAGE_KEY = 'roas-dashboard:campaign-store-map' as const;
const CHANGE_EVENT = 'roas-campaign-store-map-changed' as const;

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
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
    pushCloudKey(STORAGE_KEY, map, { immediate: true });
  } catch {
    // quota / private mode — ignore
  }
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

- [ ] **Step 4: Run targeted tests — confirm GREEN**

Same command as Step 2. Expected: all ~7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard-web/src/lib/campaignStoreMap.ts dashboard-web/src/lib/__tests__/campaignStoreMap.test.ts
git commit -m "feat(state): campaignStoreMap client helpers — read/write/resolve

Mirrors campaignProductMap.ts. Three exports:
  - campaignStoreKey(platform, advertiserId, campaignId) — composite key
  - readCampaignStoreMap() / writeCampaignStoreMap(map) — localStorage I/O
    with cloud-sync auto-push + window event broadcast
  - resolveStoreForCampaign(map, platform, advertiserId, campaignId, default)
    — lookup with safe fallback

Spec: docs/superpowers/specs/2026-05-29-phase-a5-campaign-store-mapping-design.md
Plan: docs/superpowers/plans/2026-05-29-phase-a5-campaign-store-mapping.md (Task 2)"
```

---

## Task 3: Server-side reader (TDD) — `lib/inngest/campaignStoreMap.ts`

Cron handlers can't reach `localStorage`. They read the same JSONB blob directly from Supabase.

**Files:**
- Create: `dashboard-web/src/lib/inngest/campaignStoreMap.ts`
- Create: `dashboard-web/src/lib/inngest/__tests__/campaignStoreMap.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// dashboard-web/src/lib/inngest/__tests__/campaignStoreMap.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadCampaignStoreMapFromSupabase } from '../campaignStoreMap';

const maybeSingleMock = vi.fn();

vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: maybeSingleMock,
        }),
      }),
    }),
  }),
}));

beforeEach(() => maybeSingleMock.mockReset());

describe('loadCampaignStoreMapFromSupabase', () => {
  it('returns the JSONB value as a string-to-string map', async () => {
    maybeSingleMock.mockResolvedValue({
      data: { value: { 'tiktok::1::2': 'uzoshop', 'tiktok::1::3': 'usmile360' } },
      error: null,
    });
    expect(await loadCampaignStoreMapFromSupabase()).toEqual({
      'tiktok::1::2': 'uzoshop',
      'tiktok::1::3': 'usmile360',
    });
  });

  it('returns {} when no row exists', async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    expect(await loadCampaignStoreMapFromSupabase()).toEqual({});
  });

  it('filters non-string values defensively', async () => {
    maybeSingleMock.mockResolvedValue({
      data: { value: { 'tiktok::1::2': 'uzoshop', 'tiktok::1::3': 42 } },
      error: null,
    });
    expect(await loadCampaignStoreMapFromSupabase()).toEqual({ 'tiktok::1::2': 'uzoshop' });
  });

  it('returns {} on Supabase error (swallows + console.warn)', async () => {
    maybeSingleMock.mockRejectedValue(new Error('connection refused'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await loadCampaignStoreMapFromSupabase()).toEqual({});
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run targeted tests — confirm RED**

```bash
cd dashboard-web && npm test -- src/lib/inngest/__tests__/campaignStoreMap.test.ts
```

- [ ] **Step 3: Implement `lib/inngest/campaignStoreMap.ts`**

```typescript
// dashboard-web/src/lib/inngest/campaignStoreMap.ts
//
// Phase A.5 — Server-side reader for the campaign-store-map JSONB blob.
// Used by cron fetchers + persisters to resolve per-row store_id without
// reaching into localStorage (which doesn't exist server-side).

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
      Object.entries(parsed as Record<string, unknown>).filter(([, v]) => typeof v === 'string'),
    ) as Record<string, string>;
  } catch (e) {
    console.warn('[loadCampaignStoreMapFromSupabase] read failed:', e);
    return {};
  }
}
```

- [ ] **Step 4: Run targeted tests — confirm GREEN**

- [ ] **Step 5: Commit**

```bash
git add dashboard-web/src/lib/inngest/campaignStoreMap.ts dashboard-web/src/lib/inngest/__tests__/campaignStoreMap.test.ts
git commit -m "feat(inngest): server-side loadCampaignStoreMapFromSupabase

Reads the JSONB blob from dashboard_state (key='campaign-store-map') via
the admin client. Filters non-string values defensively; returns {} on
missing row or Supabase error so cron handlers degrade to the default
attribution (uzoshop for TikTok) rather than throwing.

Spec: docs/superpowers/specs/2026-05-29-phase-a5-campaign-store-mapping-design.md
Plan: docs/superpowers/plans/2026-05-29-phase-a5-campaign-store-mapping.md (Task 3)"
```

---

## Task 4: TikTok fetcher rewrite — attach per-row `store_id`

`fetchTikTokAdInsights` currently returns rows that callers attribute under whichever `storeId` was looped through. After this task, each row carries its own `store_id` (mapped or fallback).

**Files:**
- Modify: `dashboard-web/src/lib/fetchers/tiktok.ts` — extend `TikTokAdRow`, add the store_id attachment after fetch
- Create: `dashboard-web/src/lib/fetchers/__tests__/tiktokFetcherStoreMapping.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// dashboard-web/src/lib/fetchers/__tests__/tiktokFetcherStoreMapping.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

vi.mock('@/lib/inngest/campaignStoreMap', () => ({
  loadCampaignStoreMapFromSupabase: vi.fn(),
}));

const fetchSpy = vi.fn();

import { fetchTikTokAdInsights } from '../tiktok';
import { loadCampaignStoreMapFromSupabase } from '@/lib/inngest/campaignStoreMap';

beforeEach(() => {
  process.env.UZOSHOP_TIKTOK_ACCESS_TOKEN = 'tok';
  process.env.UZOSHOP_TIKTOK_ADVERTISER_ID = '999';
  vi.stubGlobal('fetch', fetchSpy);
  fetchSpy.mockReset();
  (loadCampaignStoreMapFromSupabase as ReturnType<typeof vi.fn>).mockReset();
});

afterEach(() => {
  delete process.env.UZOSHOP_TIKTOK_ACCESS_TOKEN;
  delete process.env.UZOSHOP_TIKTOK_ADVERTISER_ID;
  vi.unstubAllGlobals();
});

describe('fetchTikTokAdInsights store_id attribution', () => {
  it('attaches mapped store_id when key exists in store map', async () => {
    (loadCampaignStoreMapFromSupabase as ReturnType<typeof vi.fn>).mockResolvedValue({
      'tiktok::999::C1': 'usmile360',
      'tiktok::999::C2': 'uzoshop',
    });
    fetchSpy.mockResolvedValueOnce(buildTikTokInsightsResponse([
      { campaign_id: 'C1', ad_id: 'A1', spend: '10' },
      { campaign_id: 'C2', ad_id: 'A2', spend: '20' },
    ]));
    const rows = await fetchTikTokAdInsights('uzoshop', '2026-05-29');
    expect(rows.find(r => r.adId === 'A1')?.storeId).toBe('usmile360');
    expect(rows.find(r => r.adId === 'A2')?.storeId).toBe('uzoshop');
  });

  it('falls back to the function-arg storeId (uzoshop) when campaign not in map', async () => {
    (loadCampaignStoreMapFromSupabase as ReturnType<typeof vi.fn>).mockResolvedValue({});
    fetchSpy.mockResolvedValueOnce(buildTikTokInsightsResponse([
      { campaign_id: 'C3', ad_id: 'A3', spend: '5' },
    ]));
    const rows = await fetchTikTokAdInsights('uzoshop', '2026-05-29');
    expect(rows[0].storeId).toBe('uzoshop');
  });
});

function buildTikTokInsightsResponse(rows: Array<{ campaign_id: string; ad_id: string; spend: string }>) {
  const body = {
    code: 0,
    data: {
      list: rows.map(r => ({
        dimensions: { ad_id: r.ad_id, campaign_id: r.campaign_id, adgroup_id: 'AG' },
        metrics: { spend: r.spend, impressions: '0', clicks: '0', conversion: '0', purchase: '0', complete_payment_roas: '0' },
      })),
    },
  };
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
  } as unknown as Response;
}
```

(The fixture shape mirrors the real TikTok `/report/integrated/get/` response — confirm field names against existing `tiktok.test.ts` if the shape drifts.)

- [ ] **Step 2: Run targeted tests — confirm RED**

```bash
cd dashboard-web && npm test -- src/lib/fetchers/__tests__/tiktokFetcherStoreMapping.test.ts
```

Expected: tests fail because `TikTokAdRow` doesn't have `storeId` field yet.

- [ ] **Step 3: Extend `TikTokAdRow` type + wire the map**

In `tiktok.ts`:

a) Around line 67 (`TikTokAdRow` type definition), add a new field:

```typescript
export type TikTokAdRow = {
  // ... existing fields ...

  /** Phase A.5 — store_id from campaign-store-map (or fallback storeId arg).
   *  Persisters use this instead of their function-arg storeId for TikTok rows. */
  storeId: string;
};
```

b) Add an import at the top:

```typescript
import { loadCampaignStoreMapFromSupabase } from '@/lib/inngest/campaignStoreMap';
import { resolveStoreForCampaign } from '@/lib/campaignStoreMap';
```

c) Inside `fetchTikTokAdInsights`, after rows are parsed but before they're returned, attach the resolved store_id. Find the return statement (it constructs rows from the API response) and replace it with:

```typescript
const storeMap = await loadCampaignStoreMapFromSupabase();
const rowsWithStoreId = rows.map(r => ({
  ...r,
  storeId: resolveStoreForCampaign(storeMap, 'tiktok', advertiserId, r.campaignId, storeId),
}));
return rowsWithStoreId;
```

Where `advertiserId` is the value already read from `process.env[upper + '_TIKTOK_ADVERTISER_ID']` at the top of the function (line ~125 in the existing code).

- [ ] **Step 4: Run targeted tests — confirm GREEN**

- [ ] **Step 5: Run full suite — confirm no regression**

```bash
cd dashboard-web && npm test
```

Expected: 1372/1372 (1370 baseline + 2 new). Existing TikTok tests should still pass — the type widening is additive.

- [ ] **Step 6: Commit**

```bash
git add dashboard-web/src/lib/fetchers/tiktok.ts dashboard-web/src/lib/fetchers/__tests__/tiktokFetcherStoreMapping.test.ts
git commit -m "feat(fetchers): TikTok rows carry resolved per-row storeId

Each TikTokAdRow now ships with a storeId field resolved via
loadCampaignStoreMapFromSupabase + resolveStoreForCampaign. Mapped
campaigns get their tagged store; unmapped campaigns fall back to
the function-arg storeId (currently uzoshop for the only TikTok
advertiser).

Type widening is additive — existing callers continue to work, and
the next task (persistCampaignsLive) starts honoring row.storeId.

Spec: docs/superpowers/specs/2026-05-29-phase-a5-campaign-store-mapping-design.md
Plan: docs/superpowers/plans/2026-05-29-phase-a5-campaign-store-mapping.md (Task 4)"
```

---

## Task 5: `persistCampaignsLive` uses `row.storeId`

The persister currently writes every row under `storeId` (the function arg). After this task, TikTok rows are written under `row.storeId`; Meta/Google still use the arg.

**Files:**
- Modify: `dashboard-web/src/lib/inngest/persistCampaignsLive.ts` (TikTok-row branches around lines 258-310 + 392)
- Create: `dashboard-web/src/lib/inngest/__tests__/persistCampaignsLiveUsesRowStoreId.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// dashboard-web/src/lib/inngest/__tests__/persistCampaignsLiveUsesRowStoreId.test.ts
import { describe, it, expect, vi } from 'vitest';
import { persistCampaignsLive, type TikTokAdLiveRow } from '../persistCampaignsLive';

const upsertCalls: Array<{ table: string; rows: Array<Record<string, unknown>> }> = [];

function makeAdminMock() {
  return {
    from: (table: string) => ({
      upsert: async (rows: Array<Record<string, unknown>>) => {
        upsertCalls.push({ table, rows });
        return { error: null };
      },
    }),
  };
}

describe('persistCampaignsLive — TikTok rows use row.storeId', () => {
  it('writes campaigns_daily rows under the storeId from each row', async () => {
    upsertCalls.length = 0;
    const tiktokAdRows: TikTokAdLiveRow[] = [
      { storeId: 'uzoshop', campaignId: 'C1', adGroupId: 'AG1', adId: 'A1', campaignName: 'X', spend: 10, impressions: 100, clicks: 5, conversions: 1, conversionValue: 50, complete_payment_roas: 5, last_status_check: '2026-05-29' } as TikTokAdLiveRow,
      { storeId: 'usmile360', campaignId: 'C2', adGroupId: 'AG2', adId: 'A2', campaignName: 'Y', spend: 20, impressions: 200, clicks: 10, conversions: 2, conversionValue: 100, complete_payment_roas: 5, last_status_check: '2026-05-29' } as TikTokAdLiveRow,
    ];

    await persistCampaignsLive({
      storeId: 'uzoshop', // fn-arg — only the unmapped row should land here
      dateStr: '2026-05-29',
      admin: makeAdminMock() as unknown as ReturnType<typeof import('@supabase/supabase-js').createClient>,
      getFx: async () => 1,
      meta: { adsetRows: [], adRows: [], budgets: { currency: 'USD', campaigns: {}, adSets: {} } },
      google: { adGroupRows: [], adRows: [] },
      tiktok: { adRows: tiktokAdRows },
    });

    const campaignsDailyCall = upsertCalls.find(c => c.table === 'campaigns_daily');
    expect(campaignsDailyCall).toBeDefined();
    const tiktokRows = campaignsDailyCall!.rows.filter(r => r.platform === 'tiktok');
    const c1Row = tiktokRows.find(r => r.campaign_id === 'C1');
    const c2Row = tiktokRows.find(r => r.campaign_id === 'C2');
    expect(c1Row?.store_id).toBe('uzoshop');
    expect(c2Row?.store_id).toBe('usmile360');
  });
});
```

- [ ] **Step 2: Run targeted test — confirm RED**

```bash
cd dashboard-web && npm test -- src/lib/inngest/__tests__/persistCampaignsLiveUsesRowStoreId.test.ts
```

Expected: fails because all rows currently get `store_id: storeId` (the arg).

- [ ] **Step 3: Edit `persistCampaignsLive.ts`**

For TikTok-row builders (locate by searching for `platform: 'tiktok'` — there are 2 sites: one for `campaigns_daily`, one for `ads_daily`), change `store_id: storeId` to `store_id: r.storeId ?? storeId`.

Concretely, find each occurrence of `store_id: storeId,` that's inside a `.map(r => ...)` building a TikTok row, and swap to:

```typescript
store_id: r.storeId ?? storeId,
```

Leave Meta/Google sites untouched.

- [ ] **Step 4: Re-run targeted test — confirm GREEN**

- [ ] **Step 5: Run full suite — confirm no regression**

```bash
cd dashboard-web && npm test
```

Expected: 1373/1373.

- [ ] **Step 6: Commit**

```bash
git add dashboard-web/src/lib/inngest/persistCampaignsLive.ts dashboard-web/src/lib/inngest/__tests__/persistCampaignsLiveUsesRowStoreId.test.ts
git commit -m "feat(inngest): persistCampaignsLive honors row.storeId for TikTok

TikTok-row upsert payloads (campaigns_daily + ads_daily) now write
store_id from each row's storeId (set by the fetcher in Task 4)
rather than the function-arg storeId. Falls back to the arg if
row.storeId is absent — preserves behavior for non-mapped callers
and Meta/Google branches.

Spec: docs/superpowers/specs/2026-05-29-phase-a5-campaign-store-mapping-design.md
Plan: docs/superpowers/plans/2026-05-29-phase-a5-campaign-store-mapping.md (Task 5)"
```

---

## Task 6: `cron-daily` aggregates `data_daily.tt_spend_cad` per-store

After per-row writes land in `campaigns_daily`, the store-level aggregate must reflect the split. cron-daily's existing flow writes `data_daily.tt_spend_cad` from a single per-store TikTok fetch; we now need to SUM from the per-row `campaigns_daily` slices.

**Files:**
- Modify: `dashboard-web/src/inngest/functions/cronDaily.ts` — after the TikTok branch's campaigns_daily upsert (~line 1180), add a per-(date, store_id) re-aggregation UPDATE on data_daily
- Create: `dashboard-web/src/inngest/functions/__tests__/dataDailyAggregatesTiktokPerStore.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// dashboard-web/src/inngest/functions/__tests__/dataDailyAggregatesTiktokPerStore.test.ts
import { describe, it, expect, vi } from 'vitest';

// Mock the BUC / freshness paths so the test focuses on the aggregation behavior.
vi.mock('@/lib/notifications/metaBucUsage', () => ({
  getMetaBucUsageForStore: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/inngest/freshness', () => ({
  recordFreshness: vi.fn(),
}));
vi.mock('@/lib/notifications/tokenFailures', () => ({
  notifyTokenFailure: vi.fn(),
}));
// ... include other mocks per the existing cronDaily.test.ts pattern ...

describe('cron-daily tt_spend_cad aggregation per-store', () => {
  it('UPDATEs data_daily.tt_spend_cad from per-store SUM of campaigns_daily', async () => {
    // Setup: stub Supabase admin so the UPDATE call is captured.
    // Inject 3 TikTok rows: 2 for uzoshop ($10 + $30 = $40), 1 for usmile360 ($15).
    // Run runDailyForStore('uzoshop', ...).
    // Assert: at least 2 data_daily updates fired —
    //   one with { store_id: 'uzoshop', tt_spend_cad: 40 }
    //   one with { store_id: 'usmile360', tt_spend_cad: 15 }
    // (The per-store update path replaces a single dataDaily upsert that
    //  blindly set tt_spend_cad from the storeId-arg's fetch result.)
    //
    // Use the existing cronDaily.test.ts fixture pattern for the Supabase
    // admin mock — see makeSupabaseAdminStub() in cronDaily.test.ts:~70.
  });
});
```

(The test scaffolding mirrors `cronDaily.test.ts`'s mock pattern. Read that file first and copy the `makeSupabaseAdminStub` factory. Fill in the assertion bodies with the actual upsert capture from the stub.)

- [ ] **Step 2: Run targeted test — confirm RED**

```bash
cd dashboard-web && npm test -- src/inngest/functions/__tests__/dataDailyAggregatesTiktokPerStore.test.ts
```

- [ ] **Step 3: Add the per-store aggregation to `cronDaily.ts`**

After the TikTok campaigns_daily upsert (line ~1180), add (still inside the `step.run` for persistence, so retries see consistent state):

```typescript
// Phase A.5 — re-aggregate data_daily.tt_spend_cad per store_id from the
// just-written per-row campaigns_daily slices. Replaces the prior single-
// per-store-arg path which silently buried multi-store TikTok spend under
// the calling storeId (the legacy STORES_WITH_TIKTOK assumption).
const { error: aggErr } = await admin.rpc('agg_tiktok_spend_per_store_for_date', {
  d: dateStr,
});
if (aggErr) {
  // soft-fail; the per-row data is correct in campaigns_daily and
  // the Phase D dashboard reads from there. data_daily.tt_spend_cad is
  // the legacy single-number aggregate; staleness here is observable
  // via /operator and corrected on the next cron-daily.
  console.warn(`cron-daily ${storeId} ${dateStr}: tt_spend_cad per-store agg failed: ${aggErr.message}`);
}
```

This calls a Postgres function. Define it via a new migration:

`supabase/migrations/20260530120000_add_tt_spend_agg_function.sql`:

```sql
-- Phase A.5 — per-store TikTok spend aggregation, called by cron-daily after
-- per-row campaigns_daily writes complete. Idempotent: SUM(spend_cad) is
-- deterministic given the campaigns_daily slice for that date.

CREATE OR REPLACE FUNCTION agg_tiktok_spend_per_store_for_date(d date)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE data_daily dd
     SET tt_spend_cad = sub.s
    FROM (
      SELECT date, store_id, COALESCE(SUM(spend_cad), 0)::numeric AS s
        FROM campaigns_daily
       WHERE date = d AND platform = 'tiktok'
       GROUP BY date, store_id
    ) sub
   WHERE dd.date = sub.date AND dd.store_id = sub.store_id;
$$;
```

- [ ] **Step 4: Apply the migration to production (manual, via the Phase A workaround)**

```bash
mv .env .env.tmp
cd /tmp && supabase db push --workdir /Users/dorperetz/script-roas --yes
mv .env.tmp .env
```

(The Phase A memory file has this workaround documented — root `.env` has 2 keys with invalid chars for the supabase CLI parser.)

- [ ] **Step 5: Re-run targeted test — confirm GREEN**

The test uses an in-memory Supabase stub; the RPC mock can return `{ error: null }` and the test just confirms the call site fired with the right args. Mock the `.rpc` method on the stub.

- [ ] **Step 6: Run full suite + commit**

```bash
cd dashboard-web && npm test && cd .. && \
git add dashboard-web/src/inngest/functions/cronDaily.ts \
        dashboard-web/src/inngest/functions/__tests__/dataDailyAggregatesTiktokPerStore.test.ts \
        supabase/migrations/20260530120000_add_tt_spend_agg_function.sql && \
git commit -m "feat(cron-daily): re-aggregate data_daily.tt_spend_cad per store_id

After the per-row campaigns_daily writes (Task 5), data_daily's
store-level tt_spend_cad must be re-summed from the per-row slices so
the dashboard's TodayLive / Hero / GoalTracker see correctly-attributed
TikTok spend per store. New SQL function agg_tiktok_spend_per_store_for_date
runs inside the same persist step.run for idempotency on retries.

Spec: docs/superpowers/specs/2026-05-29-phase-a5-campaign-store-mapping-design.md
Plan: docs/superpowers/plans/2026-05-29-phase-a5-campaign-store-mapping.md (Task 6)"
```

---

## Task 7: CampaignsTable Store column for TikTok rows

The operator's tagging surface. Dropdown per TikTok row; sets a value in the campaign-store-map.

**Files:**
- Modify: `dashboard-web/src/components/CampaignsTable.tsx`
- Create: `dashboard-web/src/components/__tests__/campaignsTableStoreColumnTikTok.dom.test.tsx`

- [ ] **Step 1: Write the failing tests**

```typescript
// dashboard-web/src/components/__tests__/campaignsTableStoreColumnTikTok.dom.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CampaignsTable } from '../CampaignsTable';

const writeMock = vi.fn();
vi.mock('@/lib/campaignStoreMap', () => ({
  readCampaignStoreMap: () => ({ 'tiktok::999::C1': 'usmile360' }),
  writeCampaignStoreMap: writeMock,
  campaignStoreKey: (p: string, a: string, c: string) => `${p}::${a}::${c}`,
}));

beforeEach(() => {
  window.localStorage.clear();
  writeMock.mockReset();
  process.env.UZOSHOP_TIKTOK_ADVERTISER_ID = '999';
});

const sampleRows = [
  { id: 'C1', platform: 'tiktok', name: 'Camp 1', storeId: 'usmile360', spend: 10 },
  { id: 'C2', platform: 'tiktok', name: 'Camp 2', storeId: 'uzoshop', spend: 20 },
  { id: 'C3', platform: 'meta',   name: 'Meta C', storeId: 'uzoshop', spend: 5 },
];

describe('CampaignsTable — Store column for TikTok', () => {
  it('renders a Store dropdown for TikTok rows but not Meta', () => {
    render(<CampaignsTable rows={sampleRows} /* ... other required props ... */ />);
    const c1Cell = screen.getByTestId('store-cell-C1');  // give the cell a stable data-testid in the component
    expect(c1Cell.textContent).toMatch(/usmile360/);
    expect(screen.queryByTestId('store-cell-C3')).toBeNull();
  });

  it('changing the dropdown calls writeCampaignStoreMap with the new value', () => {
    render(<CampaignsTable rows={sampleRows} /* ... */ />);
    const select = screen.getByTestId('store-select-C2');
    fireEvent.change(select, { target: { value: 'usmile360' } });
    expect(writeMock).toHaveBeenCalledWith(
      expect.objectContaining({ 'tiktok::999::C2': 'usmile360' }),
    );
  });

  it('an unmapped TikTok row renders "(unmapped)" with amber tint', () => {
    render(<CampaignsTable rows={sampleRows} /* ... */ />);
    const c2Cell = screen.getByTestId('store-cell-C2');
    expect(c2Cell.textContent).toMatch(/unmapped|usmile|uzoshop/);  // depending on default
    expect(c2Cell.className).toMatch(/orange|amber|status-orange/);  // verify the warning tint
  });
});
```

(The exact props for `CampaignsTable` will need verification against the existing component — read `dashboard-web/src/components/CampaignsTable.tsx` to find the prop shape. The test scaffolding above gives the assertion intent; adjust prop names to match.)

- [ ] **Step 2: Run targeted tests — confirm RED**

```bash
cd dashboard-web && npm run test:components -- src/components/__tests__/campaignsTableStoreColumnTikTok.dom.test.tsx
```

- [ ] **Step 3: Edit `CampaignsTable.tsx`**

a) Import `readCampaignStoreMap`, `writeCampaignStoreMap`, `campaignStoreKey`.

b) Add state via a custom hook that reads the map and subscribes to the `'roas-campaign-store-map-changed'` event:

```tsx
const [storeMap, setStoreMap] = useState(() => readCampaignStoreMap());
useEffect(() => {
  const refresh = () => setStoreMap(readCampaignStoreMap());
  window.addEventListener('roas-campaign-store-map-changed', refresh);
  return () => window.removeEventListener('roas-campaign-store-map-changed', refresh);
}, []);
```

c) In the table row JSX, conditionally render a Store dropdown for TikTok rows:

```tsx
{row.platform === 'tiktok' && (
  <td data-testid={`store-cell-${row.id}`} className={isUnmapped ? 'text-status-orange' : ''}>
    <select
      data-testid={`store-select-${row.id}`}
      value={storeMap[campaignStoreKey('tiktok', advertiserIdFor('tiktok', row), row.id)] ?? '__unmapped__'}
      onChange={(e) => {
        const next = { ...storeMap };
        const k = campaignStoreKey('tiktok', advertiserIdFor('tiktok', row), row.id);
        if (e.target.value === '__unmapped__') {
          delete next[k];
        } else {
          next[k] = e.target.value;
        }
        writeCampaignStoreMap(next);
      }}
      className="text-xs"
    >
      <option value="__unmapped__">(unmapped)</option>
      <option value="uzoshop">uzoshop</option>
      <option value="zolplus">Zol Plus</option>
      <option value="usmile360">360usmile</option>
    </select>
  </td>
)}
```

`advertiserIdFor(platform, row)` is a tiny helper — for TikTok today there's one advertiser, so a literal string from a `STORE_ADVERTISER_IDS` map sourced from `platformsByStore.ts` env reads. Keep it inline as a constant or a helper at the top of CampaignsTable.tsx.

d) Add a column header `'Store'` only when at least one row in the visible set is TikTok.

- [ ] **Step 4: Re-run targeted tests — confirm GREEN**

- [ ] **Step 5: Visually verify in dev**

(Skip if dev server isn't available; the test coverage is sufficient.)

- [ ] **Step 6: Commit**

```bash
git add dashboard-web/src/components/CampaignsTable.tsx \
        dashboard-web/src/components/__tests__/campaignsTableStoreColumnTikTok.dom.test.tsx
git commit -m "feat(ui): CampaignsTable Store column with dropdown for TikTok rows

Adds the per-campaign tagging surface. Dropdown options: uzoshop /
Zol Plus / 360usmile / (unmapped). Visible only on TikTok rows;
Meta + Google rows show no Store cell (they're 1:1).

Changes propagate via writeCampaignStoreMap which fires the
roas-campaign-store-map-changed window event so other components
(and the table itself) re-read on the next tick. Unmapped rows get
text-status-orange tint per OKLCH token convention.

Spec: docs/superpowers/specs/2026-05-29-phase-a5-campaign-store-mapping-design.md
Plan: docs/superpowers/plans/2026-05-29-phase-a5-campaign-store-mapping.md (Task 7)"
```

---

## Task 8: `/operator` disclaimer chip

One sentence explaining the historical attribution gap, dismissible.

**Files:**
- Modify: `dashboard-web/src/app/operator/page.tsx`
- (Optional) Create: `dashboard-web/src/components/operator/HistoricalAttributionChip.tsx` if non-trivial

- [ ] **Step 1: Add an inline `<section>` to operator/page.tsx**

Right above the `MetaBucPanel` section, add:

```tsx
<section className="rounded-md border border-status-orange/30 bg-status-orange/8 px-4 py-3 text-sm">
  <p>
    שורות TikTok היסטוריות (לפני 2026-05-29) משוייכות כולן ל-uzoshop — זו ההנחה
    הישנה מלפני שמיפוי קמפיין↔חנות עלה ב-Phase A.5. השתמש בעמודת "חנות" ב-
    <code>קמפיינים</code> כדי לתייג קמפיינים חדשים. נתונים חדשים יזרמו לחנות הנכונה
    מהtick הבא של cron-live-heavy.
  </p>
</section>
```

(Skip the dedicated component for now — YAGNI. If a second similar chip appears later, extract.)

- [ ] **Step 2: Run the operator-page test suite — confirm no regression**

```bash
cd dashboard-web && npm run test:components -- src/components/operator/__tests__/
```

Expected: all existing tests still pass (no new tests needed for an inline static chip).

- [ ] **Step 3: Commit**

```bash
git add dashboard-web/src/app/operator/page.tsx
git commit -m "feat(operator): historical-attribution disclaimer chip for Phase A.5

One-sentence amber-tinted chip above the Meta BUC panel explaining
that TikTok rows before today's deploy stay under uzoshop, and the new
Store column in CampaignsTable is how the operator tags going forward.

Skipped a dedicated component — YAGNI. If a second similar chip appears
later, extract then.

Spec: docs/superpowers/specs/2026-05-29-phase-a5-campaign-store-mapping-design.md
Plan: docs/superpowers/plans/2026-05-29-phase-a5-campaign-store-mapping.md (Task 8)"
```

---

## Task 9: Docs (User Manual 2.1.16 + Architecture §25.11) + full verification gate + push

The pre-push docs-currency gate will reject if either doc is stale.

**Files:**
- Modify: `docs/ROAS-Dashboard-User-Manual.md` — bump 2.1.15 → 2.1.16 + entry
- Modify: `docs/ARCHITECTURE.md` — add §25.11

- [ ] **Step 1: User Manual changelog**

Bump the version banner from 2.1.15 to 2.1.16 (around line 10). Add a new section above the 2.1.15 entry:

```markdown
### 2.1.16 (2026-05-29) — Phase A.5: TikTok campaign↔store mapping

עד היום ה-TikTok advertiser היחיד שלנו (של uzoshop) הריץ קמפיינים גם עבור usmile360 — אבל
הדשבורד שייך את כל ההכנסות + ההוצאה ל-uzoshop. תוקן ב-Phase A.5:

- **עמודת חנות חדשה ב-קמפיינים** (TikTok בלבד) — תפריט נפתח לכל קמפיין: uzoshop / Zol Plus / 360usmile / (לא ממופה). שינוי שומר ל-cloud מיידית; הסבב הבא של cron-live-heavy כותב את ההוצאה תחת החנות הנכונה.
- **חיווי "(לא ממופה)"** בכתום מסמן קמפיינים שעדיין לא תויגו. ברירת המחדל היא uzoshop (תאימות לאחור).
- **שורות היסטוריות** (לפני 2026-05-29) נשארות תחת uzoshop. אין re-attribution אחורנית. בpanel ה-`/operator` יש chip תזכורת.
- **שום נתון לא נמחק.** אם תייגת קמפיין חדש כ-usmile360, הטיק הבא של cron-live-heavy יכתוב את ה-spend תחת usmile360; cron-daily לאחר חצות יסיים את היום ויעדכן את `data_daily.tt_spend_cad` של שתי החנויות בהתאם.
```

- [ ] **Step 2: Architecture Doc — extend §25**

Add a §25.11 subsection at the end of §25 (just before "## 26" if exists, or end of file):

```markdown
### 25.11 Campaign↔Store mapping (Phase A.5)

TikTok runs a single advertiser for multiple stores (today: uzoshop + usmile360). The legacy data model assumed 1:1 advertiser:store and silently bucketed all rows under the calling `storeId`.

Phase A.5 introduces a JSONB map in `dashboard_state` (key `'campaign-store-map'`) shaped `{ "<platform>::<advertiser>::<campaign>": "<store_id>" }`. Helpers:

- `lib/campaignStoreMap.ts` — client-side localStorage + cloud-sync (mirrors `campaignProductMap.ts`)
- `lib/inngest/campaignStoreMap.ts` — server-side reader for cron handlers

Flow:
1. **Fetcher** (`tiktok.ts` `fetchTikTokAdInsights`) — after fetching rows, attaches `storeId` to each row via `resolveStoreForCampaign(map, 'tiktok', advertiserId, campaignId, defaultStoreId='uzoshop')`.
2. **Persister** (`persistCampaignsLive.ts`) — TikTok rows now upsert under `row.storeId ?? storeId` instead of always using the function-arg storeId. Meta + Google branches unchanged.
3. **Aggregator** (`cronDaily.ts`) — after per-row campaigns_daily writes complete, calls Postgres function `agg_tiktok_spend_per_store_for_date(d)` which re-sums `tt_spend_cad` per (date, store_id) for the date.
4. **UI** (`CampaignsTable.tsx`) — TikTok rows get a Store dropdown. Changes write via `writeCampaignStoreMap()` which broadcasts `roas-campaign-store-map-changed`.

**Historical attribution:** rows before the Phase A.5 deploy stay under uzoshop. The `/operator` page surfaces a one-line disclaimer chip explaining this. No backfill — the historical aggregate is "the value of TikTok activity from the uzoshop advertiser", which is correct under the old model.
```

- [ ] **Step 3: Full verification gate**

```bash
cd dashboard-web && npm test && npm run test:components && npx tsc --noEmit && npm run build
```

All four MUST pass. Expected counts after Phase A.5: ~1376 node tests + ~66 dom tests.

- [ ] **Step 4: Commit docs**

```bash
git add docs/ROAS-Dashboard-User-Manual.md docs/ARCHITECTURE.md
git commit -m "docs(phase-a5): User Manual 2.1.16 + Architecture §25.11 (campaign↔store map)

Operator-facing: explains the new TikTok Store column in CampaignsTable
+ that historical rows stay under uzoshop. Architecture-facing: full
end-to-end flow from JSONB blob → fetcher → persister → per-store
aggregate → dashboard UI.

Spec: docs/superpowers/specs/2026-05-29-phase-a5-campaign-store-mapping-design.md
Plan: docs/superpowers/plans/2026-05-29-phase-a5-campaign-store-mapping.md (Task 9)"
```

- [ ] **Step 5: Push to origin**

```bash
git push origin main
```

Wait for Vercel deploy.

- [ ] **Step 6: Smoke-test in prod**

Visit `https://roas-dashboard-smoky.vercel.app/operator` — confirm the new disclaimer chip is visible.

Visit `https://roas-dashboard-smoky.vercel.app/?tab=campaigns` (or the equivalent route for the Campaigns tab) and confirm:
1. TikTok rows have a Store dropdown
2. Meta/Google rows do NOT
3. Changing a dropdown immediately reflects in localStorage (DevTools)

- [ ] **Step 7: Update memory**

Add to `~/.claude/projects/-Users-dorperetz-script-roas/memory/MEMORY.md`:

```markdown
- [Phase A.5 SHIPPED 2026-05-29](project_phase_a5_shipped.md) — TikTok campaign↔store mapping (operator tags via CampaignsTable Store dropdown). Spec docs/superpowers/specs/2026-05-29-phase-a5-campaign-store-mapping-design.md
```

Create `project_phase_a5_shipped.md` with the final commit SHAs + acceptance note.

---

## Acceptance summary (Phase A.5 complete when)

1. ✅ Operator can tag any TikTok campaign in CampaignsTable via Store dropdown.
2. ✅ A campaign tagged "usmile360" produces a `campaigns_daily` row with `store_id='usmile360'` from the next cron-live-heavy tick onward.
3. ✅ The `data_daily.tt_spend_cad` for usmile360 reflects the sum of `tt_spend` from campaigns tagged to usmile (after cron-daily runs).
4. ✅ All ~7 new tests pass + the ~1,370 baseline tests still pass.
5. ✅ `/operator` shows the historical disclaimer chip.
6. ✅ User Manual 2.1.16 published.
7. ✅ Architecture Doc §25.11 published.
