# Ads-Off — Phase 2 (Display + ROAS band colors) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the per-store ROAS surfaces ads-off-aware — when a store's advertising is OFF, show its ROAS as blue **"אורגני"** (revenue + no spend), or neutral **"0"** (no/negative revenue), instead of a broken/gray number — faithful to the existing design, additive only.

**Architecture:** A pure classifier `adDisplayState({revenue, spend, off})` (in `lib/adState.ts`) decides the off-display state. The off-display is gated on **`off && spend === 0`** so historical rows that carried real spend before the toggle are NEVER retroactively rewritten (spend>0 while off ⇒ `'normal'`). The ad-state reaches the client by extending the existing `/api/data` response (`adStateMap` + `storeApplicablePlatforms`). Three existing color helpers get off-awareness, all backward-compatible: `roasCell` (tables), and the per-store card / comparative-pill call sites (which already use `useRoasBandGradient` / `roasLabel`). Business-wide surfaces (`CommandCenterHero`, `RoasTargetChart`, `GoalTracker`) are **NOT touched**.

**Tech Stack:** Next.js (App Router), Supabase, vitest (node + jsdom), Playwright (visual/axe), React + existing UI primitives + design tokens.

**Spec:** `docs/superpowers/specs/2026-06-06-ads-off-state-design.md` (§D Display, §E3 Monthly tables, §J.2). Phase 1 (control layer) shipped (commits `f4f5c1c..55a9ca8`). This plan is Phase 2.

---

## Locked design decisions (from brainstorming + the 2026-06-06 mapping)

1. **Off-display gate = `off && spend === 0`.** A surface shows off-state ONLY when intentionally off (toggle) AND its spend for that surface/row is 0. Off-but-spend>0 (historical pre-toggle rows, or residual same-day spend) ⇒ `'normal'` (real spend, real ROAS). This avoids retroactively zeroing history and means **no spend-column rewriting is needed** (off ⇒ no fetch ⇒ spend is naturally 0 going forward).
2. **Color by revenue when off:** revenue > 0 → **organic** (blue, text "אורגני"); revenue ≤ 0 → **neutral** (gray chip, text "0"). off+negative folds into neutral (operator-locked: "like a zero day", NOT red, NOT black).
3. **Per-store aggregate is "off" only when ALL its applicable platforms are off** (`isStoreFullyOff`). A partially-off store still advertises → normal ROAS on the remaining spend.
4. **Business summary** (MonthlyTables "סיכום כללי") is "off" only when every store is fully off; gated the same way (`off && summedSpend === 0`).
5. **Do NOT touch:** `CommandCenterHero`, `RoasTargetChart`, `GoalTracker` (business-wide). `CampaignsTableRow` / `AdSetTable` (campaign-level off-awareness is **deferred to a later sub-phase**). `useRoasBandGradient` stays unchanged (off override is computed at the per-store call sites). `roasCell`'s new `off` param defaults to `false` so existing callers are byte-for-byte unchanged.
6. **Reuse existing AA-cleared tokens** — organic = the existing `blue` ROAS token; neutral = the existing gray chip (`bg-glass-2 text-ink`). No new color tokens ⇒ no contrast-guard regression risk.

---

## Task 1: Classifier — `adDisplayState` + `isStoreFullyOff` + `adDisplayBand`

