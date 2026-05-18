---
phase: 04-component-decomposition
reviewed: 2026-05-19T00:00:00Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - dashboard-web/src/lib/hooks/useCampaignTrueRevenue.ts
  - dashboard-web/src/lib/hooks/useCampaignAttribution.ts
  - dashboard-web/src/lib/hooks/useBillingRecurring.ts
  - dashboard-web/src/lib/hooks/useBillingOneTime.ts
  - dashboard-web/src/components/CampaignsTableRow.tsx
  - dashboard-web/src/components/AttributionAnalysisPanel.tsx
  - dashboard-web/src/components/MetaShopifyReconciliation.tsx
  - dashboard-web/src/components/ProductChannelBreakdown.tsx
  - dashboard-web/src/components/AdSetTable.tsx
  - dashboard-web/src/components/BillingCsvImport.tsx
  - dashboard-web/src/components/CampaignsTable.tsx
  - dashboard-web/src/components/CampaignDrawer.tsx
  - dashboard-web/src/components/BillingSettings.tsx
  - dashboard-web/src/components/Dashboard.tsx
findings:
  blocker: 1
  warning: 5
  info: 4
  total: 10
status: issues_found
---

# Phase 04: Code Review Report

**Reviewed:** 2026-05-19T00:00:00Z
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

## Summary

The refactor mechanically extracts 4 hooks and 6 presentational sub-components out of three shells (CampaignsTable, CampaignDrawer, BillingSettings). Promised byte-identical preservation of Hebrew strings, Tailwind classes, trust-chip ladders, memo deps, custom event names, and Recharts SVG hex colors holds up under direct comparison against the diff base `48ec9b3`:

- **Custom event wiring** — `'roas-billing-changed'` is the only billing event in both hooks (`useBillingRecurring.ts:37`, `useBillingOneTime.ts:27`), the writer (`lib/billing.ts:79`), the cloudSync mapper (`lib/cloudSync.ts:59-60`), the parent Dashboard re-aggregator (`Dashboard.tsx:109-110`), and the PnLBreakdown listener (`PnLBreakdown.tsx:77-78`). No stray variants.
- **Hebrew RTL strings + HTML entities** — `&quot;` in `ProductChannelBreakdown.tsx:41`, `&apos;` in `BillingCsvImport.tsx:146`, all chip labels (`אמין`/`חלקי`/`לא אמין`), trust panel copy, and the parenthetical "·מיפוי" / "·{n}" decorations are character-for-character identical to the pre-refactor source.
- **Trust chip 4-level ladder** is byte-identical across `CampaignsTableRow.tsx:238-242` and `AdSetTable.tsx:206-210` (high → `roas-green`, medium → `amber-700`, unknown → `text-secondary`, fallback → `roas-red`).
- **Recharts SVG hex colors** preserved: `#dc2626` / `#15803d` in CampaignDrawer chart, `#d97706` / `#15803d` / `#64748b` in MetaShopifyReconciliation.
- **Memo correctness** — `useCampaignTrueRevenue` lists all seven destructured fields in its dep array; `useCampaignAttribution` correctly includes `dailyMetaByAdSet` (a useMemo product) so its outer memo invalidates transitively.
- **Map vs new-Map semantics** — `useCampaignTrueRevenue` builds a fresh Map per recompute (no shared mutation); `useCampaignAttribution`'s gate-failure path returns the same Map declared inside the memo, so reference equality holds while deps don't change.

The one **BLOCKER** is a real regression in `BillingCsvImport`: when the user changes `defaultStore`, the in-progress preview rows get re-bound to the new store, but the duplicate-detection flag (`skip` + `duplicateOfId`) is NOT recomputed — so a row that was a duplicate against `store A` keeps the `skip=true` checkbox after switching to `store B`, even though `findMatchingRecurring` is store-scoped (`billing.ts` — recurring lookups filter by `r.store === store`). This silently mis-classifies CSV lines on store change. The pre-refactor `ImportTab` had the identical bug, but the extraction is a fresh opportunity to fix it; flagging it for the same reason "pure mechanical refactor" plans should still catch latent bugs surfaced during careful re-read.

