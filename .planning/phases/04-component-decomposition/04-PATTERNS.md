# Phase 4: Component Decomposition - Pattern Map

**Mapped:** 2026-05-18
**Files analyzed:** 10 new + 3 modified
**Analogs found:** 10 / 10 (every new file has at least a role/data-flow analog)

> **Read-first for every executor task:** the analog file and the parent source file. Code excerpts in this document are **the contract** — lift verbatim per D-05 (Hebrew strings) and the byte-identical clause in CONTEXT (`trueRevenueByKey`, attribution memos, Pearson + lag detection).
>
> **Convention novelty (D-01):** `dashboard-web/src/lib/hooks/` does not exist yet. There are zero React hooks in the codebase. The closest analogs for the 4 new hook files are (a) pure helper modules in `dashboard-web/src/lib/*.ts` (file-header shape, named exports, type co-location) and (b) the `useMemo`/`useState`/`useEffect` blocks already in the source components being lifted. Each hook section below cites both.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `dashboard-web/src/lib/hooks/useCampaignTrueRevenue.ts` | custom hook (memoizes pure analysis) | props in → memoized Map out (no state, no IO) | `CampaignsTable.tsx:552-682` (source `useMemo`) + `dashboard-web/src/lib/attributionAnalysis.ts` (header/named-export shape) | byte-identical lift |
| `dashboard-web/src/lib/hooks/useCampaignAttribution.ts` | custom hook (memoizes per-ad-set analysis) | props in → memoized `Map<key, AttributionAnalysis \| null>` out | `CampaignDrawer.tsx:278-325` (two source `useMemo`s) + `dashboard-web/src/lib/attributionAnalysis.ts` | byte-identical lift |
| `dashboard-web/src/lib/hooks/useBillingRecurring.ts` | custom hook (state + persistence + event) | localStorage ↔ React state, listens to `roas-billing-changed` | `AnnotationsPanel.tsx:51-80` (closest `useState` + change-listener + write-through analog) + `BillingSettings.tsx:99-196` (source block) | role-match |
| `dashboard-web/src/lib/hooks/useBillingOneTime.ts` | custom hook (state + persistence + event) | localStorage ↔ React state, listens to `roas-billing-changed` | same as `useBillingRecurring` (sibling pattern; identical shape) | role-match |
| `dashboard-web/src/components/CampaignsTableRow.tsx` | sub-component (presentational `<tr>`) | props in (row data + maps + callbacks), JSX only | `DetailTable.tsx` (per-row `<tr>` pattern, plain props-in, no state) | role-match |
| `dashboard-web/src/components/AttributionAnalysisPanel.tsx` | sub-component (panel) | props in (summary + raw orders + range), runs `analyzeAttribution` inline OR receives `analysis` prop | `CampaignDrawer.tsx:707-857` (source seam — already partially separated per ROADMAP) | exact (source seam) |
| `dashboard-web/src/components/MetaShopifyReconciliation.tsx` | sub-component (panel) + named exports `pearson` + `pearsonWithLag` | props in (`reconciliation` object) | `CampaignDrawer.tsx:932-1087` (source seam) + `CampaignDrawer.tsx:1406-1443` (pearson defs) | exact (source seam) |
| `dashboard-web/src/components/ProductChannelBreakdown.tsx` | sub-component (panel) | props in (`breakdown` from `analyzeProductChannel`) | `CampaignDrawer.tsx:863-924` (source seam) | exact (source seam) |
| `dashboard-web/src/components/AdSetTable.tsx` | sub-component (sortable table) | props in (ad-sets, sort state, attribution Map, optimized Set, callbacks) | `CampaignDrawer.tsx:1090-1243` (source) + `AdSetSortHeader` already in same file at 1353-1400 (move with) + `DetailTable.tsx` (table-shape analog) | exact (source seam) |
| `dashboard-web/src/components/BillingCsvImport.tsx` | sub-component (4-stage import) | props in (storeNames, currentRecurring, onImported), local state for csv/preview/file | `BillingSettings.tsx:1044-1328` (source `ImportTab` already separated — just lift to its own file + rename) | exact (source seam, rename only) |
| `dashboard-web/src/components/CampaignsTable.tsx` *(modified, ≤500L shell)* | orchestrator | top-level state + SWR + composes sub-components | self (current file, after extraction) | self |
| `dashboard-web/src/components/CampaignDrawer.tsx` *(modified, ≤500L shell)* | orchestrator | top-level state + SWR + composes sub-components | self | self |
| `dashboard-web/src/components/BillingSettings.tsx` *(modified, ≤500L shell)* | orchestrator | modal state + tab routing + composes 3 tab components | self | self |

**Reading the table:** "exact (source seam)" means the parent file already has a clean JSX block that can be cut and pasted into the new file with no logic change — only an interface (props) is invented. "byte-identical lift" means the entire `useMemo(...)` body and its dep array move verbatim into a custom hook wrapper. "role-match" means no exact analog exists but the role pattern (e.g., a hook that mirrors localStorage state) is exemplified in the cited file.

---

## Pattern Assignments

### `dashboard-web/src/lib/hooks/useCampaignTrueRevenue.ts` (hook, props in → memoized Map out)

**Primary analog (the source block — copy VERBATIM):**
- File: `dashboard-web/src/components/CampaignsTable.tsx`
- Lines: `552-682` (the entire `trueRevenueByKey = useMemo(() => { ... }, [...])` block)
- Reason: CONTEXT D-04 + `<specifics>` first bullet explicitly says "byte-identical when lifted". The hook body IS this `useMemo` body — only the wrapper changes.

