# Ads-Off — Phase 1 (Control) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the foundation of the ads-off feature — the `store_ad_state` table, the central `adState` helpers, the reader, and the `/operator` toggle matrix — so the operator can turn advertising off per (store, platform). Nothing else reacts yet (display/fetch/alerts come in Phases 2–4).

**Architecture:** A small `store_ad_state(store_id, platform, enabled)` table (missing row ⇒ ON, so default = identical-to-today). One pure helper module `lib/adState.ts` is the single source of truth (`isAdsEnabled` / `applicablePlatforms` / `tiktokAccountFetchEnabled`). A paginated reader loads it into an `AdStateMap`. A new `/operator` tab renders a store×platform matrix that writes via `POST /api/operator/ad-state`.

**Tech Stack:** Next.js (App Router), Supabase (Postgres + service-role), vitest (node + jsdom), React + existing UI primitives.

**Spec:** `docs/superpowers/specs/2026-06-06-ads-off-state-design.md` (§A, §B, §G). This plan implements **Phase 1 / §J.1** only.

---

## Task 1: Migration — `store_ad_state` table

**Files:**
- Create: `supabase/migrations/20260606160000_store_ad_state.sql`

- [ ] **Step 1: Write the migration**

```sql
-- store_ad_state — operator toggle for "is advertising ON for a (store, platform)".
-- Additive, nullable-safe. MISSING ROW OR enabled=TRUE ⇒ ON (default), so an empty
-- table means the whole system behaves exactly as today. 2026-06-06 (ads-off Phase 1).
CREATE TABLE IF NOT EXISTS public.store_ad_state (
  store_id    TEXT NOT NULL,
  platform    TEXT NOT NULL,                 -- 'meta' | 'google' | 'tiktok'
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, platform)
);

COMMENT ON TABLE public.store_ad_state IS
  'Operator toggle: is advertising ON for a (store, platform). Missing row = ON (default). ads-off 2026-06-06.';

-- Match the grants the other operator-written tables get (anon SELECT; writes via service_role).
GRANT SELECT ON public.store_ad_state TO anon;
```

- [ ] **Step 2: Verify it parses (dry, local)**

Run: `grep -c "CREATE TABLE" supabase/migrations/20260606160000_store_ad_state.sql`
Expected: `1`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260606160000_store_ad_state.sql
git commit -m "feat(ads-off): store_ad_state table (Phase 1)"
```

> The migration is **applied to prod in Task 8** via the supervised procedure (hide root `.env`, move the 2 gap files, `npx supabase db push`, restore) — NOT here.

---

## Task 2: Cache config entry

**Files:**
- Modify: `dashboard-web/src/lib/cacheConfig.ts:34` (next to `storeMeta`)

- [ ] **Step 1: Add the `adState` entry**

In `CACHE_CONFIG`, directly after the `storeMeta` line, add:

```ts
  storeMeta: { revalidate: 3600, swr: 86400 },
  // ads-off: the toggle changes rarely (operator action) → same cadence as storeMeta.
  adState: { revalidate: 3600, swr: 86400 },
```

- [ ] **Step 2: Type-check**

Run: `cd dashboard-web && npx tsc --noEmit`
Expected: no errors (the new key widens `CacheKey`).

- [ ] **Step 3: Commit**

```bash
git add dashboard-web/src/lib/cacheConfig.ts
git commit -m "feat(ads-off): CACHE_CONFIG.adState (Phase 1)"
```

---

## Task 3: `adState.ts` helpers (single source of truth)

**Files:**
- Create: `dashboard-web/src/lib/adState.ts`
- Test: `dashboard-web/src/lib/__tests__/adState.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import {
  isAdsEnabled,
  applicablePlatforms,
  tiktokAccountFetchEnabled,
  TIKTOK_SHARED_STORES,
  type AdStateMap,
} from '@/lib/adState';

