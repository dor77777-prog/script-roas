---
phase: 01
phase_name: Channel-Level Product Attribution
created: 2026-05-18
status: planned
task_count: 8
requirements: [REQ-01, REQ-02, REQ-03, REQ-04, REQ-05, REQ-06, REQ-07, REQ-08]
deploy_order: dashboard-first  # parser tolerates undefined col N; ship safely
files_modified:
  - dashboard-web/src/lib/ordersAttribution.ts
  - dashboard-web/src/lib/attributionAnalysis.ts
  - dashboard-web/src/components/CampaignDrawer.tsx
  - Shopify.gs
  - SheetBuilder.gs
  - SYSTEM_OVERVIEW.md
  - dashboard-web/README.md
---

# Phase 1 — Channel-Level Product Attribution (PLAN)

Atomic, ordered task list. Each task is one commit's worth of work with a testable acceptance criterion. Tasks are sequenced **dashboard-first** per RESEARCH.md §"Open Questions / Migration order" — the new parser handles `undefined` for col N gracefully, so the dashboard can ship before Apps Script lays down the data. The Apps Script change + operator upload + backfill come last.

**Phase boundaries (do NOT touch):**
- `dashboard-web/src/components/CampaignsTable.tsx` — existing trust chip stays unchanged
- `dashboard-web/src/lib/cloudSync.ts` `STATE_KEYS` — new signal is read-only, no cross-device sync needed
- Ad-set / ad level channel breakdown — campaign-only for v1
- Historical orders pre-May 2026 — analyzer treats unmigrated rows as `lineItems: []`

---

## Task List

- [ ] **T-01** — Extend `OrderAttributionRow` with `lineItems` + add `parseLineItems` helper
- [ ] **T-02** — Bump parser range A2:M → A2:N + wire `parseLineItems` into row mapping
- [ ] **T-03** — Add `ProductChannelBreakdown` type + `analyzeProductChannel` function
- [ ] **T-04** — Memoize `productChannelBreakdown` + stabilize `mappedIds` reference in `CampaignDrawer`
- [ ] **T-05** — Render new "מכירות לפי ערוץ של המוצרים המשויכים" section between `AttributionAnalysisPanel` and reconciliation block
- [ ] **T-06** — Extend `Shopify.gs` + `SheetBuilder.gs` for col-N capture, migration, and serialization
- [ ] **T-07** — (operator-manual) Upload `.gs` files to script.google.com + run backfill for 2026-05-08 → 2026-05-18 in 6 chunks
- [ ] **T-08** — Update `SYSTEM_OVERVIEW.md` + `dashboard-web/README.md`

---

## Task Details

### T-01 — Type + parser helper

**type:** `feature`
**files:**
- `dashboard-web/src/lib/ordersAttribution.ts`

**description:**
Additive type extension. Mirror PATTERNS.md §3a verbatim — add `OrderLineItem` type (with `productId`, `units`, `revenueCad`) and append `lineItems: OrderLineItem[]` to `OrderAttributionRow`. Add a `parseLineItems` helper near the existing `parseSource` (line 109) using the **defensive** pattern from RESEARCH.md Pitfall 4: `if (v == null || v === '') return [];` then `try { JSON.parse } catch { return []; }`. **Never throws** — a malformed cell on row K returns `[]` for that row only, parallel to how `parseSource` returns `''` for unknown values. Do NOT modify the parser usage yet (T-02 wires it).

**pattern_ref:** `ordersAttribution.ts:18-39` (type extension) + `ordersAttribution.ts:109-113` (permissive `parseSource`)