**Files:**
- Modify: `dashboard-web/src/lib/adState.ts` (append; import `RoasBand` type-only)
- Test: `dashboard-web/src/lib/__tests__/adDisplayState.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { adDisplayState, isStoreFullyOff, adDisplayBand } from '@/lib/adState';

describe('adDisplayState — gated on off && spend===0', () => {
  it('normal when not off', () => {
    expect(adDisplayState({ revenue: 100, spend: 50, off: false })).toBe('normal');
  });
  it('normal when off but spend>0 (historical row, never retroactively rewritten)', () => {
    expect(adDisplayState({ revenue: 100, spend: 50, off: true })).toBe('normal');
  });
  it('organic when off + spend 0 + revenue>0', () => {
    expect(adDisplayState({ revenue: 100, spend: 0, off: true })).toBe('organic');
  });
  it('off-empty when off + spend 0 + revenue 0', () => {
    expect(adDisplayState({ revenue: 0, spend: 0, off: true })).toBe('off-empty');
  });
  it('off-negative when off + spend 0 + revenue<0', () => {
    expect(adDisplayState({ revenue: -20, spend: 0, off: true })).toBe('off-negative');
  });
  it('treats null spend/revenue as 0', () => {
    expect(adDisplayState({ revenue: null, spend: null, off: true })).toBe('off-empty');
  });
});

describe('isStoreFullyOff — ALL applicable platforms off', () => {
  it('false when no applicable platforms', () => {
    expect(isStoreFullyOff('uzoshop', {}, [])).toBe(false);
  });
  it('false when at least one applicable platform is on', () => {
    const map = { 'uzoshop:meta': false }; // google still on (missing = on)
    expect(isStoreFullyOff('uzoshop', map, ['meta', 'google'])).toBe(false);
  });
  it('true only when every applicable platform is off', () => {
    const map = { 'uzoshop:meta': false, 'uzoshop:google': false };
    expect(isStoreFullyOff('uzoshop', map, ['meta', 'google'])).toBe(true);
  });
});

describe('adDisplayBand — off-state → band override (null = normal)', () => {
  it('organic → blue', () => expect(adDisplayBand('organic')).toBe('blue'));
  it('off-empty → gray', () => expect(adDisplayBand('off-empty')).toBe('gray'));
  it('off-negative → gray', () => expect(adDisplayBand('off-negative')).toBe('gray'));
  it('normal → null (caller keeps existing band)', () => expect(adDisplayBand('normal')).toBeNull());
});
```

- [ ] **Step 2: Run it — confirm FAIL** — `cd dashboard-web && npx vitest run src/lib/__tests__/adDisplayState.test.ts` (Expected: FAIL, exports missing).

- [ ] **Step 3: Implement (append to `dashboard-web/src/lib/adState.ts`)**

```ts
import type { RoasBand } from '@/lib/format/useRoasBandGradient';

export type AdDisplayState = 'normal' | 'organic' | 'off-empty' | 'off-negative';

/** A per-store surface counts as "off" only when ALL its applicable platforms
 *  are toggled off — a partially-off store still advertises (remaining spend),
 *  so it must render a normal ROAS. */
export function isStoreFullyOff(
  storeId: string,
  map: AdStateMap,
  applicable: readonly AdPlatform[],
): boolean {
  if (!applicable || applicable.length === 0) return false;
  return applicable.every((p) => !isAdsEnabled(map, storeId, p));
}

/** Off-display classifier. Off-state ONLY applies when intentionally off AND
 *  spend is 0 — so a historical row that carried real spend before the toggle
 *  (spend>0) stays 'normal' and is never retroactively rewritten. */
export function adDisplayState(opts: {
  revenue: number | null;
  spend: number | null;
  off: boolean;
}): AdDisplayState {
  const spend = opts.spend ?? 0;
  if (!opts.off || spend !== 0) return 'normal';
  const rev = opts.revenue ?? 0;
  if (rev > 0) return 'organic';
  if (rev < 0) return 'off-negative';
  return 'off-empty';
}

/** Off-state → band override (reusing existing AA-cleared bands). Returns null
 *  for 'normal' so callers keep their existing numeric-band logic. */
export function adDisplayBand(state: AdDisplayState): RoasBand | null {
  switch (state) {
    case 'organic':
      return 'blue';
    case 'off-empty':
    case 'off-negative':
      return 'gray';
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run it — confirm PASS** (all assertions green).
- [ ] **Step 5: tsc + eslint** — `npx tsc --noEmit && npx eslint src/lib/adState.ts src/lib/__tests__/adDisplayState.test.ts` (clean; ignore the pre-existing MODULE_TYPELESS warning).
- [ ] **Step 6: Commit**

```bash
git add dashboard-web/src/lib/adState.ts dashboard-web/src/lib/__tests__/adDisplayState.test.ts
git commit -m "feat(ads-off): adDisplayState classifier + isStoreFullyOff + adDisplayBand (Phase 2)"
```

---

## Task 2: Surface ad-state to the client via `/api/data`

**Files:**
- Modify: `dashboard-web/src/lib/types.ts` (`DashboardData`)
- Modify: `dashboard-web/src/app/api/data/route.ts`
- Test: `dashboard-web/src/app/api/data/__tests__/adStateOnData.test.ts` (or extend an existing data-route test if present)

- [ ] **Step 1: Extend the `DashboardData` type**

In `dashboard-web/src/lib/types.ts`, add an import at top and two optional fields to `DashboardData` (after `fxIlsToCad`):

```ts
import type { AdStateMap, AdPlatform } from '@/lib/adState';
```
```ts
  /** ads-off Phase 2 — per (store,platform) toggle map (missing key = ON) +
   *  the applicable platforms per store (derived from store meta + the TikTok
   *  shared-account set), so display surfaces can compute "store fully off".
   *  Optional + default-empty so all existing consumers are unaffected (empty
   *  ⇒ everything ON ⇒ today's behavior). */
  adStateMap?: AdStateMap;
  storeApplicablePlatforms?: Record<string, AdPlatform[]>;