const store = (over: Partial<{ storeId: string; metaAdAccountId: string | null; googleAdsCustomerId: string | null }>) => ({
  storeId: 'uzoshop', storeName: 'uzoshop', planDisplayName: '', shopifyPlus: false,
  partnerDevelopment: false, updatedAt: null, lastError: null,
  metaAdAccountId: null, googleAdsCustomerId: null, tiktokAdvertiserId: null, ...over,
});

describe('isAdsEnabled — missing key defaults to ON', () => {
  it('returns true when no row exists', () => {
    expect(isAdsEnabled({}, 'uzoshop', 'meta')).toBe(true);
  });
  it('returns false only when explicitly disabled', () => {
    const m: AdStateMap = { 'uzoshop:google': false };
    expect(isAdsEnabled(m, 'uzoshop', 'google')).toBe(false);
    expect(isAdsEnabled(m, 'uzoshop', 'meta')).toBe(true);
  });
});

describe('applicablePlatforms — derived from config', () => {
  it('uzoshop = meta+google+tiktok', () => {
    const p = applicablePlatforms(
      store({ storeId: 'uzoshop', metaAdAccountId: '123', googleAdsCustomerId: '456' }),
      new Set(['uzoshop', 'usmile360']),
    );
    expect(p.sort()).toEqual(['google', 'meta', 'tiktok']);
  });
  it('zolplus = meta only', () => {
    const p = applicablePlatforms(store({ storeId: 'zolplus', metaAdAccountId: '123' }), new Set(['uzoshop', 'usmile360']));
    expect(p).toEqual(['meta']);
  });
  it('usmile360 = meta+tiktok', () => {
    const p = applicablePlatforms(store({ storeId: 'usmile360', metaAdAccountId: '123' }), new Set(['uzoshop', 'usmile360']));
    expect(p.sort()).toEqual(['meta', 'tiktok']);
  });
});

describe('tiktokAccountFetchEnabled — shared account', () => {
  it('true when ANY shared-account store has tiktok on', () => {
    expect(tiktokAccountFetchEnabled({ 'uzoshop:tiktok': false })).toBe(true); // usmile still on
  });
  it('false only when ALL shared-account stores are off', () => {
    const m: AdStateMap = { 'uzoshop:tiktok': false, 'usmile360:tiktok': false };
    expect(tiktokAccountFetchEnabled(m)).toBe(false);
  });
  it('exposes the shared-store list', () => {
    expect(TIKTOK_SHARED_STORES).toContain('uzoshop');
    expect(TIKTOK_SHARED_STORES).toContain('usmile360');
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `cd dashboard-web && npx vitest run src/lib/__tests__/adState.test.ts`
Expected: FAIL ("Cannot find module '@/lib/adState'").

- [ ] **Step 3: Implement `adState.ts`**

```ts
// dashboard-web/src/lib/adState.ts
//
// ads-off (2026-06-06) — single source of truth for "is advertising ON for a
// (store, platform)". Pure helpers; consumed by crons, readers, UI, alerts,
// WhatsApp. See docs/superpowers/specs/2026-06-06-ads-off-state-design.md.
import type { StoreMetaRow } from '@/lib/postgresReaders';

export type AdPlatform = 'meta' | 'google' | 'tiktok';

/** `${storeId}:${platform}` → enabled. Missing key ⇒ ON (true). */
export type AdStateMap = Record<string, boolean>;

/** Stores that share uzoshop's single TikTok ad account (Phase A.5 v2). The
 *  account is fetched once + split per-store via campaignStoreMap. */
export const TIKTOK_SHARED_STORES = ['uzoshop', 'usmile360'] as const;

export function adStateKey(storeId: string, platform: AdPlatform): string {
  return `${storeId}:${platform}`;
}

/** ON unless an explicit `false` row exists. */
export function isAdsEnabled(map: AdStateMap, storeId: string, platform: AdPlatform): boolean {
  return map[adStateKey(storeId, platform)] !== false;
}

/** Platforms a store actually advertises on — derived from live config, never
 *  hardcoded. Meta: has a Meta ad account. Google: has a Google customer id.
 *  TikTok: member of the shared-account set (`tiktokStores`). */
export function applicablePlatforms(store: StoreMetaRow, tiktokStores: Set<string>): AdPlatform[] {
  const out: AdPlatform[] = [];
  if (store.metaAdAccountId) out.push('meta');
  if (store.googleAdsCustomerId) out.push('google');
  if (tiktokStores.has(store.storeId)) out.push('tiktok');
  return out;
}

/** The shared TikTok account fetch is needed unless TikTok is OFF for EVERY
 *  store on the account (otherwise an off store would kill the others' data). */
export function tiktokAccountFetchEnabled(map: AdStateMap): boolean {
  return TIKTOK_SHARED_STORES.some((s) => isAdsEnabled(map, s, 'tiktok'));
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `cd dashboard-web && npx vitest run src/lib/__tests__/adState.test.ts`
Expected: PASS (all assertions).

- [ ] **Step 5: Commit**

```bash
git add dashboard-web/src/lib/adState.ts dashboard-web/src/lib/__tests__/adState.test.ts
git commit -m "feat(ads-off): adState helpers — isAdsEnabled/applicablePlatforms/tiktokAccountFetchEnabled (Phase 1)"
```

---

## Task 4: `fetchAdStateFromPostgres` reader

**Files:**
- Modify: `dashboard-web/src/lib/postgresReaders.ts` (add the function near the other readers; export it)
- Test: `dashboard-web/src/lib/__tests__/postgresReadersAdState.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rows = vi.hoisted(() => ({ data: [] as Array<Record<string, unknown>> }));
vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    from: () => {
      const q: Record<string, unknown> = {
        select: () => q,
        order: () => q,
        range: () => Promise.resolve({ data: rows.data, error: null }),
      };
      return q;
    },
  }),
}));

