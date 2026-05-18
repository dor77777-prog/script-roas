---
phase: 04-round4
reviewed: 2026-05-18T00:00:00Z
depth: standard
files_reviewed: 13
files_reviewed_list:
  - Config.gs
  - DailyUpdate.gs
  - SheetBuilder.gs
  - Shopify.gs
  - dashboard-web/src/app/api/product-catalog/route.ts
  - dashboard-web/src/components/CampaignDrawer.tsx
  - dashboard-web/src/components/CampaignsTable.tsx
  - dashboard-web/src/components/ProductPickerModal.tsx
  - dashboard-web/src/lib/campaignProductMap.ts
  - dashboard-web/src/lib/cloudSync.ts
  - dashboard-web/src/lib/productCatalog.ts
  - dashboard-web/src/lib/sheets.ts
status: issues_found
findings:
  critical: 0
  warning: 4
  info: 3
  total: 7
---

# Round 4 Code Review Report

**Reviewed:** 2026-05-18
**Depth:** standard
**Files Reviewed:** 13 (4 Apps Script + 9 dashboard files)
**Diff Base:** e0fb57c..HEAD (10 commits)
**Status:** issues_found

## Summary

The round-4 implementation introduces three substantial new features: the campaign↔product mapping with true-ROAS allocation, the full Shopify product catalog tab + picker, and a Meta-vs-Shopify reconciliation panel with Pearson correlation. All three are reasonable, well-commented, and integrate cleanly with the existing cloud-sync layer. The phantom-spreadsheet fix in `ensureSpreadsheet` and the `resetSpreadsheetIdToKnownGood` helper are correctly defensive — the loop bound at 3 attempts protects against the regex-false-positive infinite-retry concern raised in the brief.

However, the review surfaces **four correctness Warnings** that affect user-facing values:

1. **`writeProductCatalogForStoreChunked_` partial-write contamination** — a chunk failure after chunk-1 succeeds leaves the catalog half-written WITH a fresh `Updated At` timestamp, which then makes `catalogNeedsRefresh_` falsely report "fresh" for up to 7 days. The cache gate intended to save quota becomes a data-staleness trap.
2. **`computeConfidence` shared-campaigns double-counting** — the inner-break-only structure increments `sharedCampaigns` once per overlapping product per other campaign, not once per other campaign. A 2-product campaign sharing both products with one other campaign reports `sharedCampaigns=2` (should be 1), pushing the confidence chip toward 'low' more aggressively than warranted.
3. **`pearsonWithLag` produces spurious lag warnings on short series** — with `series.length=5` and `lag=±3`, only 2 paired points remain. Pearson on n=2 always returns ±1.0 (unless degenerate variance), so `bestR` reliably beats the true `r` and the "lag detected" amber banner fires on noise. The `series.length < 5` gate is too loose to cover lag detection.
4. **`ProductPickerModal` Esc handler bypasses the drawer stack** — partial regression of WR-01. The modal uses `window.addEventListener('keydown', ...)` directly instead of `useDrawerEsc`. When the picker opens on top of `CampaignDrawer`, pressing Esc closes both in one keystroke.

No security or data-loss vulnerabilities found. The cloud-sync `STATE_KEYS` ↔ `ALLOWED_STATE_KEYS` symmetry for `campaign-product-map` is verified. The storeId scoping in `allocateProductRevenue` and `trueRevenueByKey` is correctly bounded — no cross-store contamination.

The zero-spend single-mapped-campaign edge case in `allocateProductRevenue` was verified by tracing: `totalSpend=0` + `mappedKeys.length=1` triggers the `1/mappedKeys.length=1.0` branch, giving the lone campaign 100% of the product revenue. Confirmed correct.

The `metaClaim=0 / trueRevenue>0` (and inverse) gap calculation yields exactly `1.0` and triggers the 'low' bucket via `gap > 0.7`. Confirmed intended.

---

## Warnings

### WR-01: Partial catalog write leaves stale `Updated At` timestamp, defeating the 7-day cache gate

**File:** `SheetBuilder.gs:1409-1430` (`writeProductCatalogForStoreChunked_`) + `SheetBuilder.gs:1344-1356` (`catalogNeedsRefresh_`)

**Issue:**
In `writeProductCatalogForStoreChunked_`, the sequence is:
1. `clearContent()` blanks all rows including the `Updated At` column.
2. The chunk loop runs `setValues()` calls for batches of 100 rows. Each chunk includes the `updatedAt` timestamp in column 9.
3. If a chunk fails (e.g. chunk 2 of 5 hits a Sheets API timeout), the exception bubbles up. The retry in `refreshAllProductCatalogs` calls `getShopifyProductsCatalog` AGAIN; if THAT or the next `writeProductCatalogForStoreChunked_` call also fails, we `break` — leaving the half-written sheet in place.