```

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/postgresReaders', () => ({
  fetchDailyDataFromPostgres: vi.fn(async () => [
    { date: '2026-06-06', storeId: 'uzoshop', storeName: 'uzoshop', fbSpend: 0, gaSpend: 0, ttSpend: 0, totalSpend: 0, revenue: 0, roas: 0, grossProfit: 0, cogs: 0, netProfit: 0, hasCogs: false, grossRevenue: null, refundDeduction: null, fbImpressions: null, gaImpressions: null, ttImpressions: null },
  ]),
  fetchDataDailyLastWriteAt: vi.fn(async () => null),
  fetchAdStateFromPostgres: vi.fn(async () => ({ 'zolplus:meta': false })),
  fetchStoreMetaFromPostgres: vi.fn(async () => [
    { storeId: 'uzoshop', storeName: 'uzoshop', metaAdAccountId: '1', googleAdsCustomerId: '2', tiktokAdvertiserId: null, planDisplayName: '', shopifyPlus: false, partnerDevelopment: false, updatedAt: null, lastError: null },
    { storeId: 'zolplus', storeName: 'Zol Plus', metaAdAccountId: '1', googleAdsCustomerId: null, tiktokAdvertiserId: null, planDisplayName: '', shopifyPlus: false, partnerDevelopment: false, updatedAt: null, lastError: null },
  ]),
}));
vi.mock('@/lib/sentry/capture', () => ({ captureRouteError: () => {} }));
// FX fetch → null (no network in test)
vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch);

import { GET } from '@/app/api/data/route';

describe('/api/data attaches adState', () => {
  it('returns adStateMap + storeApplicablePlatforms', async () => {
    const res = await GET(new Request('http://x/api/data?from=2026-06-01&to=2026-06-06'));
    const body = await res.json();
    expect(body.adStateMap).toEqual({ 'zolplus:meta': false });
    expect(body.storeApplicablePlatforms.uzoshop.sort()).toEqual(['google', 'meta', 'tiktok'].sort());
    expect(body.storeApplicablePlatforms.zolplus).toEqual(['meta']);
  });
});
```

> If `parseRangeParams` rejects the test URL, copy the date params from an existing data-route test. If no `tiktokStores` set is wired, uzoshop's tiktok comes from `TIKTOK_SHARED_STORES` (see Step 3).

- [ ] **Step 2b: Run it — confirm FAIL** (`fetchAdStateFromPostgres`/`fetchStoreMetaFromPostgres` not imported by the route yet, or fields absent).

- [ ] **Step 3: Implement the route change** in `dashboard-web/src/app/api/data/route.ts`

(a) Extend the imports:
```ts
import {
  fetchDailyDataFromPostgres,
  fetchDataDailyLastWriteAt,
  fetchAdStateFromPostgres,
  fetchStoreMetaFromPostgres,
} from '@/lib/postgresReaders';
import { applicablePlatforms, TIKTOK_SHARED_STORES } from '@/lib/adState';
import type { AdPlatform } from '@/lib/adState';
```

(b) In the `try` block, add the two fetches to `Promise.all` (degrade gracefully — wrap each in a `.catch(() => default)` so an ad-state read failure NEVER breaks the dashboard):
```ts
    const [rows, fxIlsToCad, dataLastWriteAt, adStateMap, storeMeta] = await Promise.all([
      fetchDailyDataFromPostgres({ range }),
      fetchTodayFx(),
      fetchDataDailyLastWriteAt(),
      fetchAdStateFromPostgres().catch(() => ({})),
      fetchStoreMetaFromPostgres().catch(() => []),
    ]);
    const tiktokStores = new Set<string>(TIKTOK_SHARED_STORES);
    const storeApplicablePlatforms: Record<string, AdPlatform[]> = {};
    for (const s of storeMeta) storeApplicablePlatforms[s.storeId] = applicablePlatforms(s, tiktokStores);
```

(c) Attach to the success `data` object:
```ts
    const data: DashboardData = {
      rows,
      stores,
      lastUpdated: new Date().toISOString(),
      dataLastWriteAt,
      fxIlsToCad,
      adStateMap,
      storeApplicablePlatforms,
    };
```