**research caveats applied:**
- Pitfall 4 — undefined / empty cell returns `[]`, never throws
- Defensive filtering: drop entries with missing `productId` or non-finite `units` / `revenueCad`
- Default for missing col N is `[]` (per Claude's Discretion in RESEARCH.md — easier consumer code than `null`)

**acceptance:**
- `cd dashboard-web && npm run build` passes (T-01 is type-only — no runtime change yet, so build must stay green)
- `grep -n "OrderLineItem\|parseLineItems" dashboard-web/src/lib/ordersAttribution.ts` shows both new exports

**commit_message:** `feat(P1-01): add OrderLineItem type + permissive parseLineItems helper`

---

### T-02 — Range extension + row mapping

**type:** `feature`
**files:**
- `dashboard-web/src/lib/ordersAttribution.ts`

**description:**
One-line range change at line 128: `A2:M100000` → `A2:N100000`. Update the inline comment to mention "line items column". In the row→object mapping (lines 155-171), append `lineItems: parseLineItems(row[13])`. The parser already uses sparse-array indexing with `?? ''` fallback for cols 11-12 (`utmId`/`utmTerm`) — `row[13]` for old (unmigrated) rows will be `undefined`, which `parseLineItems` returns `[]` for. **Idempotency invariant:** old rows from May 1-7 (pre-Apps-Script upload) come back with `lineItems: []`, which the downstream analyzer treats as "no signal", not "zero sales".

**pattern_ref:** `ordersAttribution.ts:125-128` (range hardcode) + `ordersAttribution.ts:155-171` (row mapping); echoes Round 5 utm_id/utm_term extension

**research caveats applied:**
- A7 verified — Sheets `batchGet` returns sparse arrays, `row[13]` is `undefined` (not `null`) for old rows
- Pitfall 4 — `parseLineItems(undefined)` returns `[]`, no crash

**acceptance:**
- `cd dashboard-web && npm run build` passes cleanly
- `grep -n "A2:N100000" dashboard-web/src/lib/ordersAttribution.ts` shows exactly one match (the parser range)
- Manual smoke: load dashboard in dev mode, open any Meta campaign drawer — no console errors; existing trust chip unchanged

**commit_message:** `feat(P1-02): bump ordersAttribution range to col N + map lineItems`

---

### T-03 — New analyzer + types

**type:** `feature`
**files:**
- `dashboard-web/src/lib/attributionAnalysis.ts`

**description:**
Add `ProductChannelBreakdown` type and `analyzeProductChannel(opts)` function as the **third sibling** alongside `analyzeAttributionForAdSet` / `analyzeAttributionForAd`. **Critical constraint per CONTEXT.md/PATTERNS.md §4d:** the function MUST NOT call `buildAnalysis` — coverage / trust / Bayesian concepts don't apply to pure source-grouping. The analyzer:

1. Returns explicit-zero `ProductChannelBreakdown` (NOT `null`) when input is unusable — `productIds.length === 0` or `orders.length === 0`. Renderer gates on `totalOrders >= 3` separately. This avoids the `facebookShare = NaN` divide-by-zero per RESEARCH.md Pitfall 3.
2. Filters orders by date+storeId (mirror `analyzeAttributionForAdSet` lines 542-546) then by `lineItems` intersection with `wantedIds` Set.
3. Counts each order **once** (not per-item). Per-order mapped revenue = sum of mapped `lineItem.revenueCad` in that order.
4. Buckets by `o.source || 'direct'` into `bySource` (lump empty-string source into `'direct'` per Open Question 1 in RESEARCH.md).
5. Facebook predicate is the locked CONTEXT criteria — `o.source === 'meta-paid' || o.source === 'meta-organic' || o.fbclidPresent === true`. Do NOT introduce new heuristics.
6. `facebookShare = totalOrders > 0 ? facebookOrders / totalOrders : 0` — zero, never NaN.

Export both the type and the function. Keep existing analyzers (`analyzeAttribution`, `analyzeAttributionForAdSet`, `analyzeAttributionForAd`) **completely unchanged**.

**pattern_ref:** `attributionAnalysis.ts:524-566` (`analyzeAttributionForAdSet` signature + date/store filter) + RESEARCH.md "Code Examples" §`analyzeProductChannel`

**research caveats applied:**
- Pitfall 3 — guard divide-by-zero, return 0 not NaN
- §8 locked Facebook predicate — no extensions
- §4d — no `buildAnalysis` call (no trust ladder applies)
- Open Question 1 — empty-string source lumped into `'direct'` bucket in the analyzer; UI displays as "אחר" if not Facebook/Google/Direct

**acceptance:**
- `cd dashboard-web && npm run build` passes cleanly (TypeScript catches any signature drift)
- `grep -n "export function analyzeProductChannel\|export type ProductChannelBreakdown" dashboard-web/src/lib/attributionAnalysis.ts` shows both exports
- `grep -n "buildAnalysis" dashboard-web/src/lib/attributionAnalysis.ts` count is unchanged from pre-commit (no new caller added — analyzer is pure source-grouping)

**commit_message:** `feat(P1-03): add analyzeProductChannel + ProductChannelBreakdown type`

---

### T-04 — Drawer memoization + stable mappedIds

**type:** `feature`
**files:**
- `dashboard-web/src/components/CampaignDrawer.tsx`

**description:**
Two surgical changes in `CampaignDrawer.tsx`:

1. **Stabilize `mappedIds` reference (RESEARCH.md §7 caveat).** Currently line 349 reads `const mappedIds = productMap[campaignKey(storeId, campaignId)] ?? [];` — this returns a fresh `[]` array every render when the key is missing, which would defeat the new `useMemo` if used as a dep directly. Wrap it in its own `useMemo`:
   ```typescript
   const mappedIds = useMemo(
     () => productMap[campaignKey(storeId, campaignId)] ?? [],
     [productMap, storeId, campaignId],
   );
   ```
   Place this where the existing inline declaration is (line 349). Verify no other site mutates `mappedIds`.

2. **Add `productChannelBreakdown` memoization** immediately after the existing `attributionByAdSet` useMemo (line 314), mirroring PATTERNS.md §5a. Deps: `[summary, ordersAttrData, rows, mappedIds, storeId]`. Inside the memo: early-return `null` if `summary.platform !== 'Meta'`, if `mappedIds.length === 0`, or if `ordersAttrData?.rows` is empty. Otherwise derive `dateFrom`/`dateTo` from `rows` (same pattern as `attributionByAdSet` lines 293-295) and call `analyzeProductChannel`. The function returns an empty-zero object even on empty input — re-gate to `null` here when `breakdown.totalOrders < 3` (per CONTEXT — "signal too noisy below 3"). This pushes the threshold check into one place so the render can do a single `{productChannelBreakdown && (...)}` truthy gate.

Import `analyzeProductChannel` from `@/lib/attributionAnalysis` (extend the existing import on line 33 — do NOT add a separate import statement).

**pattern_ref:** `CampaignDrawer.tsx:288-314` (`attributionByAdSet` useMemo) + `CampaignDrawer.tsx:349-350` (current `mappedIds` declaration) + RESEARCH.md §7

**research caveats applied:**
- §7 caveat — `mappedIds` reference instability would re-run the memo every render; fix via dedicated useMemo
- Threshold-3 gate lives in the memo (returning `null`), not in JSX — single truthy gate downstream

**acceptance:**
- `cd dashboard-web && npm run build` passes cleanly
- `grep -n "const productChannelBreakdown" dashboard-web/src/components/CampaignDrawer.tsx` shows exactly one match
- `grep -n "const mappedIds = useMemo" dashboard-web/src/components/CampaignDrawer.tsx` shows exactly one match
- Manual smoke (after T-05): open a Meta campaign with <3 mapped-product orders → drawer renders existing sections only (new section hidden because `productChannelBreakdown === null`)

**commit_message:** `feat(P1-04): memoize productChannelBreakdown + stabilize mappedIds reference`

---

### T-05 — New drawer section render

**type:** `feature`
**files:**
- `dashboard-web/src/components/CampaignDrawer.tsx`

**description:**
Insert the new `<section>` between the closing `})()` of the existing inline-IIFE attribution panel (around line 794) and the `{reconciliation && (` opening (around line 802). Single truthy gate: `{productChannelBreakdown && (...)}` — all subordinate visibility logic was already pushed into the memo by T-04.

Render structure per PATTERNS.md §5b/5c/5d:

1. **Heading** — `<h3>` with `<Package size={14}>` icon and text `מכירות לפי ערוץ של המוצרים המשויכים`. Add `Package` to the existing `lucide-react` import on line 9 (same icon family as `TrendingUp` already imported there).
2. **Wrapper** — `<div className="rounded-xl border border-borderSubtle bg-surfaceMuted/30 p-3 space-y-3">` mirroring the trust panel's outer shape.
3. **Summary line** — `<div className="text-[12px] text-text-secondary tabular-nums">` showing `{totalOrders} הזמנות של מוצרים משויכים · CAD {totalRevenue.toFixed(0)} סה"כ`.
4. **Per-source bar** — 4 segments (Facebook / Google / Direct / Other) using Tailwind div widths per PATTERNS.md §5d. Color tokens: `bg-roas-blue` (Facebook), `bg-amber-500` (Google), `bg-text-muted` (Direct), `bg-text-subtle` (Other). Other = `total - fb - google - direct`. Use the labels row above the bar to show counts (פייסבוק / גוגל / ישיר / אחר).
5. **Recommendation chip** — two variants per PATTERNS.md §5c:
   - `facebookShare >= 0.6` → green chip: "💡 {pct}% מהמכירות הגיעו מפייסבוק → ביטחון להעלאת תקציב הקמפיין"
   - `facebookShare < 0.3 && totalOrders >= 5` → amber chip: "⚠️ רק {pct}% מהמכירות הגיעו מפייסבוק → ייתכן שהקמפיין לא הוא המניע — בדוק לפני העלאת תקציב"
   - Between 30% and 60% → no chip (per CONTEXT)
   - The `totalOrders >= 5` lower-floor on the amber chip is **plan-level only** (not in CONTEXT directly, but consistent with Open Question 2 in RESEARCH.md — "0% facebook on a brand-new campaign with only 3 orders" is noise, not signal). The signal-or-quiet split balances "useful warning" vs "alarming false positive."
6. **Tooltip** — wrap the heading text in a `<span title="...">` with the explanatory text from CONTEXT.md ("סיגנל זה משלים את ה-trust chip. הוא מודד 'מאיפה הגיעו הקונים של המוצרים המשויכים' גם כש-utm_id חסר."). Native title attribute is sufficient — no need for a fancy tooltip component.

**Order in rendered drawer becomes:** KPI row → daily chart → mapped products section → existing attribution panel → **NEW Phase-1 section** → reconciliation block → ad-sets table. Per PATTERNS.md §5b.

**pattern_ref:** `CampaignDrawer.tsx:650-794` (existing attribution panel) + `CampaignDrawer.tsx:767-772` (recommendation chip pattern) + `CampaignDrawer.tsx:736-753` (breakdown bar pattern) + PATTERNS.md §5

**research caveats applied:**
- §5e gating: single `{productChannelBreakdown && (...)}` check; all triple-gate logic (platform, mapped products, ≥3 orders) was pushed into the memo
- §5d 4-segment color palette mirrors trust-panel green/amber tones for visual consistency
- §5c tone-tree: green for raise-budget, amber for caution — exact Tailwind class strings lifted from the trust panel (lines 679-680)

**acceptance:**
- `cd dashboard-web && npm run build` passes cleanly
- `cd dashboard-web && npm run lint` passes (no `react-hooks/exhaustive-deps` warnings)
- Manual smoke (operator):
  1. Open a Meta campaign with mapped products AND ≥3 orders in the period → new section renders between attribution panel and reconciliation block
  2. Open a Google PMax campaign → section is hidden
  3. Open a Meta campaign with no mapped products → section is hidden
  4. Open a Meta campaign with <3 mapped-product orders → section is hidden
  5. Verify the existing trust chip in `CampaignsTable.tsx` row for the same campaign is unchanged (coexistence — REQ-06)

**commit_message:** `feat(P1-05): render per-channel breakdown section in CampaignDrawer`

---

### T-06 — Apps Script: capture + serialize line items

**type:** `data`
**files:**
- `Shopify.gs`
- `SheetBuilder.gs`

**description:**
Three coordinated Apps Script edits in **one commit** (they ship together — `writeOrdersAttributionForDay` will fail with a column-count mismatch if `ORDERS_ATTRIBUTION_HEADERS` is bumped without the row builder, and vice versa — per RESEARCH.md Pitfall 5).

1. **`Shopify.gs` — extend `getShopifyOrdersAttribution`** (line ~516+):
   - Append `,line_items` to the `&fields=...` query string at line ~528 (PATTERNS.md §1a).
   - Inside the per-order loop at line ~550, add `lineItems: computeLineItemsCad_(o, totalCad)` to the pushed object alongside `referringSite` (PATTERNS.md §1b).
   - Add new helper `computeLineItemsCad_(order, totalCad)` near the existing `classifyOrderAttribution_` (or at end of file). Helper computes proportional CAD with the **three guards** from RESEARCH.md:
     - **Skip null `product_id`** — `if (!pid) continue;` (Pitfall 1)
     - **Guard `subtotal === 0`** — spread `totalCad / items.length` equally, log `Logger.log('computeLineItemsCad_: subtotal=0 for order ' + order.id + ', spreading equally')` so the operator sees it in Executions (Pitfall 2)
     - **Use `round2_(lineCad)`** — guarantees clean `r` values, no `NaN` in the JSON

2. **`SheetBuilder.gs` — extend headers + migration + writer** (lines 1466-1586):
   - Append `'Line Items (JSON)'` as the 14th element of `ORDERS_ATTRIBUTION_HEADERS` (line 1466-1471), bumping `.length` from 13 to 14. The `ORDERS_ATTRIBUTION_HEADERS.length` constant propagates automatically through lines 1538, 1572, 1582 (RESEARCH.md §5).
   - In the fresh-tab branch (line 1482+), add `sh.setColumnWidth(14, 320);` after the existing col-12/13 width calls.
   - In the migration branch (line 1502-1521), **append** (do NOT replace) a new `if (lastCol < 14)` block per PATTERNS.md §2c. Same defensive shape as the existing `lastCol < 13` block — `cell.setValue(...)` only if `!cell.getValue()`.
   - In `writeOrdersAttributionForDay` (line 1553-1567), append one entry to the row array: `JSON.stringify(r.lineItems || [])`. **Critical per RESEARCH.md Pitfall 5:** use `JSON.stringify([])` (which gives `'[]'`) over empty string — keeps the writer producing a clean 14-column array even when the analyzer found 0 line items. Both `'[]'` and `''` decode to `[]` in the parser, but `'[]'` is self-documenting in the raw cell.
   - After the existing `setNumberFormat('@')` calls at line 1579-1580, add: `sh.getRange(2, 14, combined.length, 1).setNumberFormat('@');` so JSON strings stay as text and Sheets doesn't try to auto-coerce them.

**pattern_ref:** `Shopify.gs:142-258` (`getShopifyProductSalesForDay` line_items iteration) + `Shopify.gs:516-583` (`getShopifyOrdersAttribution` current shape) + `SheetBuilder.gs:1466-1586` (full Round 5 L+M migration trio) + PATTERNS.md §1, §2

**research caveats applied:**
- Pitfall 1 — skip items where `product_id === null` (custom items, deleted products); they can't match any campaign's mapped products anyway
- Pitfall 2 — guard divide-by-zero in proportional CAD; fall back to equal-spread + log warning
- Pitfall 5 — always write 14 columns; `JSON.stringify([])` for empty arrays, never empty string in the row builder
- §A4 — recommended (not required for v1): log warning when single-cell JSON exceeds 40K chars (the 3 stores are small DTC; realistic max <5K, but defense-in-depth is cheap to add as a Logger line)

**acceptance:**
- `grep -n "line_items" Shopify.gs` shows the new field in the `fields=` query
- `grep -n "computeLineItemsCad_" Shopify.gs` shows definition + one call site
- `grep -n "Line Items" SheetBuilder.gs` shows the new header entry + the migration block + the column-width setter
- `grep -n "ORDERS_ATTRIBUTION_HEADERS.length" SheetBuilder.gs` count is unchanged from pre-commit (constant still drives row width)
- **Cannot be verified by `npm run build`** — Apps Script lives outside the dashboard build graph. The verification is **manual** via T-07.
- Code review: ensure neither `Shopify.gs` nor `SheetBuilder.gs` was reformatted beyond the targeted edits (Apps Script editor's auto-formatter is destructive — keep diffs minimal).

**commit_message:** `feat(P1-06): capture line items in orders-attribution + idempotent col-N migration`

---

### T-07 — Operator manual: upload + backfill

**type:** `operator-manual`
**files:**
- *(none — this is a no-code operator step)*

**description:**
**This is the only manual step in the phase.** Claude has done all the code; the operator now:

1. **Open** [script.google.com](https://script.google.com) → the project that hosts the existing daily run.
2. **Replace** the contents of `Shopify.gs` and `SheetBuilder.gs` with the versions committed in T-06. (Copy from the local repo, paste into the editor — Apps Script does not auto-pull from git.) Save (Cmd+S).
3. **Smoke-test the new field shape:** in the editor's function picker, run `getShopifyOrdersAttribution('uzoshop', '2026-05-18')`. In the execution log, verify the returned rows include a `lineItems` array of `{p, u, r}` objects.
4. **Smoke-test the migration:** run `runUpdateForDate('2026-05-18')`. Then open each of `uzoshop-orders-attribution`, `zolplus-orders-attribution`, `360usmile-orders-attribution` tabs — confirm:
   - Header row N reads "Line Items (JSON)" (bold, gray bg, centered) — migration ran
   - All today's rows have non-empty col N with valid JSON (e.g., `[{"p":"7891234567890","u":1,"r":29.99}]`)
   - Rows from earlier dates have empty col N (intentional — they pre-date the migration)
5. **Backfill 2026-05-08 → 2026-05-18** in 6 chunks per SETUP.md §7 (the Apps Script 6-minute execution limit forces splitting):
   - Add 6 wrapper functions at the bottom of `DailyUpdate.gs` (operator's existing convention, NOT committed to git):
     ```javascript
     function backfill1() { backfillRange("2026-05-08", "2026-05-09"); }
     function backfill2() { backfillRange("2026-05-10", "2026-05-11"); }
     function backfill3() { backfillRange("2026-05-12", "2026-05-13"); }
     function backfill4() { backfillRange("2026-05-14", "2026-05-15"); }
     function backfill5() { backfillRange("2026-05-16", "2026-05-17"); }
     function backfill6() { runUpdateForDate("2026-05-18"); }
     ```
   - Run `backfill1` → wait ~5-6 min → `backfill2` → ... → `backfill6`.
   - If any chunk fails mid-run, just re-run that wrapper — `writeOrdersAttributionForDay` is idempotent (clears the date's rows first, then re-writes).
   - When done, delete the 6 wrappers from `DailyUpdate.gs` and Save.
6. **Open the dashboard** at `localhost:3000` (or production). Pick the date range 2026-05-08 → 2026-05-18. Open a Meta campaign that has mapped products and ≥3 orders containing those products in this range. Confirm:
   - The new section "מכירות לפי ערוץ של המוצרים המשויכים" renders between the existing attribution panel and the reconciliation block
   - Summary line shows N orders + total CAD (matches your eyeball estimate of the campaign's mapped-product revenue)
   - Per-source breakdown bar shows percentages
   - Recommendation chip fires correctly (green if ≥60% Facebook, amber if <30% Facebook + ≥5 orders, nothing in between)
7. **Coexistence smoke (REQ-06, REQ-08):** for the same campaign, look at its row in `CampaignsTable.tsx`. Trust chip should look **identical** to before the deploy — no regression.

**pattern_ref:** SETUP.md §7 (chunked backfill convention) + DailyUpdate.gs (existing `runUpdateForDate` + `backfillRange` entry points)

**research caveats applied:**
- Pitfall 5 — re-running a failed chunk is safe (idempotent clear+write)
- §10 manual smoke — this is the verifier's only path; no automated test exists for Apps Script

**acceptance:**
- **Operator confirms in commit message or run log:** "T-07 backfill complete 2026-05-08 → 2026-05-18 across 3 stores"
- Sheet inspection: open any backfilled tab, scroll to a row in the range — col N is populated with JSON
- Dashboard inspection: at least one Meta campaign drawer shows the new section with a non-empty bar

**commit_message:** *(no commit — this is operator action only. The dashboard commits T-01..T-05 + Apps Script commit T-06 are already in git; T-07 is the deploy + data-load step.)*

---

### T-08 — Documentation update

**type:** `docs`
**files:**
- `SYSTEM_OVERVIEW.md`
- `dashboard-web/README.md`

**description:**
Two documentation refreshes after T-01..T-07 ship:

1. **`SYSTEM_OVERVIEW.md`:** in the "שכבת ה-Attribution" section, add a sub-section describing the new channel-level signal — what it answers ("מאיפה הגיעו הקונים של המוצרים המשויכים?"), how it differs from the per-campaign trust chip (broader Facebook predicate, productId-based, period-totals only), and where the operator sees it (CampaignDrawer, between attribution panel and reconciliation). Also update the orders-attribution tab description to mention 14 columns (col N = Line Items JSON, added Phase 1).
2. **`dashboard-web/README.md`:** add `analyzeProductChannel` to the `lib/attributionAnalysis.ts` exports list. Add a one-line note under the CampaignDrawer description mentioning the new section.

Keep both docs **tight** — no marketing prose; this is a reference doc that the next developer (or the operator at 2 AM debugging) needs to skim quickly.

**pattern_ref:** existing structure of `SYSTEM_OVERVIEW.md` "שכבת ה-Attribution" section + `dashboard-web/README.md` library list

**research caveats applied:**
- None — pure documentation update reflecting what shipped

**acceptance:**
- `grep -ni "analyzeProductChannel\|Line Items\|channel-level" SYSTEM_OVERVIEW.md dashboard-web/README.md` shows multiple hits (function name in README; feature description in SYSTEM_OVERVIEW)
- Both files have a `git diff` that's purely additive (no deletions of existing content)

**commit_message:** `docs(P1-08): document channel-level product attribution + col-N orders schema`

---

## Verification Gates Between Tasks

After **every** dashboard task (T-01 through T-05): `cd dashboard-web && npm run build` must pass with zero new TypeScript errors and zero new lint warnings. If any task breaks the build, fix it before moving on — don't accumulate technical debt across the phase.

After **T-06**: no automated gate (Apps Script lives outside the npm build graph). Verification is **deferred to T-07's operator smoke test.**

After **T-07**: operator confirms via Sheet inspection + dashboard smoke; verifier in `/gsd-verify-phase` later will check the operator's log for the confirmation phrase.

After **T-08**: `git diff SYSTEM_OVERVIEW.md dashboard-web/README.md` shows only additions; existing sections unchanged.

---

## Risks + Rollback Notes

### Risk 1 — Some orders return 0 line items
**Cause:** Gift card purchases, fully-refunded orders, custom-only items (where every `line_items[i].product_id === null` → all filtered out by T-06's `if (!pid) continue;` guard).
**Effect:** Those orders appear in the tab with `Line Items (JSON) = '[]'`. The dashboard analyzer skips them (`if (!o.lineItems || o.lineItems.length === 0) continue;`).
**Severity:** Normal/expected. No action needed.

### Risk 2 — A specific day's backfill chunk fails
**Cause:** Shopify API throttling, Sheets API hiccup, or 6-minute timeout for a high-volume day.
**Effect:** That chunk's tabs may be partially written.
**Mitigation:** The write is idempotent — `writeOrdersAttributionForDay` clears the day's existing rows first, then re-writes. Just re-run the failing wrapper.
**Severity:** Recoverable. Operator action: re-run.

### Risk 3 — Manually-edited cell in col N is malformed JSON
**Cause:** Operator opens the Sheet and accidentally edits a cell, or pastes wrong data.
**Effect:** `parseLineItems` catches the `SyntaxError`, returns `[]` for that row only. Other rows in the same tab unaffected.
**Severity:** Self-healing. The analyzer ignores that row's contribution to the breakdown; everything else continues.

### Risk 4 — A pre-Phase-1 row from before today's deploy has a 13-cell row
**Cause:** Rows written before T-06 + T-07 ran.
**Effect:** `row[13]` is `undefined`; `parseLineItems(undefined)` returns `[]`; row contributes no mapped-product signal.
**Severity:** Intentional. Per CONTEXT.md §"Non-goals" — historical orders pre-May 2026 are not in scope for backfill.

### Rollback path (worst case)
If something is catastrophically wrong post-deploy:
1. **Dashboard rollback:** `git revert` the T-01..T-05 commits. The Apps Script changes are still safe to leave in place — they're additive in the Sheet, and the old dashboard parser (`A2:M100000`) just ignores col N.
2. **Apps Script rollback:** Edit `Shopify.gs` and `SheetBuilder.gs` in the script editor — remove the `line_items` field, the `computeLineItemsCad_` helper, the 14th header entry, and the migration block. Existing col-N data in the Sheet is harmless if unused.
3. **No data corruption possible** — every change in this phase is additive (new column, new field, new function). No existing column is renamed, no existing row is rewritten in a destructive way.

---

## Multi-Source Coverage Audit

| Source Item | Type | Plan Coverage |
|-------------|------|---------------|
| **ROADMAP Goal** — "X% of orders containing this product came from Facebook" signal independent of utm_id matching | GOAL | T-03 (analyzer) + T-04 (memo) + T-05 (render) |
| **REQ-01** — Line Items (JSON) col populated by daily + backfill | REQ | T-06 (data layer) + T-07 (operator backfill) |
| **REQ-02** — Idempotent migration; old rows have empty cells, parser tolerates | REQ | T-06 (migration block) + T-01 (`parseLineItems` returns `[]`) + T-02 (range bump) |
| **REQ-03** — Dashboard parses + exposes on `OrderAttributionRow` | REQ | T-01 (type) + T-02 (mapping) |
| **REQ-04** — `analyzeProductChannel` returns per-source breakdown | REQ | T-03 |
| **REQ-05** — New drawer section with summary/bar/recommendation | REQ | T-05 |
| **REQ-06** — Coexistence with existing trust chip (no replacement) | REQ | Enforced by **non-modification** of `CampaignsTable.tsx` (phase boundary) + T-05 (render below, not replacing) |
| **REQ-07** — `npm run build` passes cleanly | REQ | Verification gate after T-01..T-05 |
| **REQ-08** — No regression in existing chip flow | REQ | Enforced by phase boundary + T-07 operator smoke step 7 |
| **CONTEXT D-line-items-shape** — Compact `{p,u,r}` JSON, 14th column | CONTEXT | T-06 (writer) + T-01/T-02 (parser) |
| **CONTEXT D-broad-Facebook** — `meta-paid ∨ meta-organic ∨ fbclidPresent` | CONTEXT | T-03 (predicate in analyzer) |
| **CONTEXT D-analyzer-co-location** — In `attributionAnalysis.ts`, not new file | CONTEXT | T-03 (same file as siblings) |
| **CONTEXT D-section-placement** — Between attribution panel + ad-sets table | CONTEXT | T-05 (insert at line ~795) |
| **CONTEXT D-gate-rules** — Meta + mapped products + ≥3 orders | CONTEXT | T-04 (memo returns null below threshold) + T-05 (single truthy gate) |
| **CONTEXT D-recommendation-chips** — 60% green, 30% amber | CONTEXT | T-05 (two variants) |
| **CONTEXT D-trust-chip-unchanged** | CONTEXT | Phase boundary (not modified) |
| **RESEARCH Pitfall 1** — Skip `product_id === null` | RESEARCH | T-06 (`if (!pid) continue`) |
| **RESEARCH Pitfall 2** — Guard subtotal=0 | RESEARCH | T-06 (`if (subtotal > 0) ... else equal-spread + Logger.log`) |
| **RESEARCH Pitfall 3** — Guard facebookShare divide-by-zero | RESEARCH | T-03 (`totalOrders > 0 ? ... : 0`) |
| **RESEARCH Pitfall 4** — Empty cell in col N for old rows | RESEARCH | T-01 (`parseLineItems` defensive) |
| **RESEARCH Pitfall 5** — Backfill column-count mismatch | RESEARCH | T-06 (always-14-col writer + `JSON.stringify([])` for empties) |
| **RESEARCH §7 caveat** — `mappedIds` reference stability | RESEARCH | T-04 (dedicated `useMemo` for `mappedIds`) |
| **RESEARCH §4d** — No `buildAnalysis` call | RESEARCH | T-03 (pure source-grouping; no buildAnalysis) |

**All items COVERED. No gaps. No items deferred to a later phase.**