At that point the sheet has rows 2..101 with a fresh `updatedAt`. Next daily run reads row 2 col 9 in `catalogNeedsRefresh_` (line 1351), sees a recent timestamp (< 7 days), returns `false`, and the catalog is NOT refreshed. The operator sees only the first 100 products in the picker for up to 7 days.

The brief's hypothesis "the partial-write idempotency safe? (clearContent before write should be fine.)" — clearContent is fine for the data, but the `Updated At` timestamp is the cache key, and writing it on every chunk means a partial success looks identical to a complete success to the gate.

**Fix:**
Write `updatedAt` only after the final chunk succeeds. Two options:

```js
// Option A: write Updated At in a separate setValue AFTER all chunks
function writeProductCatalogForStoreChunked_(ss, storeId, products) {
  const sh = ensureProductCatalogTab_(ss, storeId);
  const lastRow = sh.getLastRow();
  if (lastRow > 1) {
    sh.getRange(2, 1, lastRow - 1, PRODUCT_CATALOG_HEADERS.length).clearContent();
  }
  if (!products || products.length === 0) return;

  // Stage 1: write all rows with EMPTY Updated At — partial state is detectable.
  const rows = products.map(p => [
    p.productId, p.title, p.handle, p.status, p.priceCad,
    p.imageUrl, p.productType, p.vendor, '', // <- empty timestamp
  ]);

  const CHUNK = 100;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    sh.getRange(2 + i, 1, slice.length, PRODUCT_CATALOG_HEADERS.length).setValues(slice);
  }

  // Stage 2: ONLY after all chunks succeed, stamp Updated At on every row.
  // If any earlier chunk failed, we never reach this point, and
  // catalogNeedsRefresh_ correctly returns true on the next run.
  const updatedAt = new Date();
  const stamps = rows.map(() => [updatedAt]);
  sh.getRange(2, 9, rows.length, 1).setValues(stamps);

  sh.getRange(2, 5, rows.length, 1).setNumberFormat('#,##0.00');
  sh.getRange(2, 9, rows.length, 1).setNumberFormat('yyyy-mm-dd hh:mm');
}
```

Alternatively, validate completeness in `catalogNeedsRefresh_` by also checking that the last row has a timestamp matching row 2 (since a complete write produces uniform timestamps).

---

### WR-02: `computeConfidence` shared-campaigns counter overcounts when a single other campaign shares multiple products

**File:** `CampaignsTable.tsx:558-568`

**Issue:**
The double loop:
```js
let shared = 0;
for (const pid of mappedIds) {
  for (const otherKey of Object.keys(productMap)) {
    if (otherKey === k) continue;
    if (!otherKey.startsWith(`${a.storeId}::`)) continue;
    if ((productMap[otherKey] ?? []).includes(pid)) {
      shared++;
      break; // count each campaign once even if it shares N products
    }
  }
}
```

The `break` only exits the inner loop (over other campaigns) for the current `pid`. The outer loop continues, and the NEXT `pid` re-encounters the same other campaign and increments `shared` again.

**Trace**: campaign A is mapped to `[P1, P2]`. Campaign B is also mapped to `[P1, P2]`. No other campaigns.
- `pid=P1`: scans otherKey=B → includes P1 → `shared=1`, break inner.
- `pid=P2`: scans otherKey=B → includes P2 → `shared=2`, break inner.
- Result: `shared=2`. Reality: only 1 other campaign overlaps.

This makes `computeConfidence` think the mapping is more shared (and therefore noisier) than it is. With `shared >= 3` triggering a `level='low'` downgrade, a mapping overlap that's actually 1-2 real campaigns sharing N products can falsely trigger LOW confidence.

The inline comment "count each campaign once even if it shares N products" describes the *intent*, but the implementation doesn't match.

**Fix:**
Track other-campaign-keys in a Set, then count its size:

```js
const sharedKeys = new Set<string>();
for (const pid of mappedIds) {
  for (const otherKey of Object.keys(productMap)) {
    if (otherKey === k) continue;
    if (!otherKey.startsWith(`${a.storeId}::`)) continue;
    if ((productMap[otherKey] ?? []).includes(pid)) {
      sharedKeys.add(otherKey);
    }
  }
}
const shared = sharedKeys.size;
```

This implements the documented "count each campaign once" semantics correctly.

---

### WR-03: `pearsonWithLag` produces spurious lag warnings on small series

**File:** `CampaignDrawer.tsx:305-318, 628`