(d) Attach empties to the degraded-error fallback object:
```ts
        fxIlsToCad: null,
        adStateMap: {},
        storeApplicablePlatforms: {},
        error: userFacingError(message),
```

- [ ] **Step 4: Run it — confirm PASS.**
- [ ] **Step 5: tsc + the wider data/reader suite** — `npx tsc --noEmit && npx vitest run src/app/api/data src/lib/__tests__/ 2>&1 | tail -12` (all green).
- [ ] **Step 6: Commit**

```bash
git add dashboard-web/src/lib/types.ts dashboard-web/src/app/api/data/
git commit -m "feat(ads-off): /api/data surfaces adStateMap + storeApplicablePlatforms (Phase 2)"
```

---

## Task 3: `roasCell` off-aware (tables) — backward-compatible

**Files:**
- Modify: `dashboard-web/src/lib/format/roasCell.ts`
- Test: `dashboard-web/src/lib/__tests__/roasCell.test.ts` (extend)

- [ ] **Step 1: Add failing tests** (append a describe block to the existing `roasCell.test.ts`)

```ts
import { roasCell } from '@/lib/format/roasCell';

describe('roasCell — off-state (Phase 2)', () => {
  it('default off=false keeps existing behavior (backward compatible)', () => {
    expect(roasCell(3.5, 100, 28)).toMatchObject({ text: '3.50' }); // normal, unchanged
    expect(roasCell(0, 0, 50)).toMatchObject({ className: 'roas-cell-fail', text: '0' });
    expect(roasCell(0, 0, 0)).toMatchObject({ className: '', text: '' });
  });
  it('off + spend 0 + revenue>0 → organic blue "אורגני"', () => {
    const c = roasCell(0, 250, 0, true);
    expect(c.text).toBe('אורגני');
    expect(c.className).toContain('blue');
  });
  it('off + spend 0 + revenue 0 → neutral "0" (not the black fail cell)', () => {
    const c = roasCell(0, 0, 0, true);
    expect(c.text).toBe('0');
    expect(c.className).not.toBe('roas-cell-fail');
    expect(c.className).toContain('glass'); // bg-glass-2 neutral chip
  });
  it('off + spend>0 (historical) → falls back to normal (never retroactively rewritten)', () => {
    expect(roasCell(3.5, 100, 28, true)).toMatchObject({ text: '3.50' });
  });
});
```

- [ ] **Step 2: Run it — confirm FAIL** (`roasCell` only takes 3 args).

- [ ] **Step 3: Implement** — in `dashboard-web/src/lib/format/roasCell.ts`:

(a) Add imports + a neutral constant near `ROAS_BG`:
```ts
import { adDisplayState } from '@/lib/adState';
```
```ts
/** Off-state neutral chip ("0" when ads are off + no/negative revenue). Reuses
 *  the existing gray tone chip (theme-aware, AA-cleared) — deliberately NOT the
 *  black `roas-cell-fail` and NOT blank. */
const ROAS_CELL_NEUTRAL = 'bg-glass-2 text-ink';
```

(b) Extend the `roasCell` signature + branch FIRST on off-state:
```ts
export function roasCell(
  roas: number,
  revenue: number,
  totalSpend: number,
  off = false,
): { className: string; text: string } {
  const state = adDisplayState({ revenue, spend: totalSpend, off });
  if (state === 'organic') return { className: ROAS_BG.blue, text: 'אורגני' };
  if (state === 'off-empty' || state === 'off-negative') {
    return { className: ROAS_CELL_NEUTRAL, text: '0' };
  }
  // 'normal' (incl. off-but-has-spend): existing behavior, byte-for-byte.
  if (revenue === 0 && totalSpend > 0) return { className: 'roas-cell-fail', text: '0' };
  if (revenue === 0 && totalSpend === 0) return { className: '', text: '' };
  return { className: ROAS_BG[roasLabel(roas).tone], text: formatNumber(roas) };
}
```

- [ ] **Step 4: Run it — confirm PASS** + re-run the full `roasCell.test.ts` (existing 13 assertions still green).
- [ ] **Step 5: tsc + eslint.**
- [ ] **Step 6: Commit**

```bash
git add dashboard-web/src/lib/format/roasCell.ts dashboard-web/src/lib/__tests__/roasCell.test.ts
git commit -m "feat(ads-off): roasCell off-aware (organic/neutral, gated on off&&spend==0) (Phase 2)"
```

---

## Task 4: Adapter `toPerStoreData` attaches `adOff`; Dashboard threads ad-state