**Imports pattern** (mirror file-header shape from `dashboard-web/src/lib/attributionAnalysis.ts:1-25` — Phase 1 module — but with React imports added):
```typescript
import { useMemo } from 'react';
import {
  allocateProductRevenue,
  campaignKey,
  type ProductMap,
} from '@/lib/campaignProductMap';
import {
  analyzeAttribution,
  type AttributionAnalysis,
} from '@/lib/attributionAnalysis';
import type { CampaignRow } from '@/lib/campaigns';
import type { CampaignsResponse } from '@/app/api/campaigns/route';
import type { ProductsResponse } from '@/app/api/products/route';
import type { OrdersAttributionResponse } from '@/app/api/orders-attribution/route';
import type { DateRange } from '@/lib/types';
```
**Source for this import block:** `CampaignsTable.tsx:1-44` — the executor lifts every import the inner `useMemo` references (and drops the rest from CampaignsTable's imports).

**Type-export pattern** (mirror `dashboard-web/src/lib/attributionAnalysis.ts:23-72` — co-locate `type` next to the function that returns it; D-01 establishes the same for hooks):
```typescript
/**
 * Per-campaign output of the true-ROAS allocation. [...verbatim docstring
 * from CampaignsTable.tsx:50-55...]
 */
export type TrueRevenueInfo = {
  trueRevenue: number;
  trueUnits: number;
  metaClaim: number;
  spend: number;
  mappedCount: number;
  sharedCampaigns: number;
  confidence: ConfidenceLevel;
  attribution: AttributionAnalysis | null;
};

export type ConfidenceLevel = {
  level: 'high' | 'medium' | 'low';
  label: string;
  reasons: string[];
};
```
**Source:** `CampaignsTable.tsx:56-87` — move verbatim (the comments contain the load-bearing docstring referenced by checker).

**The `computeConfidence` helper** (`CampaignsTable.tsx:100-173`) moves with the hook — it is pure and consumed only by `trueRevenueByKey`. Export as **module-private** (no `export` keyword) so it cannot be reused. The `applyDowngrade` inner helper stays inside `computeConfidence` exactly as written.

**Hook signature + body** (the verbatim lift — see CONTEXT `<specifics>` first bullet):
```typescript
/**
 * Pure function — no side effects, no IO. Safe to memoize on inputs.
 *
 * "True ROAS" allocation per campaign. [...verbatim docstring from
 * CampaignsTable.tsx:540-551...]
 */
export function useCampaignTrueRevenue(opts: {
  mode: 'campaign' | 'adset';
  data: CampaignsResponse | undefined;
  productsResp: ProductsResponse | undefined;
  ordersAttrResp: OrdersAttributionResponse | undefined;
  productMap: ProductMap;
  aggregated: Aggregated[];   // import or re-declare; see "What's different" below
  localRange: DateRange;
}): Map<string, TrueRevenueInfo> {
  const { mode, data, productsResp, ordersAttrResp, productMap, aggregated, localRange } = opts;
  return useMemo(() => {
    if (mode !== 'campaign') return new Map<string, TrueRevenueInfo>();
    // ... LINES 553-681 OF CampaignsTable.tsx VERBATIM ...
    return out;
  }, [mode, data, productsResp, ordersAttrResp, productMap, aggregated, localRange]);
}
```

**The dep array MUST stay `[mode, data, productsResp, ordersAttrResp, productMap, aggregated, localRange]` byte-identical.** CONTEXT `<code_context>` 3rd bullet under "Established Patterns": *"Dep array drift is the single most likely regression source."*

**What's different here:**
1. The `Aggregated` type is currently defined in `CampaignsTable.tsx:216-238`. Either:
   - (a) Export it from `CampaignsTable.tsx` and import it into the hook, OR
   - (b) Move it to `@/lib/campaigns.ts` (cleaner; matches "type co-location" rule in CONVENTIONS.md §File Organization).
   Pick (b) only if `Aggregated` is reused beyond `CampaignsTable` + the new hook. If only the hook reuses it, (a) keeps the change surface small.
2. The `aggregate()` and `sortAggregated()` functions stay in `CampaignsTable.tsx` (orchestration shell), not in the hook — they consume props local to the shell, not hook inputs.
3. **Parameter style — object args:** per CONVENTIONS.md §Function Design (`analyzeProductChannel` pattern at `attributionAnalysis.ts:799-805`), pass 3+ params as one `opts` object. The destructure line above mirrors that pattern.

**Object-parameter style reference** (CONVENTIONS.md §Function Design):
```typescript
// dashboard-web/src/lib/attributionAnalysis.ts:799-805
export function analyzeProductChannel(opts: {
  productIds: string[];
  orders: OrderAttributionRow[];
  storeId: string;
  dateFrom: string;
  dateTo: string;
}): ProductChannelBreakdown {
  const { productIds, orders, storeId, dateFrom, dateTo } = opts;
  ...
}
```
The hook follows this exact shape.

---

### `dashboard-web/src/lib/hooks/useCampaignAttribution.ts` (hook, props in → memoized Map out)

**Primary analog (the source block — copy VERBATIM):**
- File: `dashboard-web/src/components/CampaignDrawer.tsx`
- Lines: `278-325` (TWO `useMemo` blocks — `dailyMetaByAdSet` lines 278-294 and `attributionByAdSet` lines 299-325)
- Reason: CONTEXT `<specifics>` 2nd bullet — null preserved (don't normalize to undefined). Both memos lift together because `attributionByAdSet` reads from `dailyMetaByAdSet`.

**Imports pattern:**
```typescript
import { useMemo } from 'react';
import {
  analyzeAttributionForAdSet,
} from '@/lib/attributionAnalysis';
```
**Source:** `CampaignDrawer.tsx:33-37`. The hook does NOT need `analyzeAttribution` (campaign-level), only the ad-set variant.

**Hook signature + body** (verbatim lift of both memos):
```typescript
/**
 * Per-ad-set deterministic attribution analysis. Pre-computes once per
 * orders/rows/range change instead of per-cell-per-render. (IN5-01)
 *
 * Returns Map<key, AttributionAnalysis | null> keyed by
 * `adSetId || adSetName || '(אחר)'` — same key formula the drawer's summary
 * aggregation uses, so `a.id` (which may be '') reliably maps back.
 */
export function useCampaignAttribution(opts: {
  summary: { platform: string; adSets: Array<{ id: string; name: string; storeId: string; platform: string; value: number; spend: number }> } | null;
  rows: CampaignRow[];
  ordersAttrData: OrdersAttributionResponse | undefined;
}): Map<string, ReturnType<typeof analyzeAttributionForAdSet>> {
  const { summary, rows, ordersAttrData } = opts;

  // Lift CampaignDrawer.tsx:278-294 VERBATIM into a memo of its own.
  const dailyMetaByAdSet = useMemo(() => {
    const buckets = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const key = r.adSetId || r.adSetName || '(אחר)';
      let b = buckets.get(key);
      if (!b) {
        b = new Map<string, number>();
        buckets.set(key, b);
      }
      b.set(r.date, (b.get(r.date) ?? 0) + r.conversionValue);
    }
    const out = new Map<string, Array<{ date: string; value: number }>>();
    for (const [key, byDate] of buckets) {
      out.set(key, Array.from(byDate, ([date, value]) => ({ date, value })));
    }
    return out;
  }, [rows]);

  // Lift CampaignDrawer.tsx:299-325 VERBATIM (only `dailyMetaByAdSet` source changes — now hook-local).
  return useMemo(() => {
    const out = new Map<string, ReturnType<typeof analyzeAttributionForAdSet>>();
    if (!summary || summary.platform !== 'Meta') return out;
    const ordersRows = ordersAttrData?.rows ?? [];
    if (ordersRows.length === 0 || rows.length === 0) return out;
    const first = rows[0];
    const dateFrom = rows.reduce((min, r) => (r.date < min ? r.date : min), first.date);
    const dateTo = rows.reduce((max, r) => (r.date > max ? r.date : max), first.date);
    for (const a of summary.adSets) {
      const key = a.id || a.name || '(אחר)';
      out.set(key, analyzeAttributionForAdSet(
        { /* same object literal as CampaignDrawer.tsx:310-317 */ },
        ordersRows,
        dateFrom,
        dateTo,
        dailyMetaByAdSet.get(key) ?? [],
      ));
    }
    return out;
  }, [summary, ordersAttrData, rows, dailyMetaByAdSet]);
}
```

**Dep array preservation:** Both memos keep their **byte-identical** dep arrays from `CampaignDrawer.tsx:294` and `:325`. Adding/removing a single dep is a regression — CONTEXT `<code_context>` is explicit.

**What's different here:**
1. The hook returns ONLY `attributionByAdSet`. `dailyMetaByAdSet` becomes internal (was already private to the drawer's render scope).
2. The `summary` shape is duck-typed in the signature above (only the 6 fields the memo reads). The executor can either:
   - (a) Declare a narrower `type CampaignSummary = { ... }` in the hook file and import it both places, OR
   - (b) Let the hook accept the `summary` shape returned by the drawer's `useMemo` at `CampaignDrawer.tsx:190-269` — but that summary type is currently anonymous; promote it to a named type in the same step.
   Prefer (b) with a new shared type `CampaignDrawerSummary` exported from the hook file.

---

### `dashboard-web/src/lib/hooks/useBillingRecurring.ts` (hook, localStorage ↔ state ↔ event)

**Primary role-match analog (closest existing pattern):**
- File: `dashboard-web/src/components/AnnotationsPanel.tsx`
- Lines: `51-80` (entire mount-and-listen pattern)
- Reason: There is no existing hook in the codebase. `AnnotationsPanel.tsx` shows the exact "localStorage + custom event + write-through" pattern that `useBillingRecurring` will encapsulate. The hook is this block lifted out of the component.

**Source block (lifted FROM `BillingSettings.tsx:99-196`):**
- Lines `101` (state init) — `const [recurring, setRecurring] = useState<RecurringCost[]>([]);`
- Lines `133-181` (the `useEffect` mount + listen + cleanup — note the seed-on-empty branch)
- Lines `189-192` (`persistRecurring` writer)
- Lines `184-187` (`totalMonthly` memo — optional; can stay in shell)

**Role-match excerpt — copy this shape exactly** (`AnnotationsPanel.tsx:51-80`):
```typescript
export function AnnotationsPanel({ range, store }: Props) {
  const [items, setItems] = useState<Annotation[]>([]);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    setItems(readAnnotations());
    function onChange() { setItems(readAnnotations()); }
    window.addEventListener('roas-annotations-changed', onChange);
    return () => window.removeEventListener('roas-annotations-changed', onChange);
  }, []);

  const inScope = useMemo(
    () => annotationsInScope(items, range, store),
    [items, range, store],
  );

  function commit(a: Annotation) {
    const next = items.some(x => x.id === a.id)
      ? items.map(x => (x.id === a.id ? a : x))
      : [a, ...items];
    setItems(next);
    writeAnnotations(next);    // writeAnnotations dispatches the event internally
  }
  ...
}
```
**This is THE pattern.** The hook lifts the four lines of state + the entire `useEffect` into a reusable shape.

**Imports pattern:**
```typescript
import { useEffect, useMemo, useState } from 'react';
import {
  readRecurring,
  writeRecurring,
  type RecurringCost,
} from '@/lib/billing';
```
**Source:** `BillingSettings.tsx:18-33` + `dashboard-web/src/lib/billing.ts:87-93` (the read/write functions already exist).

**Hook signature + body:**
```typescript
/**
 * Subscribe to the cloud-synced recurring billing list. The pattern is the
 * same as AnnotationsPanel.tsx:51-80 (cloud-sync hook trio):
 *   1. Hydrate from localStorage on mount
 *   2. Subscribe to the 'roas-billing-changed' custom event (same event
 *      shared with useBillingOneTime — both bills write paths fire it)
 *   3. Re-read on each event
 * The returned `setRecurring` writes through to localStorage + cloud + event
 * via `writeRecurring` in @/lib/billing (which fans out to all three).
 */
export function useBillingRecurring(): {
  recurring: RecurringCost[];
  setRecurring: (next: RecurringCost[]) => void;
  totalMonthly: number;
} {
  const [recurring, setRecurring] = useState<RecurringCost[]>([]);

  useEffect(() => {
    setRecurring(readRecurring());
    function onChange() { setRecurring(readRecurring()); }
    window.addEventListener('roas-billing-changed', onChange);
    return () => window.removeEventListener('roas-billing-changed', onChange);
  }, []);

  const totalMonthly = useMemo(
    () => recurring.filter(r => r.active).reduce((s, r) => s + r.monthlyCAD, 0),
    [recurring],
  );

  function persist(next: RecurringCost[]) {
    setRecurring(next);
    writeRecurring(next);    // dispatches event + pushes to cloud (lib/billing.ts:91-93 + safeWrite at :73-85)
  }

  return { recurring, setRecurring: persist, totalMonthly };
}
```

**Critical wiring contract (UI-SPEC §Interaction Contracts → BillingSettings):** the event name is `'roas-billing-changed'`. Both `writeRecurring` (`lib/billing.ts:91-93`) and `writeOneTime` (`:99-101`) call `safeWrite` (`:73-85`) which dispatches THIS SAME event. **DO NOT invent a separate `'roas-billing-onetime-changed'` event** — UI-SPEC explicitly flags this as an error in the old plan.

**What's different here:**
1. **Seed-on-empty logic stays in the BillingSettings shell, NOT in the hook.** The seed branch (`BillingSettings.tsx:143-164`) depends on `storeNames`, which is a prop. Pulling it into a generic hook would couple the hook to a specific use-site. Keep `seedBillingIfEmpty(storeNames)` invocation in the shell's own `useEffect`, gated on the hook returning `recurring.length === 0` AND `!isHydrated()`.
2. The hook does NOT call `pushCloudKey` directly — `writeRecurring` does that internally (`safeWrite` at `lib/billing.ts:73-85`).

**Reverse pattern reference** (don't break this wiring — UI-SPEC §Interaction Contracts → "Custom event wiring"):
```typescript
// dashboard-web/src/lib/billing.ts:73-85
function safeWrite<T>(key: StateKey, value: T[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new CustomEvent('roas-billing-changed'));
    pushCloudKey(key, value);
  } catch {
    /* ignore — usually quota or private mode */
  }
}
```

---

### `dashboard-web/src/lib/hooks/useBillingOneTime.ts` (hook, localStorage ↔ state ↔ event)

**Same pattern as `useBillingRecurring`** — sibling. Mirror that file's structure exactly.

**Source block (lifted FROM `BillingSettings.tsx:99-196`):**
- Line `102` — `const [oneTime, setOneTime] = useState<OneTimeCost[]>([]);`
- Lines `135` + `153` + `158` + `168` — the four `setOneTime(readOneTime())` calls
- Lines `193-196` — `persistOneTime` writer

**Imports pattern:**
```typescript
import { useEffect, useState } from 'react';
import {
  readOneTime,
  writeOneTime,
  type OneTimeCost,
} from '@/lib/billing';
```

**Hook signature:**
```typescript
export function useBillingOneTime(): {
  oneTime: OneTimeCost[];
  setOneTime: (next: OneTimeCost[]) => void;
} {
  const [oneTime, setOneTime] = useState<OneTimeCost[]>([]);

  useEffect(() => {
    setOneTime(readOneTime());
    function onChange() { setOneTime(readOneTime()); }
    window.addEventListener('roas-billing-changed', onChange);
    return () => window.removeEventListener('roas-billing-changed', onChange);
  }, []);

  function persist(next: OneTimeCost[]) {
    setOneTime(next);
    writeOneTime(next);
  }

  return { oneTime, setOneTime: persist };
}
```

**What's different here vs. `useBillingRecurring`:**
- No `totalMonthly` memo (one-time totals are date-range scoped, computed elsewhere in the P&L breakdown).
- That is the only difference.

**Event-sharing acknowledgement** (UI-SPEC §"Custom event wiring" critical contract): both hooks listen to `'roas-billing-changed'` — when a recurring write fires, this hook will also re-read its one-time list. That re-read is a cheap localStorage read; acceptable.

---

### `dashboard-web/src/components/CampaignsTableRow.tsx` (sub-component, presentational `<tr>`)

**Primary analog (source seam — copy the inline IIFE):**
- File: `dashboard-web/src/components/CampaignsTable.tsx`
- Lines: `1145-1461` (the entire `display.map((a, i) => { ... return <tr>...</tr>; })` body)
- Reason: This is the largest single-purpose JSX block in CampaignsTable. Cutting it out unblocks the ≤500-line target by itself.

**Role-shape analog (for the file-header + signature shape):**
- File: `dashboard-web/src/components/DetailTable.tsx`
- Lines: `1-127` (whole file — small presentational table component, plain props-in, no state, no IO; the smallest table component in the codebase)
- Reason: shows `'use client'` + imports + Tailwind classes + Hebrew strings + table cell shape exactly as the new file should look.

**Imports pattern** (subset of what `CampaignsTable.tsx:1-44` currently imports — keep only what the row JSX touches):
```typescript
'use client';

import { CheckCircle2, Circle, ExternalLink } from 'lucide-react';
import { cn, formatCurrency, formatNumber } from '@/lib/utils';
import { campaignKey } from '@/lib/campaignProductMap';
import { buildAdsManagerLink, type AdAccountMap } from '@/lib/campaignsLinks';
import { roasLabel } from '@/lib/analytics';
import type { Aggregated } from './CampaignsTable';   // OR move Aggregated to lib/campaigns.ts (see hook §1)
import type { TrueRevenueInfo } from '@/lib/hooks/useCampaignTrueRevenue';
```

**TONE_BG constant** (`CampaignsTable.tsx:199-205`): currently duplicated between CampaignsTable and CampaignDrawer. CONTEXT `<specifics>` doesn't force a shared constant, but UI-SPEC §Color "Trust chip color mapping" critical contract says **if `TONE_BG` is hoisted to `@/lib/format.ts` (per existing 04-PLAN T-C), it MUST export the same 5-entry table**. Recommendation: leave the constant duplicated for Phase 4 (smaller diff); the executor can include a tiny duplication line in the task notes per D-04.

**Component signature + JSX body** (cut from `CampaignsTable.tsx:1145-1461`):
```typescript
type Props = {
  a: Aggregated;
  i: number;
  mode: 'campaign' | 'adset';
  trueRevenueByKey: Map<string, TrueRevenueInfo>;
  adAccounts: AdAccountMap;
  optimized: Set<string>;
  onToggleOptimized: (key: string) => void;
  onDrillCampaign: (campaignId: string, platform: string) => void;
  onDrillAd: (set: { storeId: string; campaignId: string; adSetId: string; adSetName: string }) => void;
};

export function CampaignsTableRow({ a, i, mode, trueRevenueByKey, adAccounts, optimized, onToggleOptimized, onDrillCampaign, onDrillAd }: Props) {
  // VERBATIM body of CampaignsTable.tsx:1145-1461 starting at "const roas = ..."
  // and ending at "</tr>". Replace setDrillCampaignId/setDrillPlatform/setAdDrill calls with onDrillCampaign / onDrillAd.
  ...
}
```

**Three callback-substitution points** (these are the ONLY non-mechanical edits in this extraction):
- Line `1173-1174`: `setDrillCampaignId(a.campaignId); setDrillPlatform(a.platform);` → `onDrillCampaign(a.campaignId, a.platform);`
- Line `1178-1183`: `setAdDrill({...})` → `onDrillAd({...})`
- Line `1203`: `toggleOptimized(a.key)` from `@/lib/campaignOptimized` → still `onToggleOptimized(a.key)` (parent has the `optimized` state and the toggle helper)

**Critical preservation contract — UI-SPEC §"Trust chip color mapping" + §"4-levels + fallback":**
- The trust chip ladder at lines `1340-1344` is the source-of-truth for one of the two 4-level ladders in the codebase. Move byte-identical.
- The `·{N}` and `·מיפוי` suffixes (lines `1390` + `1396`) move byte-identical.
- The Hebrew tooltip strings at lines `1360-1380` move byte-identical (D-05).

**Hebrew string contract (D-05):** every Hebrew literal in this block (`'אמין'`/`'חלקי'`/`'לא אמין'` from `info.confidence.label`, the inline tooltip strings `Shopify מוקצה (מיפוי): CAD ...`, the `title` attributes `'לחץ לפרטים מלאים'` etc.) stays verbatim. Reference the UI-SPEC §Copywriting tables (CampaignsTable — Toolbar + states / Column headers / etc.) for the full inventory.

**Stop-propagation pattern** (UI-SPEC §CampaignsTable interactions — "click toggle → no row click; click external link → no row click"):
```typescript
// CampaignsTable.tsx:1200-1203 — preserve verbatim
onClick={e => {
  e.stopPropagation();
  onToggleOptimized(a.key);
}}
```
And the external link `onClick={e => e.stopPropagation()}` at line `1450`.

**What's different here:**
- The row no longer reads `mode` from a closure-captured prop on `CampaignsTable`; it receives `mode` as a prop. No other behavioral change.

---

### `dashboard-web/src/components/AttributionAnalysisPanel.tsx` (sub-component, panel)

**Primary analog (source seam — copy the inline IIFE):**
- File: `dashboard-web/src/components/CampaignDrawer.tsx`
- Lines: `707-857` (the entire `(() => { ... })()` block including the `analyzeAttribution` call + the JSX trust verdict callout)
- Reason: CONTEXT `<code_context>` "Reusable Assets" 2nd bullet — ROADMAP names this as "already partially separated" — easiest extraction. The existing partial seam IS the new file.

**Role-shape analog (for file-header):**
- `dashboard-web/src/components/DetailTable.tsx:1-7` (imports shape — `'use client'` + lucide-react + `cn` + types)

**Imports pattern:**
```typescript
'use client';

import { TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  analyzeAttribution,
  type AttributionAnalysis,
} from '@/lib/attributionAnalysis';
import type { CampaignRow } from '@/lib/campaigns';
import type { OrdersAttributionResponse } from '@/app/api/orders-attribution/route';
```

**Component signature** — TWO acceptable shapes, executor picks:
- **Shape A (panel does the analysis itself):**
```typescript
type Props = {
  summary: { campaignName: string; platform: string; spend: number; value: number; dailyArr: Array<{ date: string; value: number }> };
  campaignId: string;
  storeId: string;
  orderRows: OrderAttributionRow[];
  dateFrom: string;
  dateTo: string;
};
```
- **Shape B (panel receives pre-computed analysis):**
```typescript
type Props = {
  analysis: AttributionAnalysis | null;
  spend: number;
  value: number;
};
```

**Recommendation: Shape B.** UI-SPEC §Components inventory says this panel receives `summary`/`campaignId`/`storeId`/`orderRows`/`rangeFrom`/`rangeTo`, but ALL of `analyzeAttribution`'s args are derivable in the parent — and the early-return `if (!analysis) return null;` at `CampaignDrawer.tsx:739` is cleanly handled by the parent's `{analysis && <AttributionAnalysisPanel ... />}` guard. This matches the "Sub-components are dumb / presentational" critical contract in UI-SPEC §Components.

**JSX body** (cut from `CampaignDrawer.tsx:754-855`):
```typescript
return (
  <section>
    <h3 className="text-sm font-semibold text-text-primary inline-flex items-center gap-1.5 mb-2">
      <TrendingUp size={14} className="text-text-secondary" />
      ניתוח attribution
    </h3>
    {/* trust callout — 4-level color ladder lines 741-745, score header
        762-771, det/meta grid 772-795, breakdown bar 799-816, reasons list
        819-828, recommendation 831-835, stability + outliers 838-853 */}
    {/* COPY VERBATIM from CampaignDrawer.tsx:760-854 */}
  </section>
);
```

**Critical preservation contract — UI-SPEC §Copywriting "AttributionAnalysisPanel":**
- Section heading `'ניתוח attribution'` (line 758)
- All 8 string anchors in UI-SPEC's table — score label `'ציון אמינות'`, det ROAS label `'ROAS אמיתי (click-id)'`, interval prefix `'טווח 95%:'`, etc.
- 4-level trust background ladder at lines `741-745` byte-identical.

**Hebrew RTL contract (D-05):** every Hebrew literal in this block stays verbatim. The recommendation prefix `'💡 המלצה:'` (line 833) includes an emoji — that emoji is part of the literal, do not strip.

**What's different here:**
- The panel returns null (per Shape B) only when `analysis === null` — the early return is now in the parent (`{analysis && <AttributionAnalysisPanel analysis={analysis} ... />}`).
- The `dateFrom`/`dateTo` derivation at `CampaignDrawer.tsx:716-724` (the `rows.reduce(...)` min/max) stays in the parent.

---

### `dashboard-web/src/components/MetaShopifyReconciliation.tsx` (sub-component + named exports `pearson` + `pearsonWithLag`)

**Primary analog (source seam — copy the inline IIFE + the two helpers):**
- File: `dashboard-web/src/components/CampaignDrawer.tsx`
- Lines: `413-460` (the `reconciliation = (() => { ... })()` block — the analysis side)
- Lines: `932-1087` (the JSX panel — the render side)
- Lines: `1406-1443` (the `pearson` + `pearsonWithLag` function defs)
- Reason: CONTEXT `<code_context>` "Reusable Assets" 3rd bullet — `pearson` + `pearsonWithLag` "can be hoisted to `MetaShopifyReconciliation.tsx` as named exports" — confirmed valid per existing 04-PLAN.

**Imports pattern:**
```typescript
'use client';

import { TrendingUp } from 'lucide-react';
import {
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
```

**Component shape — TWO things in one file:**

1. **Two named-exported pure helpers** (copy VERBATIM from `CampaignDrawer.tsx:1406-1443`):
```typescript
/**
 * Pearson correlation coefficient. [...verbatim docstring from
 * CampaignDrawer.tsx:1402-1405...]
 * Pure function — no side effects, no IO. Safe to memoize on inputs.
 */
export function pearson(xs: number[], ys: number[]): number {
  // VERBATIM body of CampaignDrawer.tsx:1407-1425
}

export function pearsonWithLag(xs: number[], ys: number[], lag: number): number {
  // VERBATIM body of CampaignDrawer.tsx:1433-1442
}
```
Tag with `Pure function — no side effects, no IO. Safe to memoize on inputs.` (CONVENTIONS.md §Module Design "no side effects" JSDoc).

2. **The React component** (cut from `CampaignDrawer.tsx:932-1087`):
```typescript
type Props = {
  reconciliation: {
    series: Array<{ date: string; meta: number; shopify: number }>;
    r: number;
    bestLag: number;
    bestR: number;
  };
};

export function MetaShopifyReconciliation({ reconciliation }: Props) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-text-primary inline-flex items-center gap-1.5 mb-2">
        <TrendingUp size={14} className="text-text-secondary" />
        Meta מול Shopify — מתאם יומי
      </h3>
      {/* COPY VERBATIM from CampaignDrawer.tsx:938-1086 */}
    </section>
  );
}
```

**Critical preservation contract — Pearson + lag (CONTEXT `<domain>` In-scope #4 "byte-identical lift of 3 critical logic chunks"):**
- The `pearson(...)` impl (lines `1406-1425`) including the `Math.max(-1, Math.min(1, r))` clamp.
- The `pearsonWithLag(...)` shift logic (lines `1432-1442`).
- The lag-search loop in `reconciliation = (() => { ... })()` at lines `447-458` — including the `if (effectiveN < 5) continue;` guard from #WR-03.

**The `reconciliation` builder** (lines `413-460`) — this is the **decision point** for the executor:
- **Option A:** Move the `reconciliation` IIFE into `MetaShopifyReconciliation.tsx` as an exported helper `buildReconciliation(...)` that the drawer calls. Then the drawer just does `const reconciliation = buildReconciliation({ summary, productsData, mappedIds, storeId }); ...; {reconciliation && <MetaShopifyReconciliation reconciliation={reconciliation} />}`.
- **Option B:** Leave the IIFE in the drawer shell (it consumes `mappedIds`/`productsData`/`storeId` already in scope).
- **Recommendation: Option A** — co-locates the Pearson + lag logic with the consumer; matches UI-SPEC's Components table ("MetaShopifyReconciliation receives `reconciliation`").

**Critical preservation contract — UI-SPEC §Copywriting "MetaShopifyReconciliation":**
- Section heading `'Meta מול Shopify — מתאם יומי'` (line 936)
- All 3 interpretation paragraphs (lines `958-982`) — the strong-tags, the colors, the Hebrew copy ALL stay byte-identical.
- Lag banner copy (lines `989-992`) — including the conditional positive/negative phrasing.
- Tooltip body with `<div dir="rtl">` (line 1015) — UI-SPEC §Typography critical contract: the explicit `dir="rtl"` on the chart tooltip MUST move with the JSX, do not silently drop it.
- Day-by-day table headers `'תאריך'`/`'Meta'`/`'Shopify'`/`'פער'` (lines `1053-1056`).

**Critical preservation contract — UI-SPEC §Color "Recharts SVG colors":**
- The Meta line `stroke="#d97706"` (amber — line 1029)
- The Shopify line `stroke="#15803d"` (roas-green — line 1030)
- The axis tick `fill: '#64748b'` (line 1001)
These hex literals MUST move verbatim — they are Recharts SVG props, not Tailwind classes.

**What's different here:**
- If Option A is chosen, `buildReconciliation` becomes a third named export. Mark it `Pure function — no side effects, no IO. Safe to memoize on inputs.` per CONVENTIONS.md.

---

### `dashboard-web/src/components/ProductChannelBreakdown.tsx` (sub-component, panel)

**Primary analog (source seam — copy the inline IIFE):**
- File: `dashboard-web/src/components/CampaignDrawer.tsx`
- Lines: `863-924` (the entire `productChannelBreakdown && (() => { ... })()` block)
- Reason: This is the cleanest seam in the drawer — already gated on a single boolean, already self-contained JSX.

**Imports pattern:**
```typescript
'use client';

import { Package } from 'lucide-react';
import type { ProductChannelBreakdown as ProductChannelBreakdownType } from '@/lib/attributionAnalysis';
```
**Note:** the existing type `ProductChannelBreakdown` already lives in `@/lib/attributionAnalysis.ts` (returned from `analyzeProductChannel`). Rename in the import to avoid name collision with the component.

**Component signature** (matches UI-SPEC §Components table):
```typescript
type Props = {
  breakdown: ProductChannelBreakdownType;
};

export function ProductChannelBreakdown({ breakdown }: Props) {
  // Counts derived inline at CampaignDrawer.tsx:864-870 — VERBATIM in the function body
  const total = breakdown.totalOrders;
  const fb = breakdown.facebookOrders;
  const google = (breakdown.bySource['google-paid']?.orders ?? 0)
              + (breakdown.bySource['google-organic']?.orders ?? 0);
  const direct = breakdown.bySource['direct']?.orders ?? 0;
  const other = Math.max(0, total - fb - google - direct);
  const fbPct = Math.round(breakdown.facebookShare * 100);
  return (
    <section>
      {/* VERBATIM JSX from CampaignDrawer.tsx:872-923 */}
    </section>
  );
}
```

**Critical preservation contract — UI-SPEC §Copywriting "ProductChannelBreakdown":**
- Section heading `'מכירות לפי ערוץ של המוצרים המשויכים'` (line 876)
- Section tooltip on heading — quoted hover string at line 875 (single quotes inside — preserve escaping)
- Summary line template `'{N} הזמנות של מוצרים משויכים · CAD {X} סה"כ'` (line 882) — note the `&quot;` HTML entity in source, NOT a literal quote
- Bar breakdown line `'פייסבוק: {N} · גוגל: {N} · ישיר: {N} · אחר: {N}'` (line 888)
- Both recommendation chips — green `'💡 ...'` (line 907) and amber `'⚠️ ...'` (line 915) — emojis included.

**Critical gate contract** (UI-SPEC §Empty States — "ProductChannelBreakdown: section hidden"):
The triple-gate (platform Meta / mapped products / ≥3 orders) lives in the parent's `productChannelBreakdown` memo (`CampaignDrawer.tsx:350-374`), NOT in the sub-component. The sub-component renders unconditionally given a non-null breakdown. The parent's `{productChannelBreakdown && <ProductChannelBreakdown breakdown={productChannelBreakdown} />}` keeps the gate.

**What's different here:**
- The `analyzeProductChannel(...)` call (`CampaignDrawer.tsx:363-369`) stays in the parent's memo at `:350-374`. This memo's whole body stays in the drawer shell.

---

### `dashboard-web/src/components/AdSetTable.tsx` (sub-component, sortable table)

**Primary analog (source seam — copy the section + the local helper):**
- File: `dashboard-web/src/components/CampaignDrawer.tsx`
- Lines: `1090-1243` (the entire `summary.adSets.length > 0 && ( <section>...</section> )` block including the table body)
- Lines: `1353-1400` (the local `AdSetSortHeader` helper — moves WITH the table)
- Reason: All 4 behaviors named in CONTEXT `<specifics>` 5th bullet (sort headers + per-row toggle + drill-to-ads + per-ad-set trust chip) live in this block.

**Role-shape analog (for the table shell):**
- `dashboard-web/src/components/DetailTable.tsx:43-97` (table-with-sticky-thead pattern — exact `overflow-auto max-h-...` wrapper shape).

**Imports pattern:**
```typescript
'use client';

import {
  Layers,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  CheckCircle2,
  Circle,
} from 'lucide-react';
import { cn, formatCurrency, formatNumber } from '@/lib/utils';
import { roasLabel } from '@/lib/analytics';
import type { AttributionAnalysis } from '@/lib/attributionAnalysis';
```

**Component signature** (matches UI-SPEC §Components table):
```typescript
type AdSetSortKey = 'name' | 'spend' | 'budget' | 'value' | 'roas' | 'conversions';
type AdSetSortDir = 'asc' | 'desc';

type AdSetItem = {
  id: string;
  name: string;
  storeId: string;
  platform: string;
  campaignId: string;
  spend: number;
  value: number;
  clicks: number;
  impressions: number;
  conversions: number;
  adSetBudgetCad: number | null;
  roas: number;
};

type Props = {
  adSets: AdSetItem[];
  sortKey: AdSetSortKey;
  sortDir: AdSetSortDir;
  onSort: (key: AdSetSortKey) => void;
  attributionByAdSet: Map<string, AttributionAnalysis | null>;
  optimized: Set<string>;
  onToggleOptimized: (key: string) => void;
  onDrillAds: (set: { storeId: string; campaignId: string; adSetId: string; adSetName: string }) => void;
};
```

**Export type chain:** `AdSetSortKey` + `AdSetSortDir` should be exported (the parent passes them in). The parent declares them currently at `CampaignDrawer.tsx:101-102` — move to this file and `import type { AdSetSortKey, AdSetSortDir } from './AdSetTable'` in the drawer.

**The `AdSetSortHeader` helper** (`CampaignDrawer.tsx:1353-1400`) — move into the same file, KEEP IT MODULE-PRIVATE (no `export`). It's only consumed by `AdSetTable`.

**JSX body** (cut from `CampaignDrawer.tsx:1090-1243`):
```typescript
export function AdSetTable({ adSets, sortKey, sortDir, onSort, attributionByAdSet, optimized, onToggleOptimized, onDrillAds }: Props) {
  return (
    <section>
      {/* VERBATIM JSX from CampaignDrawer.tsx:1091-1242 */}
      {/* Replace setAdDrillSet({...}) at line 1148-1153 with onDrillAds({...}) */}
      {/* Replace onToggle(markKey) at line 1166 with onToggleOptimized(markKey) */}
      {/* `attributionByAdSet` is now a prop, not a closure-captured useMemo result */}
    </section>
  );
}

function AdSetSortHeader({ label, col, sortKey, dir, onClick, align }: {...}) {
  // VERBATIM from CampaignDrawer.tsx:1353-1400
}
```

**Critical preservation contract — IN5-01 visual symptom (UI-SPEC §"Critical contract"):**
> "`AdSetTable.tsx` MUST grep clean for `analyzeAttributionForAdSet`. Zero direct calls. The visual symptom of a missed extraction is chip flicker on sort + opacity flash during scroll."

Verify post-extraction:
```bash
grep -n "analyzeAttributionForAdSet" dashboard-web/src/components/AdSetTable.tsx   # MUST return zero matches
```

**Critical preservation contract — UI-SPEC §Copywriting "AdSetTable":**
- Section heading `'אד-סטים ({N})'` (line 1094)
- All 7 column labels (lines `1109-1120` — `'שם'`/`'הוצאה'`/`'תקציב יומי'`/`'ערך'`/`'ROAS'`/`'ROAS Shopify'`/`'המרות'`)
- Hover hint `'לחץ לראות את המודעות באד-סט'` (line 1155)
- Trust tooltip header template `'ROAS אמיתי · {label} ({score}/100)'` (line 1217)
- Optimization toggle tooltip strings (line 1174 — both states)

**Critical preservation contract — 4-level trust chip ladder:**
- Lines `1211-1215` — second of the two byte-identical ladders. UI-SPEC §Color "Critical contract — Trust chip color mapping" pins this. Move byte-identical.

**Critical preservation contract — UI-SPEC §"#IN-06 boolean coercion":**
- Line 1137: `const canDrillToAds = !!(a.platform === 'Meta' && a.id);` — the `!!()` is load-bearing (forces strict boolean). Preserve verbatim.

**What's different here:**
- The `attributionByAdSet` Map (currently from a `useMemo` in the drawer) is now a prop. UI-SPEC's wiring contract explicitly verifies this stays a prop, not an inline call.
- Three callback substitutions (toggle, drill, onSort) — same pattern as CampaignsTableRow.

---

### `dashboard-web/src/components/BillingCsvImport.tsx` (sub-component, 4-stage CSV import)

**Primary analog (source seam — copy the WHOLE `ImportTab` body):**
- File: `dashboard-web/src/components/BillingSettings.tsx`
- Lines: `1044-1328` (the entire `function ImportTab({...}) {...}` — already a self-contained sub-component)
- Reason: This is the easiest extraction in Phase 4 — `ImportTab` is already a properly-isolated function component inside the same file. Move file → rename.

**Imports pattern:**
```typescript
'use client';

import { useMemo, useRef, useState } from 'react';
import { Upload, AlertCircle, Check } from 'lucide-react';
import { cn, formatCurrency } from '@/lib/utils';
import {
  findMatchingRecurring,
  generateId,
  parseShopifyBillsCsv,
  type CostSource,
  type OneTimeCost,
  type ParsedBillLine,
  type RecurringCost,
} from '@/lib/billing';
```
**Source:** `BillingSettings.tsx:1-33` (subset — only what `ImportTab` references).

**Component shape** (matches UI-SPEC §Components table — `BillingCsvImport` receives `storeNames`, `currentRecurring`, `onImported`):
```typescript
type PreviewRow = ParsedBillLine & {
  type: 'recurring' | 'onetime';
  store: string;
  skip: boolean;
  duplicateOfId?: string;
};

type Props = {
  storeNames: string[];
  currentRecurring: RecurringCost[];
  onImported: (
    newRecurring: RecurringCost[],
    newOneTime: OneTimeCost[],
    destination: 'recurring' | 'onetime',
  ) => void;
};

export function BillingCsvImport({ storeNames, currentRecurring, onImported }: Props) {
  // VERBATIM body of BillingSettings.tsx:1057-1326 (lines 1057 is the first state hook, 1326 is the closing brace)
}
```

**The `SOURCE_LABEL` and `SOURCE_COLOR` constants** (`BillingSettings.tsx:78-96`):
- Both are consumed by the preview rendering (lines `1313-1317`).
- Either:
  - (a) Move both to `BillingCsvImport.tsx` (currently only consumed by ImportTab in the source file — but RecurringTab/OneTimeTab also use them).
  - (b) Hoist to `@/lib/billing.ts` as exports.
- **Recommendation: (b)** — clean shared home matches the "type co-location" convention. The constants are presentational labels for the `CostSource` union exported from `lib/billing.ts`; that's where they belong.

**Critical preservation contract — UI-SPEC §Copywriting "BillingSettings — Modal shell + tabs" + the import-tab-specific strings:**
The instructions paragraph at `BillingSettings.tsx:1146-1162` (`'איך מוציאים CSV מ-Shopify:'` etc.) contains 5 Hebrew strings + a numbered list. All move verbatim. Note the HTML entities (`&quot;`, `&apos;`) — preserve verbatim, do NOT swap for raw characters.

**Critical preservation contract — UI-SPEC §"Tab routing":**
- The 3-tab order recurring → onetime → import (`BillingSettings.tsx:253-256`) is enforced by the SHELL's `<nav>` block. The tab content (`{tab === 'import' && <BillingCsvImport ... />}`) stays in the shell.
- The mount-style is conditional render (NOT `display:none`). UI-SPEC critical contract: "do NOT switch to display: none hidden tabs, which would change React unmount behavior + lose form state."

**What's different here:**
- File name changes from `ImportTab` (internal function name) to `BillingCsvImport` (exported component name) — UI-SPEC §Components table is explicit on this naming.
- The shell's call site in `BillingSettings.tsx:296-307` changes from `<ImportTab ... />` to `<BillingCsvImport ... />`.

---

## Shared Patterns

### Authentication
**Not applicable.** Phase 4 is a UI refactor; no auth code changes. All API routes auth via `getAuth()` in `dashboard-web/src/lib/sheets.ts` — that file is untouched.

### Error Handling
**Source:** existing soft-fail patterns already in the source components.
**Apply to:** All new sub-components inherit these from the parent. None introduce new error handling.

**Reference (CampaignDrawer SWR error pattern — `CampaignDrawer.tsx:143-161`):**
```typescript
const { data: productsData } = useSWR<ProductsResponse>(
  open ? '/api/products' : null,
  async (url: string) => {
    const r = await fetch(url);
    if (!r.ok) return { rows: [], lastUpdated: new Date().toISOString() };  // soft-fail
    return r.json();
  },
  { revalidateOnFocus: false, dedupingInterval: 60_000 },
);
```
This pattern stays in the parent shells (CampaignsTable, CampaignDrawer, BillingSettings). The new sub-components receive already-fetched data via props and do not call `useSWR` themselves (UI-SPEC §Components critical contract: *"Sub-components are dumb / presentational. They do NOT call `useSWR`."*).

### Validation
**Not applicable.** No input validation paths change in Phase 4.

### Hebrew RTL string handling (D-05 — load-bearing)
**Source:** every Hebrew literal in the 3 source files.
**Apply to:** all 7 new sub-components (every JSX text node + every `title=`/`aria-label=` attribute).

**Rule:** copy byte-identical. No `dir=` introductions or removals (RTL is inherited from `<html dir="rtl">` per UI-SPEC §Design System — except the explicit `<div dir="rtl">` on the reconciliation chart tooltip at `CampaignDrawer.tsx:1015` which MUST move with the JSX).

**Verify post-extraction** (no tooling — manual grep):
```bash
# For every new sub-component file, grep for the canonical anchors
# from the UI-SPEC Copywriting tables. Example for AttributionAnalysisPanel:
grep -F 'ניתוח attribution' dashboard-web/src/components/AttributionAnalysisPanel.tsx
grep -F 'ציון אמינות' dashboard-web/src/components/AttributionAnalysisPanel.tsx
# ... etc. for every string in the UI-SPEC anchor table.
```

### `tabular-nums` className on numeric cells (CONVENTIONS.md §React Patterns)
**Source:** `dashboard-web/src/lib/format.ts:69-76` — `bdi()` defaults `className: 'tabular-nums'`.
**Apply to:** every numeric `<td>` / KPI value in the new sub-components.

**Rule:** when moving JSX from parent to sub-component, never strip `tabular-nums` from any node. UI-SPEC §Typography critical contract: *"`tabular-nums` className appears on every numeric cell."*

### `'use client'` directive (CONVENTIONS.md §React Patterns)
**Source:** all 32 components in `dashboard-web/src/components/` start with `'use client';`.
**Apply to:** all 7 new sub-component files. The 4 new hook files in `lib/hooks/` follow the existing `dashboard-web/src/lib/*.ts` pattern — **no `'use client'` directive** (hooks are imported by client components; they don't need to opt in themselves, but executor should confirm with a `npm run build` after the first hook file lands).

### Custom event wiring (CONVENTIONS.md §"localStorage + cloud-sync")
**Source:** `dashboard-web/src/lib/billing.ts:79` + `dashboard-web/src/lib/campaignOptimized.ts:39` + others.
**Apply to:** the 2 billing hooks (`useBillingRecurring`, `useBillingOneTime`).

**Rule (the SINGLE event for billing):**
- Recurring writes → `'roas-billing-changed'`
- One-time writes → `'roas-billing-changed'` (SAME event)
- Both hooks listen to the SAME event.
- **DO NOT invent `'roas-billing-onetime-changed'`** — it does not exist in the codebase. UI-SPEC §"Custom event wiring" critical contract pins this.

### Imports order (CONVENTIONS.md §Import Organization)
**Source:** `CampaignsTable.tsx:1-44` (canonical 8-step order).
**Apply to:** every new file. The 8 steps:
1. `'use client';` (component files only — NOT hook files)
2. React/Next/external React packages (`useEffect`, `useMemo`, `useState`, `useSWR`, `useRef`)
3. Icon imports (`lucide-react`) — grouped
4. Recharts / other heavy externals (if used)
5. `@/lib/*` helpers
6. `@/lib/*` data shapes (`type CampaignRow`, etc.)
7. `@/app/api/*` response types
8. `./` local components last

Each new file MUST follow this order. The hook files skip step 1 + step 8 (no `'use client'`, no local component imports — they live in `lib/hooks/`).

---

## No Analog Found

**None.** Every new file has at least a role-match or source-seam analog. The 4 hook files lack a hook-specific analog (none exist), but the role-match analogs (`AnnotationsPanel.tsx` listener pattern + the source `useMemo`/`useEffect` blocks in the parents) cover every pattern decision the executor needs.

If during execution the planner discovers a 4th hook or 8th sub-component is needed (e.g., a `useCampaignFilters` hook lifted from the toolbar state), use the same dual-analog strategy: cite (a) the source block in the parent + (b) the closest existing pattern (`AnnotationsPanel.tsx` for state-listener hooks, `DetailTable.tsx` for table sub-components, `MetricHelp.tsx` for popover-style panels).

---

## Metadata

**Analog search scope:**
- `dashboard-web/src/components/` (32 files, ~30 functional components)
- `dashboard-web/src/lib/` (24 files, pure helpers + types)
- `dashboard-web/src/lib/hooks/` (does not exist — confirmed via `ls`)
- The 3 source components being split (CampaignsTable / CampaignDrawer / BillingSettings)

**Files read in full or in targeted ranges:**
- `dashboard-web/src/components/CampaignsTable.tsx` (1740L total — read lines 1-200, 200-460, 540-700, 1130-1470, 1530-1640)
- `dashboard-web/src/components/CampaignDrawer.tsx` (1443L total — read lines 1-550, 700-1150, 1150-1443)
- `dashboard-web/src/components/BillingSettings.tsx` (1328L total — read lines 1-300, 315-435, 1044-1328)
- `dashboard-web/src/components/AnnotationsPanel.tsx` (read lines 1-120 — analog for hooks)
- `dashboard-web/src/components/DetailTable.tsx` (read in full, 127L — analog for sub-components)
- `dashboard-web/src/lib/billing.ts` (read in full, 562L — context for hooks)
- `dashboard-web/src/lib/campaignOptimized.ts` (read in full, 61L — event-wiring reference)
- `.planning/phases/04-component-decomposition/04-CONTEXT.md` (read in full)
- `.planning/phases/04-component-decomposition/04-UI-SPEC.md` (read in full)
- `.planning/codebase/CONVENTIONS.md` (read in full)
- `.planning/codebase/ARCHITECTURE.md` (read in full)

**Pattern extraction date:** 2026-05-18

---

## Planner Read-First Block Recipe

For each new-file plan, the planner should generate a `<read_first>` block in this exact shape so executors land on the right source line ranges before writing a single character:

```markdown
<read_first>
**Required reading (in order):**
1. `.planning/phases/04-component-decomposition/04-CONTEXT.md` — D-01..D-07 + canonical refs
2. `.planning/phases/04-component-decomposition/04-UI-SPEC.md` — §Copywriting + §Color anchors for this component
3. `.planning/phases/04-component-decomposition/04-PATTERNS.md` — Pattern Assignments → this file's section
4. `dashboard-web/src/components/{ParentComponent}.tsx` (lines {AAA-BBB}) — verbatim source block
5. `dashboard-web/src/components/{AnalogFile}.tsx` (lines {CCC-DDD}) — shape analog
**Critical preservation contract:**
- Hebrew literals (D-05) byte-identical
- Dep arrays byte-identical (where applicable)
- {Per-file critical line, e.g., "grep clean for analyzeAttributionForAdSet"}
</read_first>
```

This standardization means each executor opens at most 5 files before writing — keeps the context surface tight on a 1M-token budget.