WARNINGS cluster around four themes: (1) `useBillingRecurring` / `useBillingOneTime` shadow `setRecurring` / `setOneTime` (raw setter inside the hook, wrapped `persist` outside) without `useCallback`, so the returned setter is a fresh function reference on every render and any memoized consumer is forced to invalidate; (2) the `defaultStore` `useState(storeNames[0] ?? 'All')` in `BillingCsvImport` does not react to `storeNames` prop changes (stale initial value); (3) the hook destructure pattern means `useCampaignTrueRevenue`'s `opts` object identity matters for ESLint exhaustive-deps to keep working — the inner memo deps list each field but the linter sees the destructure separately; (4) double re-render on every billing write (state setter + event-driven re-read of the same data).

## Critical Issues

### CR-01: Duplicate-detection not recomputed when `defaultStore` changes in BillingCsvImport

**File:** `dashboard-web/src/components/BillingCsvImport.tsx:155-161`

**Issue:** The `<select>` onChange handler updates `defaultStore` state and rebinds the `store` field on existing preview rows, but it does NOT re-run `findMatchingRecurring(p, newStore, currentRecurring)` to recompute the `skip` and `duplicateOfId` flags. Because `findMatchingRecurring` matches on store (`billing.ts` filters by `r.store === store`), changing the destination store from "Store A" to "Store B" can:
  - Leave `skip=true` on a row that was duplicate-of-A but is unique-to-B (user must manually uncheck → easy to miss for a 20-row import).
  - Leave `skip=false` on a row that is now duplicate-of-B (user double-adds the recurring, the very harm the duplicate flag exists to prevent).

The bug also exists in the pre-refactor `ImportTab`, but the refactor consolidated `buildPreview` as a self-contained helper that should be the seam for the fix. The data-loss potential (double-adding monthly recurring costs that then silently inflate P&L) merits BLOCKER classification.

**Fix:**

```ts
// In the <select> onChange (around line 157):
onChange={e => {
  const next = e.target.value;
  setDefaultStore(next);
  // Re-bind store AND recompute duplicate flag against the new store.
  setPreview(prev => prev.map(r => {
    const dupe = findMatchingRecurring(r, next, currentRecurring);
    return {
      ...r,
      store: next,
      skip: !!dupe,
      duplicateOfId: dupe?.id,
    };
  }));
}}
```

A regression test should assert: import a row matching a Store-A recurring, switch destination to Store-B (no matching recurring), confirm `skip` becomes false.

## Warnings

### WR-01: `useBillingRecurring` / `useBillingOneTime` return non-memoized setters

**File:** `dashboard-web/src/lib/hooks/useBillingRecurring.ts:46-51`, `dashboard-web/src/lib/hooks/useBillingOneTime.ts:31-37`

**Issue:** The exported `setRecurring: persist` (and analogously `setOneTime: persist`) is a fresh function reference on every render of the hook caller. The pre-refactor inline implementation had the same property, but extracting into a hook is the conventional moment to wrap with `useCallback`. Any future consumer that does `useMemo(() => ..., [setRecurring])` or `React.memo(child, ...)` on a child receiving `setRecurring` as a prop will invalidate every render. With only one consumer today (`BillingSettings`), the practical cost is zero, but the contract a hook publishes ("here is a setter") is expected to return a stable reference in modern React code.

**Fix:**

```ts
import { useCallback } from 'react';

const persist = useCallback((next: RecurringCost[]) => {
  setRecurring(next);
  writeRecurring(next);
}, []); // setRecurring is stable, writeRecurring is module-scope

return { recurring, setRecurring: persist, totalMonthly };
```

### WR-02: `defaultStore` in BillingCsvImport ignores `storeNames` prop changes

**File:** `dashboard-web/src/components/BillingCsvImport.tsx:46`

**Issue:** `const [defaultStore, setDefaultStore] = useState(storeNames[0] ?? 'All')` only reads `storeNames[0]` at component initialization. If the parent's SWR refetch returns a new `data.stores` list (e.g., a newly-onboarded store appears), `defaultStore` stays pinned to the previous first store. The `<select>` then renders a value that does not match any `<option>`, producing a React DOM warning ("invalid value for select") and forcing the user to re-pick. Same bug existed pre-refactor; the extraction is a clean place to fix it. Lower than BLOCKER because the user can self-recover by re-selecting from the dropdown.

**Fix:** Sync via effect:

```ts
const [defaultStore, setDefaultStore] = useState(storeNames[0] ?? 'All');
useEffect(() => {
  if (!storeNames.includes(defaultStore) && defaultStore !== 'All') {
    setDefaultStore(storeNames[0] ?? 'All');
  }
}, [storeNames, defaultStore]);
```

### WR-03: Double re-render on every billing write

**File:** `dashboard-web/src/lib/hooks/useBillingRecurring.ts:46-49`, `dashboard-web/src/lib/hooks/useBillingOneTime.ts:31-34`

**Issue:** Inside `persist`:
1. `setRecurring(next)` — schedules render with `next` as new state.
2. `writeRecurring(next)` synchronously dispatches `'roas-billing-changed'`.
3. The same hook's own listener fires: `setRecurring(readRecurring())` — a different array reference even though semantically equal.

React batches the two setState calls inside an event handler boundary, but when `persist` is called outside React event handlers (e.g., from a Promise callback in CSV import flow), this produces two distinct re-renders with identical data. Each re-render re-runs the `totalMonthly` memo's filter+reduce. The hook also re-reads localStorage twice (`readRecurring()` returns a new array → new `recurring` state ref → all dependent memos invalidate).

This is preserved behavior from the pre-refactor inline implementation (no regression), but the refactor is the natural moment to break the loop by suppressing the redundant re-read in the listener when the write is self-initiated.

**Fix:** Skip the listener bounce when the listener was triggered by our own write:

```ts
function persist(next: RecurringCost[]) {
  setRecurring(next);
  // Suppress the next event-driven re-read since we already have `next`.
  const skipNext = { current: true };
  // ... or use a ref-based dedupe inside onChange
  writeRecurring(next);
}
```

A cleaner approach is to short-circuit `onChange` when the read result is deep-equal to current state, but at this point a deep-compare may cost more than the wasted render. Either way, document the intent.

### WR-04: `useCampaignAttribution` retypes `analyzeAttributionForAdSet` return implicitly via `ReturnType`

**File:** `dashboard-web/src/lib/hooks/useCampaignAttribution.ts:66`, `dashboard-web/src/components/AdSetTable.tsx:69`

**Issue:** The hook declares its return type as `Map<string, ReturnType<typeof analyzeAttributionForAdSet>>`, but the AdSetTable prop type is `Map<string, AttributionAnalysis | null>` (the explicit named type). These should match at runtime because `analyzeAttributionForAdSet` is declared `: AttributionAnalysis | null`, but the dual-source-of-truth typing means a future change to `analyzeAttributionForAdSet`'s return type silently propagates through the hook without updating the consuming AdSetTable's prop contract — TypeScript may compile because they happen to align via `ReturnType`, but the divergence between "what the hook says it returns" and "what AdSetTable's prop type declares" is exactly the kind of seam regression that hides in mechanical refactors.

**Fix:** Use the explicit named import in both places:

```ts
import type { AttributionAnalysis } from '@/lib/attributionAnalysis';

export function useCampaignAttribution(...): Map<string, AttributionAnalysis | null> {
  // ...
}
```

### WR-05: `useCampaignTrueRevenue` dep list relies on destructure stability

**File:** `dashboard-web/src/lib/hooks/useCampaignTrueRevenue.ts:165-166, 296`

**Issue:** The hook accepts a single `opts` object and immediately destructures all seven fields. The `useMemo`'s dep array lists each destructured field. This is correct, but the pattern is fragile: if a future maintainer adds a new field to `opts` and reads it inside the memo but forgets the dep, ESLint's exhaustive-deps rule will detect the missing local variable correctly — UNLESS they reach into `opts.newField` directly without destructuring, in which case the linter sees `opts` as the dep (which is never listed — only the destructured fields are). Today the linter would warn on the missing field; the warning is only nudge-strength.

The hook would be more robust against this if the dep array listed `opts` (and the call-site memoized `opts` with `useMemo`) OR if each field had a discrete top-level binding before any branch.

Also: the dep list does not include `localRange.from` / `localRange.to` separately. `localRange` is React state in CampaignsTable (`useState<DateRange>(range)`), only updated via `setLocalRange`, so reference equality holds whenever the value doesn't change. Pre-refactor, this exact memo lived inside CampaignsTable with `localRange` as a dep — same shape, same behavior. No regression, but worth a sentence in the hook docstring to lock down the "DateRange must be set with a fresh object" convention against future devs who might `setLocalRange(prev => { prev.from = ...; return prev; })`.