**Files:**
- Modify: `dashboard-web/src/components/home/PerStoreRow.tsx` (add `adOff?: boolean` to `PerStoreData`)
- Modify: `dashboard-web/src/lib/home/adapters.ts` (`toPerStoreData` computes `adOff`)
- Modify: `dashboard-web/src/components/Dashboard.tsx` (pass `data.adStateMap` + `data.storeApplicablePlatforms` into `toPerStoreData`)
- Test: `dashboard-web/src/lib/home/__tests__/toPerStoreDataAdOff.test.ts` (or extend the existing adapters test)

- [ ] **Step 1: Add the field to `PerStoreData`** (in `PerStoreRow.tsx`, after `roas`):
```ts
  /** ads-off Phase 2 — true when ALL of this store's applicable platforms are
   *  toggled off. Drives the off-display (organic/neutral) at the card +
   *  comparative surfaces. Undefined/false ⇒ normal. */
  adOff?: boolean;
```

- [ ] **Step 2: Write the failing test** (mirror the existing `toPerStoreData` test setup; assert `adOff`):
```ts
// Build the minimal inputs toPerStoreData needs (copy the harness from the
// existing adapters test), then:
//  - storeApplicablePlatforms: { uzoshop: ['meta','google'] }
//  - adStateMap: { 'uzoshop:meta': false, 'uzoshop:google': false }
//  → expect the uzoshop PerStoreData to have adOff === true.
//  - with adStateMap {} → adOff === false (all ON).
```
(Provide the concrete arrange/act/assert using the same fixtures as `src/lib/home/__tests__/adapters*.test.ts`.)

- [ ] **Step 3: Run it — confirm FAIL.**

- [ ] **Step 4: Implement**

(a) In `toPerStoreData` (`adapters.ts:306`), add two optional params and compute `adOff` per store using `isStoreFullyOff`:
```ts
import { isStoreFullyOff, type AdStateMap, type AdPlatform } from '@/lib/adState';
// ...add params (keep existing ones first, append these as optional with defaults):
//   adStateMap: AdStateMap = {},
//   storeApplicablePlatforms: Record<string, AdPlatform[]> = {},
// then, when building each PerStoreData object, set:
//   adOff: isStoreFullyOff(storeId, adStateMap, storeApplicablePlatforms[storeId] ?? []),
```
(b) In `Dashboard.tsx`, at the `toPerStoreData(...)` call, pass `data?.adStateMap ?? {}` and `data?.storeApplicablePlatforms ?? {}` as the new trailing args. (Find the call — the mapping notes it around the per-store data build; read the surrounding lines and append the args to match the new signature.)

- [ ] **Step 5: Run it — confirm PASS** + `npx tsc --noEmit`.
- [ ] **Step 6: Commit**

```bash
git add dashboard-web/src/components/home/PerStoreRow.tsx dashboard-web/src/lib/home/adapters.ts dashboard-web/src/components/Dashboard.tsx dashboard-web/src/lib/home/__tests__/toPerStoreDataAdOff.test.ts
git commit -m "feat(ads-off): toPerStoreData computes per-store adOff; Dashboard threads ad-state (Phase 2)"
```

---

## Task 5: Wire the per-store card (`PerStoreRow`) + `StoreDetailModal`

**Files:**
- Modify: `dashboard-web/src/components/home/PerStoreRow.tsx`
- Modify: `dashboard-web/src/components/home/StoreDetailModal.tsx`
- Test: `dashboard-web/src/components/home/__tests__/PerStoreRow.dom.test.tsx` (extend)

- [ ] **Step 1: Add failing DOM tests** (append cases to `PerStoreRow.dom.test.tsx`, following its existing fixture/queries):
```ts
// case A: a store with adOff:true, spend:0, revenue:250 →
//   the card's data-band is "blue" AND the ROAS hero renders "אורגני" (not a number).
// case B: adOff:true, spend:0, revenue:0 → data-band "gray", ROAS hero shows "0".
// case C: adOff:true, spend:30, revenue:90 (historical) → normal band from roas, number shown (NOT off-state).
// case D: adOff:false → unchanged from today (regression anchor).
```

- [ ] **Step 2: Run — confirm FAIL.**

- [ ] **Step 3: Implement in `PerStoreRow.tsx`** (the StoreCard sub-component, around line 284 + the ROAS hero render around line 388 + the band-tag around line 368):