**Issue:**
The reconciliation block gates the overall correlation on `series.length < 5` (line 305), but the lag-detection inner loop tries lags `-3..3`. With a 5-day series and `lag=3`, `pearsonWithLag` filters to only `n=2` paired points (i=0 with j=3, i=1 with j=4 — i=2,3,4 all overflow ys). 

`pearson` with `n=2` returns the trivially-perfect ±1.0 unless one variance is exactly zero, because for two points there's a single line fit. So the lag-detection loop reliably finds `|bestR|=1.0` for `lag=±3` on a 5-element series.

The gate at line 628:
```js
{reconciliation.bestLag !== 0 && Math.abs(reconciliation.bestR) > Math.abs(reconciliation.r) + 0.1 && (
```

…doesn't check sample size after the shift. A weak true `r=0.4` from n=5 trivially loses to a spurious `r=1.0` from n=2, producing a false "זוהה lag של 3 ימים" amber banner.

The brief explicitly asks: "sample-size minimums" — confirmed missing.

**Fix:**
Either (a) raise the series-length minimum to comfortably exceed the maximum lag, e.g. `series.length < 10`, OR (b) inside the lag loop, skip lag values where the effective `n` after shifting is below a reasonable threshold:

```js
for (let lag = -3; lag <= 3; lag++) {
  if (lag === 0) continue;
  const effectiveN = series.length - Math.abs(lag);
  if (effectiveN < 5) continue; // n<5 makes |r| trivially close to 1
  const r2 = pearsonWithLag(series.map(s => s.meta), series.map(s => s.shopify), lag);
  if (Math.abs(r2) > Math.abs(bestR)) {
    bestR = r2;
    bestLag = lag;
  }
}
```

Option (b) lets short series still get a base correlation without firing the lag warning on insufficient data.

---

### WR-04: `ProductPickerModal` Esc handler bypasses the drawer stack — regression of WR-01

**File:** `ProductPickerModal.tsx:101-108`

**Issue:**
The modal registers its Esc handler directly on `window`:
```js
useEffect(() => {
  if (!open) return;
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [open, onClose]);
```

`CampaignDrawer.tsx:157` uses `useDrawerEsc(open, onClose)` which goes through the shared `drawerStack` in `lib/drawerStack.ts`. The drawer stack was introduced specifically to prevent the same-tick Esc cascade bug fixed in WR-01 (commit af602b7).

When the user opens `CampaignDrawer` → clicks "ערוך מיפוי" → `ProductPickerModal` mounts on top with its own window listener. Pressing Esc:
- The drawerStack's single shared listener fires `top()` → calls `CampaignDrawer`'s `onClose`.
- The modal's separate window listener also fires → calls `setPickerOpen(false)`.

Both close in one keystroke. The user has to re-open both to recover.

The fix made in WR-01 specifically anticipates this pattern. The new picker code didn't adopt it.

**Fix:**
Replace the direct `window.addEventListener` with `useDrawerEsc`:

```js
import { useDrawerEsc } from '@/lib/drawerStack';
// ...
useDrawerEsc(open, onClose);
```

Delete the manual `useEffect` block on lines 101-108. Verified that `useDrawerEsc` correctly handles open/closed state via the `if (!open) return;` guard inside the hook.

---

## Info

### IN-01: Dead `'warn'` tone in `AttributionGapPanel` type union

**File:** `CampaignsTable.tsx:672, 1367, 1370-1374`

**Issue:**
`tone: 'good' | 'warn' | 'flag'` is the declared type, but the assignment block at lines 673-688 only ever sets `'good'` or `'flag'`. The `toneClass` lookup at 1370-1374 still defines a class for `'warn'`, so it's a dead branch.

Either remove `'warn'` from the union (and from `toneClass`), or wire it up with an actual condition (e.g. a moderate gap band between 'good' and 'flag').

**Fix:**
If no `'warn'` band is planned:
```ts
let tone: 'good' | 'flag';
// ...
const toneClass = {
  good: 'border-roas-green/30 bg-roas-greenBg/40',
  flag: 'border-roas-red/30 bg-roas-redBg/40',
}[gap.tone];
```

If a warn band is intended (e.g. `0.1 <= |gapPct| < 0.3`):
```ts
} else if (Math.abs(gapPct) < 0.3) {
  interpretation = '…';
  tone = 'warn';
} else {
```

---

### IN-02: `aggregate`'s "current budget = last row wins" relies on chronological row order that isn't enforced

**File:** `CampaignsTable.tsx:274-279`