**Fix:** Either inline-bind each prop:

```ts
const { mode, data, productsResp, ordersAttrResp, productMap, aggregated, localRange } = opts;
// ...explicit refs to all named vars in the memo deps below
```

(which is what the code does — good) OR add a `useMemo` discipline note to the docstring:

```ts
/**
 * ...
 * IMPORTANT: `localRange` must be replaced (not mutated) on every change.
 * The dep array compares by reference; in-place mutation would be invisible.
 */
```

## Info

### IN-01: Variable shadowing — `info` reused for two different concepts in CampaignsTableRow

**File:** `dashboard-web/src/components/CampaignsTableRow.tsx:50, 199, 307, 321`

**Issue:** Line 50 declares `const info = roasLabel(roas)` (a tone label for the ROAS chip). Lines 199, 307, 321 declare a new `const info = trueRevenueByKey.get(key)` (a TrueRevenueInfo object) inside IIFE scopes. The IIFE bodies happen to shadow correctly, but reading the JSX, eye-tracking what `info` means in any given cell requires scrolling up to the most recent declaration. Pre-refactor had the same shadowing; the extraction into a row component is a natural place to rename one of the two.

**Fix:** Rename the inner `info` to `trueInfo` to disambiguate:

```ts
const trueInfo = trueRevenueByKey.get(key);
if (!trueInfo) { return ...; }
```

### IN-02: Identifier name `persist` overloaded across hooks

**File:** `dashboard-web/src/lib/hooks/useBillingRecurring.ts:46`, `dashboard-web/src/lib/hooks/useBillingOneTime.ts:31`

**Issue:** Both hooks define a local function `persist` and export it as `setRecurring` / `setOneTime`. The name `persist` is fine inside the hook but a future test that imports both hooks and stubs `persist` (e.g., for mocking) will have to alias. Minor; the cost is purely cognitive when reading both hooks in parallel.

**Fix:** Optional — rename to `persistRecurring` / `persistOneTime` for symmetry with the BillingSettings parent's naming.

### IN-03: BillingCsvImport `parse()` and `handleFile()` duplicate `parseShopifyBillsCsv` + `buildPreview` chain

**File:** `dashboard-web/src/components/BillingCsvImport.tsx:66-82`

**Issue:** `parse()` reads from `csv` state; `handleFile(file)` reads from FileReader's result. Both then call `parseShopifyBillsCsv(text, defaultStore)`, `setPreview(buildPreview(parsed))`, `setWarnings(warnings)`. Three duplicated lines. The two entry points differ only in how they obtain `text`. Pre-refactor had the same structure.

**Fix:** Extract:

```ts
function runParse(text: string) {
  const { parsed, warnings } = parseShopifyBillsCsv(text, defaultStore);
  setPreview(buildPreview(parsed));
  setWarnings(warnings);
}

function parse() { runParse(csv); }
function handleFile(file: File) {
  const reader = new FileReader();
  reader.onload = () => {
    const text = typeof reader.result === 'string' ? reader.result : '';
    setCsv(text);
    runParse(text);
  };
  reader.readAsText(file);
}
```

### IN-04: `TONE_BG` triplication across CampaignsTable, CampaignsTableRow, AdSetTable

**File:** `dashboard-web/src/components/CampaignsTable.tsx:68-74`, `dashboard-web/src/components/CampaignsTableRow.tsx:15-21`, `dashboard-web/src/components/AdSetTable.tsx:56-62`

**Issue:** The 5-entry `TONE_BG` lookup table is now duplicated three times. The CampaignsTableRow inline comment explicitly justifies the duplication ("D-04 target-soft cap — leaving this tiny lookup table colocated avoids creating a wrapper module for 6 lines"), and PATTERNS.md sanctions it. Acceptable per design — but should a single map become source of truth for ROAS tone colors at some point (e.g., a theme update), three sites will drift if not kept in sync. Flag as Info so the trade-off is visible.

**Fix:** No action required per phase scope. If/when a fourth consumer appears, extract to `@/lib/roasToneColors.ts`.

---

_Reviewed: 2026-05-19T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