import { fetchAdStateFromPostgres } from '@/lib/postgresReaders';

beforeEach(() => { rows.data = []; });

describe('fetchAdStateFromPostgres', () => {
  it('returns an empty map when there are no rows (⇒ all ON)', async () => {
    expect(await fetchAdStateFromPostgres()).toEqual({});
  });
  it('maps rows to `${store}:${platform}` → enabled', async () => {
    rows.data = [
      { store_id: 'zolplus', platform: 'meta', enabled: false },
      { store_id: 'uzoshop', platform: 'google', enabled: true },
    ];
    expect(await fetchAdStateFromPostgres()).toEqual({
      'zolplus:meta': false,
      'uzoshop:google': true,
    });
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `cd dashboard-web && npx vitest run src/lib/__tests__/postgresReadersAdState.test.ts`
Expected: FAIL ("fetchAdStateFromPostgres is not a function").

- [ ] **Step 3: Implement the reader**

Add to `dashboard-web/src/lib/postgresReaders.ts` (after `fetchStoreMetaFromPostgres`, importing nothing new — `paginate`, `getSupabase`, `DbRow`, `AdStateMap` type from `@/lib/adState`):

```ts
import type { AdStateMap } from '@/lib/adState';

// ────────────────────────────────────────────────────────────────────────
// fetchAdStateFromPostgres — store_ad_state → AdStateMap (ads-off Phase 1)
// ────────────────────────────────────────────────────────────────────────

/**
 * Loads `store_ad_state` into an AdStateMap (`${storeId}:${platform}` → enabled).
 * Missing rows are simply absent ⇒ the consumer treats them as ON (see
 * isAdsEnabled). Paginated with a deterministic ORDER BY the PK (per the
 * deterministic-pagination rule).
 */
export async function fetchAdStateFromPostgres(): Promise<AdStateMap> {
  const data = await paginate<DbRow>(
    () => getSupabase().from('store_ad_state').select('store_id, platform, enabled'),
    ['store_id', 'platform'],
  );
  const map: AdStateMap = {};
  for (const r of data) {
    map[`${String(r.store_id)}:${String(r.platform)}`] = r.enabled !== false;
  }
  return map;
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `cd dashboard-web && npx vitest run src/lib/__tests__/postgresReadersAdState.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard-web/src/lib/postgresReaders.ts dashboard-web/src/lib/__tests__/postgresReadersAdState.test.ts
git commit -m "feat(ads-off): fetchAdStateFromPostgres reader (Phase 1)"
```

---

## Task 5: `/api/operator/ad-state` route (GET map + POST upsert)

**Files:**
- Create: `dashboard-web/src/app/api/operator/ad-state/route.ts`
- Test: `dashboard-web/src/app/api/operator/ad-state/__tests__/route.test.ts`

Follow the operator-route conventions in `src/app/api/operator/reset/route.ts`: `runtime='nodejs'`, `dynamic='force-dynamic'`, writes via `getSupabaseAdmin()` (service-role). The operator-secret + dashboard gates are enforced upstream in `middleware.ts` (this route lives under `/api/operator/*`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = vi.hoisted(() => ({ upserts: [] as unknown[], rows: [] as unknown[] }));
vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => Promise.resolve({ data: store.rows, error: null }),
      upsert: (v: unknown) => { store.upserts.push(v); return Promise.resolve({ error: null }); },
    }),
  }),
}));

import { GET, POST } from '@/app/api/operator/ad-state/route';

beforeEach(() => { store.upserts = []; store.rows = []; });

describe('GET /api/operator/ad-state', () => {
  it('returns the ad-state map', async () => {
    store.rows = [{ store_id: 'zolplus', platform: 'meta', enabled: false }];
    const res = await GET();
    expect(await res.json()).toEqual({ map: { 'zolplus:meta': false } });
  });
});

describe('POST /api/operator/ad-state', () => {
  it('upserts {store_id, platform, enabled}', async () => {
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ storeId: 'zolplus', platform: 'meta', enabled: false }) });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(store.upserts[0]).toMatchObject({ store_id: 'zolplus', platform: 'meta', enabled: false });
  });
  it('400 on a bad platform', async () => {
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ storeId: 'zolplus', platform: 'snapchat', enabled: false }) });
    expect((await POST(req)).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `cd dashboard-web && npx vitest run src/app/api/operator/ad-state/__tests__/route.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the route**

```ts
// dashboard-web/src/app/api/operator/ad-state/route.ts
// ads-off Phase 1 — operator reads/sets the per (store, platform) toggle.
// Gated upstream by middleware (dashboard cookie + operator secret).
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import type { AdStateMap, AdPlatform } from '@/lib/adState';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PLATFORMS: readonly AdPlatform[] = ['meta', 'google', 'tiktok'];

export async function GET(): Promise<NextResponse> {
  const { data, error } = await getSupabaseAdmin()
    .from('store_ad_state')
    .select('store_id, platform, enabled');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const map: AdStateMap = {};
  for (const r of (data ?? []) as Array<{ store_id: string; platform: string; enabled: boolean }>) {
    map[`${r.store_id}:${r.platform}`] = r.enabled !== false;
  }
  return NextResponse.json({ map });
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: { storeId?: unknown; platform?: unknown; enabled?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }
  const storeId = typeof body.storeId === 'string' ? body.storeId : '';
  const platform = body.platform as AdPlatform;
  const enabled = body.enabled === true;
  if (!storeId || !PLATFORMS.includes(platform)) {
    return NextResponse.json({ error: 'storeId + valid platform required' }, { status: 400 });
  }
  const { error } = await getSupabaseAdmin()
    .from('store_ad_state')
    .upsert({ store_id: storeId, platform, enabled, updated_at: new Date().toISOString() }, { onConflict: 'store_id,platform' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `cd dashboard-web && npx vitest run src/app/api/operator/ad-state/__tests__/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard-web/src/app/api/operator/ad-state/
git commit -m "feat(ads-off): /api/operator/ad-state GET+POST (Phase 1)"
```

---

## Task 6: `AdStatePanel` matrix component

**Files:**
- Create: `dashboard-web/src/components/operator/AdStatePanel.tsx`
- Test: `dashboard-web/src/components/operator/__tests__/AdStatePanel.dom.test.tsx`

The panel takes `storeMeta: StoreMetaRow[]`, the current `map: AdStateMap`, the `tiktokStores: Set<string>`, and an `onToggle(storeId, platform, enabled)` callback. It renders a matrix: a row per store, a column per platform (Meta/Google/TikTok); applicable cells render a toggle bound to `isAdsEnabled`, non-applicable cells render "לא רלוונטי".

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AdStatePanel } from '@/components/operator/AdStatePanel';

const meta = [
  { storeId: 'uzoshop', storeName: 'uzoshop', metaAdAccountId: '1', googleAdsCustomerId: '2', tiktokAdvertiserId: null, planDisplayName: '', shopifyPlus: false, partnerDevelopment: false, updatedAt: null, lastError: null },
  { storeId: 'zolplus', storeName: 'Zol Plus', metaAdAccountId: '1', googleAdsCustomerId: null, tiktokAdvertiserId: null, planDisplayName: '', shopifyPlus: false, partnerDevelopment: false, updatedAt: null, lastError: null },
];

describe('AdStatePanel', () => {
  it('renders a row per store + "לא רלוונטי" for non-applicable cells', () => {
    render(<AdStatePanel storeMeta={meta as never} map={{ 'zolplus:meta': false }} tiktokStores={new Set(['uzoshop'])} onToggle={() => {}} />);
    expect(screen.getByText('uzoshop')).toBeTruthy();
    expect(screen.getByText('Zol Plus')).toBeTruthy();
    // Zol Plus has no google + no tiktok → 2 "לא רלוונטי" cells.
    expect(screen.getAllByText('לא רלוונטי').length).toBe(2);
  });
  it('calls onToggle when an applicable toggle is clicked', () => {
    const onToggle = vi.fn();
    render(<AdStatePanel storeMeta={meta as never} map={{}} tiktokStores={new Set(['uzoshop'])} onToggle={onToggle} />);
    screen.getByTestId('toggle-zolplus-meta').click();
    expect(onToggle).toHaveBeenCalledWith('zolplus', 'meta', false); // was ON → toggling sends OFF
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `cd dashboard-web && npx vitest run --config vitest.config.dom.ts src/components/operator/__tests__/AdStatePanel.dom.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the component**

```tsx
// dashboard-web/src/components/operator/AdStatePanel.tsx
'use client';
import type { StoreMetaRow } from '@/lib/postgresReaders';
import { applicablePlatforms, isAdsEnabled, type AdPlatform, type AdStateMap } from '@/lib/adState';
import { Card } from '@/components/ui/Card';
import { Heading } from '@/components/ui/Typography';

const COLS: { key: AdPlatform; label: string }[] = [
  { key: 'meta', label: 'Meta' },
  { key: 'google', label: 'Google' },
  { key: 'tiktok', label: 'TikTok' },
];

export function AdStatePanel(props: {
  storeMeta: StoreMetaRow[];
  map: AdStateMap;
  tiktokStores: Set<string>;
  onToggle: (storeId: string, platform: AdPlatform, enabled: boolean) => void;
}) {
  const { storeMeta, map, tiktokStores, onToggle } = props;
  return (
    <Card className="p-4">
      <Heading level={2}>מצב פרסום</Heading>
      <p className="text-sm text-ink-secondary mb-3">כיבוי/הדלקת פרסום לכל חנות ופלטפורמה. כבוי = לא נמשך, לא מתריע, מוצג "אורגני/כבוי".</p>
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="text-start p-2">חנות</th>
            {COLS.map((c) => <th key={c.key} className="p-2">{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {storeMeta.map((s) => {
            const applicable = new Set(applicablePlatforms(s, tiktokStores));
            return (
              <tr key={s.storeId} className="border-t border-glass-2">
                <td className="text-start p-2 font-semibold">{s.storeName}</td>
                {COLS.map((c) => {
                  if (!applicable.has(c.key)) {
                    return <td key={c.key} className="p-2 text-center text-ink-tertiary text-xs">לא רלוונטי</td>;
                  }
                  const on = isAdsEnabled(map, s.storeId, c.key);
                  return (
                    <td key={c.key} className="p-2 text-center">
                      <button
                        type="button"
                        data-testid={`toggle-${s.storeId}-${c.key}`}
                        aria-pressed={on}
                        onClick={() => onToggle(s.storeId, c.key, !on)}
                        className={on ? 'px-3 py-1 rounded-full bg-emerald-600 text-white text-xs font-bold'
                                      : 'px-3 py-1 rounded-full bg-glass-2 text-ink-secondary text-xs font-bold'}
                      >
                        {on ? 'דלוק' : 'כבוי'}
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
```

> If `Card`/`Heading` import paths differ, match the imports used by a sibling operator component (e.g. `src/components/operator/ResetData.tsx`). Do NOT introduce new color hex — use existing tokens/classes.

- [ ] **Step 4: Run it — verify it passes**

Run: `cd dashboard-web && npx vitest run --config vitest.config.dom.ts src/components/operator/__tests__/AdStatePanel.dom.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard-web/src/components/operator/AdStatePanel.tsx dashboard-web/src/components/operator/__tests__/AdStatePanel.dom.test.tsx
git commit -m "feat(ads-off): AdStatePanel store×platform matrix (Phase 1)"
```

---

## Task 7: Wire the panel into `/operator` (new tab + data loading)

**Files:**
- Create: `dashboard-web/src/app/operator/AdStateTab.tsx` (client container: fetches `GET /api/operator/ad-state` + `storeMeta`, derives `tiktokStores`, renders `AdStatePanel`, POSTs on toggle with optimistic update + refetch)
- Modify: `dashboard-web/src/app/operator/page.tsx` (add a `<TabsTrigger>` + `<TabsContent>` for the new tab, mirroring `SyncTab`/`DangerTab`)

- [ ] **Step 1: Implement `AdStateTab.tsx`**

```tsx
// dashboard-web/src/app/operator/AdStateTab.tsx
'use client';
import { useEffect, useState } from 'react';
import { AdStatePanel } from '@/components/operator/AdStatePanel';
import type { StoreMetaRow } from '@/lib/postgresReaders';
import { TIKTOK_SHARED_STORES, type AdPlatform, type AdStateMap } from '@/lib/adState';

export function AdStateTab() {
  const [map, setMap] = useState<AdStateMap>({});
  const [meta, setMeta] = useState<StoreMetaRow[]>([]);
  const tiktokStores = new Set<string>(TIKTOK_SHARED_STORES);

  async function load() {
    const [a, m] = await Promise.all([
      fetch('/api/operator/ad-state').then((r) => r.json()),
      fetch('/api/store-meta').then((r) => r.json()),
    ]);
    setMap(a.map ?? {});
    setMeta((m.stores ?? m ?? []) as StoreMetaRow[]);
  }
  useEffect(() => { void load(); }, []);

  async function onToggle(storeId: string, platform: AdPlatform, enabled: boolean) {
    setMap((prev) => ({ ...prev, [`${storeId}:${platform}`]: enabled })); // optimistic
    await fetch('/api/operator/ad-state', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ storeId, platform, enabled }),
    }).catch(() => {});
    void load(); // reconcile
  }

  return <AdStatePanel storeMeta={meta} map={map} tiktokStores={tiktokStores} onToggle={onToggle} />;
}
```

> Confirm the store-meta endpoint path + response shape against an existing caller (search `'/api/store-meta'`); adjust `m.stores ?? m` accordingly. `tiktokStores` uses `TIKTOK_SHARED_STORES` for Phase 1 (the only TikTok-enabled stores); a later phase can derive it from the live map if a 4th store joins.

- [ ] **Step 2: Add the tab to `page.tsx`**

In `dashboard-web/src/app/operator/page.tsx`: import `AdStateTab`, add `<TabsTrigger value="ads">מצב פרסום</TabsTrigger>` to the `<TabsList>`, and `<TabsContent value="ads"><AdStateTab /></TabsContent>` next to the other `<TabsContent>` blocks.

- [ ] **Step 3: Type-check + lint**

Run: `cd dashboard-web && npx tsc --noEmit && npx eslint src/app/operator/AdStateTab.tsx src/app/operator/page.tsx`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add dashboard-web/src/app/operator/AdStateTab.tsx dashboard-web/src/app/operator/page.tsx
git commit -m "feat(ads-off): wire AdState tab into /operator (Phase 1)"
```

---

## Task 8: Docs + apply migration + deploy

**Files:**
- Modify: `docs/ARCHITECTURE.md` (new note: `store_ad_state` + `adState` helpers; note Phases 2–4 pending)
- Modify: `docs/ROAS-Dashboard-User-Manual.md` (version bump + a "מה התחדש" entry: new /operator "מצב פרסום" tab; toggling has no display/fetch effect YET — Phases 2–4)

- [ ] **Step 1: ARCHITECTURE note**

Add a short section: the table shape, "missing row = ON", the `adState` helpers as the single source of truth, the `/api/operator/ad-state` route, and "Phases 2–4 (display / fetch-gate / alerts+WhatsApp) pending — see the spec".

- [ ] **Step 2: User Manual entry + version bump**

Add a "מה התחדש" entry describing the new tab and bump the version line.

- [ ] **Step 3: Run the full gate locally**

Run: `cd dashboard-web && npm test && npm run test:components && npx tsc --noEmit && npm run lint`
Expected: all green.

- [ ] **Step 4: Apply the migration to prod (supervised)**

Per `reference_supabase_migration_procedure`: hide root `.env`, move the 2 duplicate-timestamp gap files, `npx supabase db push`, restore. Verify: `select count(*) from store_ad_state;` returns `0` (empty = all-ON = no behavior change).

- [ ] **Step 5: Commit + push (deploy)**

```bash
git add docs/ARCHITECTURE.md docs/ROAS-Dashboard-User-Manual.md
git commit -m "docs(ads-off): ARCHITECTURE + User Manual for Phase 1 control layer"
git push origin main
```

---

## Self-review (run before execution)

- **Spec coverage (Phase 1 / §J.1):** migration (T1) ✓ · helpers §B (T3) ✓ · reader §B (T4) ✓ · cache (T2) ✓ · /operator matrix §G (T5–T7) ✓ · applicability §7 (T3 `applicablePlatforms` + T6 non-applicable cells) ✓ · TikTok shared-account helper §8 (T3 `tiktokAccountFetchEnabled`, consumed in Phase 3) ✓ · no-regression §H (empty table ⇒ all-ON; verified T8.4) ✓.
- **Out of scope (later phases):** `adDisplayState` + band colors (Phase 2), fetch-gate wiring (Phase 3), alerts/insights/WhatsApp (Phase 4). `tiktokAccountFetchEnabled` is built now but only *consumed* in Phase 3.
- **Type consistency:** `AdStateMap`, `AdPlatform`, `isAdsEnabled`, `applicablePlatforms`, `tiktokAccountFetchEnabled`, `TIKTOK_SHARED_STORES`, `fetchAdStateFromPostgres` names are identical across tasks. `StoreMetaRow` fields used (`metaAdAccountId`, `googleAdsCustomerId`, `storeId`, `storeName`) match `postgresReaders.ts`.
- **Open verifications for the implementer:** (a) `/api/store-meta` response shape (T7); (b) `Card`/`Heading` import paths vs a sibling operator component (T6); (c) `getSupabaseAdmin` import path (search an existing operator route).