**Issue:**
The comment claims "rows iterate in date order... the last write here is the most recent." The Apps Script writer `writeCampaignRowsForDay` does append re-written dates to the END of the sheet (see `SheetBuilder.gs:740-784`), but this means a **backfill** of a past date will push that past date's rows to the END of the sheet. After such a backfill, `aggregate` will see that past date last and stamp its (potentially stale) budget as "current."

This isn't catastrophic — backfills are rare and budgets rarely change retroactively — but the assumption is brittle. The comment also reinforces a false invariant that future maintainers may rely on.

**Fix:**
Sort by date before aggregating, or pick the latest by date during aggregation:

```js
// Defense in depth: explicitly take the budget from the chronologically latest row.
if (r.campaignBudgetCad != null) {
  if (!a._latestBudgetDate || r.date >= a._latestBudgetDate) {
    a.campaignBudgetCad = r.campaignBudgetCad;
    a._latestBudgetDate = r.date;
  }
}
```

Alternatively, update the comment to accurately reflect "we use *some* recent row" rather than implying chronological guarantee.

---

### IN-03: Hardcoded spreadsheet ID literal in `resetSpreadsheetIdToKnownGood`

**File:** `Config.gs:241`

**Issue:**
```js
const REAL_ID = '1f5tbc-8eMG60Go1ubTldWALc_kwnpaXD_33IsPDWrAk';
```

The constant is a real spreadsheet identifier embedded in the source. While Sheets IDs aren't credentials on their own (access still requires authorization), publishing them in git makes them slightly easier to enumerate or use in reconnaissance against the production environment. The function header says "edit this constant before running" — so the value is intended as a placeholder/default but functions as a live config.

This is a low-impact issue; the file is already a config/secrets-management file pattern. But ideally this should be read from `getProp('spreadsheet.id.knownGood')` or a documented Script Property, so the reset value travels with the deployment configuration rather than the source.

**Fix:**
```js
function resetSpreadsheetIdToKnownGood() {
  const REAL_ID = getProp('spreadsheet.id.knownGood');
  if (!REAL_ID) {
    throw new Error(
      'Set Script Property "spreadsheet.id.knownGood" to your real spreadsheet ID before running.'
    );
  }
  // ... rest unchanged
}
```

---

## Validations passed (per brief focus areas)

The following items from the brief were traced and confirmed correct:

- **`allocateProductRevenue` zero-spend single-mapping**: `mappedKeys.length=1`, `totalSpend=0` → `1/mappedKeys.length=1.0` → 100% allocation. Correct.
- **`computeConfidence` extreme gap cases** (`metaClaim=0` xor `trueRevenue=0`): gap evaluates to exactly 1.0, triggers `gap > 0.7` → 'low'. Intended and correct.
- **`ensureSpreadsheet` retry regex breadth**: even on a permanent error whose message contains a transient keyword, the loop is bounded to 3 attempts and falls through to a thrown error rather than creating a new sheet. No infinite-retry risk.
- **`ProductPickerModal` storeId scoping**: catalog source is filtered `c.storeId === storeId` (line 137); sales source filtered `r.storeId !== storeId` (line 120). No cross-store contamination.
- **Cross-store contamination in `trueRevenueByKey`**: `allocateProductRevenue` called per-store with per-store product list; `campaignsForProduct` enforces storeId prefix filter (`campaignProductMap.ts:91-92`). Confirmed scoped.
- **`STATE_KEYS` / `ALLOWED_STATE_KEYS` symmetry for `campaign-product-map`**: present in both arrays (`cloudSync.ts:54`, `sheets.ts:238`), with matching change-event registration (`cloudSync.ts:65`) and live listeners in both `CampaignsTable.tsx:411` and `CampaignDrawer.tsx:123`.
- **`Stat` / `DrawerStat` accent typing**: declared `accent?: 'green'` in both files; all call sites pass `'green'` or `undefined`. No widened union exists in the in-scope files (the IN-02 widening from prior round was in `AdsDrawer.tsx`, out of scope for this review).
- **`pearson` NaN / divide-by-zero handling**: explicit `denom === 0` guard at `CampaignDrawer.tsx:1017`; clamps to `[-1, 1]`. Correct.
- **`catalogNeedsRefresh_` empty-cleared-row case**: if all rows were `clearContent`ed (including col 9), `sh.getRange(2, 9).getValue()` returns an empty string, which fails the `instanceof Date` check at line 1352 → returns true → refreshes. Self-healing. (The non-self-healing case — partial chunk write — is captured in WR-01.)
- **`refreshAllProductCatalogs` partial-write idempotency**: `writeProductCatalogForStoreChunked_` calls `clearContent()` before writing, so a retry that successfully completes overwrites a partial first attempt cleanly. The hazard is only when the retry ALSO fails (WR-01).

---

_Reviewed: 2026-05-18_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