(a) Import the classifier:
```ts
import { adDisplayState, adDisplayBand } from '@/lib/adState';
```
(b) After `zeroSalesWithSpend` is derived, compute the off-display state + band override (call the pure `useRoasBandGradient` only on the normal path — it is a pure function, conditional calls are fine):
```ts
  const offState = adDisplayState({ revenue: store.revenue, spend: store.spend, off: store.adOff ?? false });
  const offBand = adDisplayBand(offState); // null when 'normal'
  const band = offBand
    ? { band: offBand, desaturate: false }
    : useRoasBandGradient(store.roas, false, zeroSalesWithSpend);
```
(c) Band-tag label (line ~368): for off states show a clear word instead of `BAND_TAG_LABEL[band.band]`:
```tsx
  <span className="band-tag">
    {offState === 'organic' ? 'אורגני' : offState !== 'normal' ? 'כבוי' : BAND_TAG_LABEL[band.band]}
  </span>
```
(d) ROAS hero number (line ~388): render the off-state text instead of the CountUp number when off:
```tsx
  {offState === 'organic' ? (
    'אורגני'
  ) : offState !== 'normal' ? (
    '0'
  ) : zeroSalesWithSpend ? (
    '0.00x'
  ) : (
    <CountUp value={store.roas} format={(n) => `${n.toFixed(2)}x`} />
  )}
```
(e) Mobile spark/delta block (line ~404): also suppress it for off states (no meaningful ROAS trend) — extend the existing `!zeroSalesWithSpend &&` guard to `offState === 'normal' && !zeroSalesWithSpend &&`.

- [ ] **Step 4: Apply the same logic to `StoreDetailModal.tsx`** (the modal header band derivation ~line 136-140). The modal must receive `adOff` — confirm the data it gets carries it (it should come from the same PerStoreData/store record; if not, thread `adOff` into its props). Render the same band override + "אורגני"/"0" header text + label.

- [ ] **Step 5: Run the DOM tests — confirm PASS** + re-run the full `PerStoreRow.dom.test.tsx` (existing 18 cases green).
- [ ] **Step 6: tsc + eslint + design-color guard** — `npx vitest run src/lib/__tests__/designColorGuard.test.ts` (no raw colors introduced).
- [ ] **Step 7: Commit**

```bash
git add dashboard-web/src/components/home/PerStoreRow.tsx dashboard-web/src/components/home/StoreDetailModal.tsx dashboard-web/src/components/home/__tests__/PerStoreRow.dom.test.tsx
git commit -m "feat(ads-off): per-store card + StoreDetailModal off-display (אורגני/neutral) (Phase 2)"
```

---

## Task 6: Wire the comparative table (`StoreCompareGrid` RoasPill)

**Files:**
- Modify: `dashboard-web/src/components/home/StoreCompareGrid.tsx`
- Test: `dashboard-web/src/components/home/__tests__/StoreCompareGrid.dom.test.tsx` (extend)

- [ ] **Step 1: Add failing DOM tests** (append, following the existing pill-tone assertions):
```ts
// store {adOff:true, spend:0, revenue:250} → roas-pill data-tone "blue", text "אורגני".
// store {adOff:true, spend:0, revenue:0}   → roas-pill data-tone "gray", text "0".
// store {adOff:true, spend:40, revenue:120}→ normal pill (number), NOT off-state.
// store {adOff:false} → unchanged.
```

- [ ] **Step 2: Run — confirm FAIL.**

- [ ] **Step 3: Implement** — update the `RoasPill` sub-component (line ~122) to take the store's off context and classify:
```tsx
import { adDisplayState, type AdDisplayState } from '@/lib/adState';
// ...
function RoasPill({ roas, revenue, spend, off }: { roas: number | null; revenue: number | null; spend: number | null; off: boolean }) {
  const state: AdDisplayState = adDisplayState({ revenue, spend, off });
  let tone: RoasTone;
  let text: string;
  if (state === 'organic') { tone = 'blue'; text = 'אורגני'; }
  else if (state === 'off-empty' || state === 'off-negative') { tone = 'gray'; text = '0'; }
  else { tone = roas != null && roas > 0 ? roasLabel(roas).tone : 'gray'; text = roas != null && roas > 0 ? `${roas.toFixed(2)}x` : '—'; }
  return (
    <span data-testid="roas-pill" data-tone={tone} className={cn(/* …existing classes… */, PILL_TONE_CLASS[tone])}>
      <bdi dir={state === 'organic' ? 'rtl' : 'ltr'}>{text}</bdi>
    </span>
  );
}
```
And at the call site (line ~202): `<RoasPill roas={store.roas} revenue={store.revenue} spend={store.spend} off={store.adOff ?? false} />`.

- [ ] **Step 4: Run — confirm PASS** + full `StoreCompareGrid.dom.test.tsx` green.
- [ ] **Step 5: tsc + eslint + design-color guard.**
- [ ] **Step 6: Commit**

```bash
git add dashboard-web/src/components/home/StoreCompareGrid.tsx dashboard-web/src/components/home/__tests__/StoreCompareGrid.dom.test.tsx
git commit -m "feat(ads-off): comparative table RoasPill off-display (Phase 2)"
```

---

## Task 7: Wire the monthly tables (`MonthlyTables`) + `DetailTable`

**Files:**
- Modify: `dashboard-web/src/components/MonthlyTables.tsx`
- Modify: `dashboard-web/src/components/DetailTable.tsx`
- Test: `dashboard-web/src/components/__tests__/monthlyTablesPerPlatform.dom.test.tsx` (extend) + the DetailTable test if present

These tables consume raw `DailyRow`s and `DashboardData`. They must read `adStateMap` + `storeApplicablePlatforms` from the data prop and compute per-row off via `isStoreFullyOff`, then pass `off` to `roasCell`.

- [ ] **Step 1: Add failing DOM tests** (append): a per-store monthly block where the store is fully off + a day with spend 0 + revenue>0 renders the ROAS badge text "אורגני"; a day with spend>0 (historical) renders the normal number; the summary block when all stores off + summed spend 0 + revenue>0 renders "אורגני".

- [ ] **Step 2: Run — confirm FAIL.**

- [ ] **Step 3: Implement**

(a) Thread `adStateMap` + `storeApplicablePlatforms` to `MonthlyTables` (it already receives `data`/rows; add the two as props or read from the existing `data` object — match how it currently gets rows). Add to its Props type (optional, default `{}`).
(b) **Per-store block** (`MonthBlockPerStore`, daily rows ~451 + month total ~493): compute once per store
```ts
const off = isStoreFullyOff(storeId, adStateMap, storeApplicablePlatforms[storeId] ?? []);
```
and change `roasCell(r.roas, r.revenue, r.totalSpend)` → `roasCell(r.roas, r.revenue, r.totalSpend, off)`. (The `off && spend===0` gate inside `roasCell` makes historical spend>0 rows render normally — no per-row off recomputation needed beyond the store-level boolean.)
(c) **Summary block** (`MonthBlockSummary`, ~591 + ~619): compute a business-level off
```ts
const allOff = Object.keys(storeApplicablePlatforms).length > 0
  && Object.keys(storeApplicablePlatforms).every((sid) => isStoreFullyOff(sid, adStateMap, storeApplicablePlatforms[sid] ?? []));
```
and pass `allOff` as the 4th `roasCell` arg for the summary daily + total rows.
(d) **DetailTable** (`roasCell` call ~line 81): if the table has per-row `storeId`, compute `off = isStoreFullyOff(r.storeId, adStateMap, storeApplicablePlatforms[r.storeId] ?? [])` and pass it; thread the two maps via props (optional, default `{}`). If DetailTable has no store context for a row, leave `off=false` (unchanged) and note it.

> Do NOT modify the spend columns — off ⇒ no fetch ⇒ spend is naturally 0; historical spend stays honest. Revenue + rollups stay byte-for-byte.

- [ ] **Step 4: Run — confirm PASS** + full monthly/detail DOM suites green.
- [ ] **Step 5: tsc + eslint + design-color guard.**
- [ ] **Step 6: Commit**

```bash
git add dashboard-web/src/components/MonthlyTables.tsx dashboard-web/src/components/DetailTable.tsx dashboard-web/src/components/__tests__/monthlyTablesPerPlatform.dom.test.tsx
git commit -m "feat(ads-off): monthly tables + DetailTable off-aware ROAS cells (Phase 2)"
```

---

## Task 8: Visual snapshots + axe + full local gate

**Files:**
- Modify: `dashboard-web/tests/visual/states.spec.ts` (ADD new off-state cases; do NOT touch existing band snapshots)
- Verify only: `dashboard-web/src/lib/__tests__/contrastGuard.test.ts`, `tests/visual/contrast.axe.spec.ts`

- [ ] **Step 1: Add 2 NEW off-state visual snapshot cases** (organic blue "אורגני" + neutral "0") to a dedicated block in `states.spec.ts`, snapshotting the off-state card/pill on the existing primitives/dev canvas if one is used by the current band snapshots. Generate baselines: `npm run test:visual:update -- -g "off-state"` (ONLY the new cases — leave the 26 existing baselines untouched).
- [ ] **Step 2: Confirm no existing visual snapshot drifted** — `npm run test:visual 2>&1 | tail -20` (existing band/freshness snapshots unchanged; only the 2 new off-state ones added). If an existing snapshot drifted, the change leaked into a shared surface — investigate, don't blanket-update.
- [ ] **Step 3: Contrast guard** — `npx vitest run src/lib/__tests__/contrastGuard.test.ts` (PASS — we reused existing AA tokens, so no new entry needed; if it fails, a raw color slipped in — fix).
- [ ] **Step 4: Full local gate** — from `dashboard-web/`:
```
npm test && npm run test:components && npx tsc --noEmit && npm run lint
```
Expected: unit + DOM all green; tsc clean; lint 0 errors (pre-existing warnings only).
- [ ] **Step 5: Commit**

```bash
git add dashboard-web/tests/visual/states.spec.ts dashboard-web/tests/visual/states.spec.ts-snapshots/
git commit -m "test(ads-off): off-state visual snapshots (organic/neutral) (Phase 2)"
```

---

## Task 9: Docs + spec addendum

**Files:**
- Modify: `docs/superpowers/specs/2026-06-06-ads-off-state-design.md` (lock Phase 2 semantics)
- Modify: `docs/ARCHITECTURE.md` (§40)
- Modify: `docs/ROAS-Dashboard-User-Manual.md` (version bump + "מה התחדש")

- [ ] **Step 1: Spec addendum** — add a short "Phase 2 locked semantics" note: the `off && spend===0` gate (no retroactive zeroing), off+rev>0→organic blue "אורגני", off+rev≤0→neutral "0", per-store off = ALL applicable platforms off, business summary off = all stores off, hero/RoasTargetChart/GoalTracker untouched, Campaigns/Ads tables deferred.
- [ ] **Step 2: ARCHITECTURE §40** — "Ads-off display layer (Phase 2)": the classifier, the `/api/data` extension, the three color call sites made off-aware, and the explicit non-goals (business surfaces + campaigns tables).
- [ ] **Step 3: User Manual** — bump version (2.45.0 → 2.46.0) keeping the box aligned; add a "מה התחדש" entry: when a store's ads are off, its ROAS shows blue "אורגני" (with revenue) or neutral "0", on the home cards / comparative table / monthly tables; historical spend stays intact; business totals + goal unchanged.
- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-06-06-ads-off-state-design.md docs/ARCHITECTURE.md docs/ROAS-Dashboard-User-Manual.md
git commit -m "docs(ads-off): spec addendum + ARCHITECTURE §40 + User Manual 2.46.0 (Phase 2)"
```

---

## Self-review (run before execution)

- **Spec coverage (§D / §E3 / §J.2):** classifier (T1) ✓ · data flow (T2) ✓ · tables (T3, T7) ✓ · cards + comparative (T4–T6) ✓ · monthly tab (T7) ✓ · tests/guards/snapshots (all + T8) ✓ · docs (T9) ✓.
- **Additive / no-regression:** `off` defaults false everywhere; empty `adStateMap` ⇒ every surface classifies 'normal' ⇒ today's behavior. `useRoasBandGradient` untouched (override at call sites). `roasCell` 4th param optional (CampaignsTableRow/AdSetTable unchanged). Business surfaces (Hero/RoasTargetChart/GoalTracker) explicitly not modified.
- **No retroactive corruption:** off-display gated on `off && spend===0`; historical spend>0 rows render normally; spend columns never rewritten.
- **Type consistency:** `AdDisplayState`, `adDisplayState`, `isStoreFullyOff`, `adDisplayBand`, `adStateMap`, `storeApplicablePlatforms`, `adOff`, `RoasBand`, `roasCell(..., off)` names are identical across tasks.
- **Tokens / a11y:** organic reuses the existing blue ROAS token; neutral reuses `bg-glass-2 text-ind` gray chip — both already AA-cleared in both themes; contrast guard + axe verify (T8). RTL: "אורגני" is Hebrew → `bdi dir="rtl"` in the pill.
- **Open verifications for the implementer:** (a) the exact `toPerStoreData` signature + call site in Dashboard.tsx (T4); (b) whether `DetailTable` rows carry `storeId` (T7d); (c) `StoreDetailModal` receives `adOff` (T5.4); (d) the existing visual-snapshot dev canvas used by `states.spec.ts` (T8).
