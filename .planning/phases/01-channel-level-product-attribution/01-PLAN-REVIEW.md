---
phase: 01
verdict: PASS
criteria_covered: 8 / 8
pitfalls_applied: 5 / 5
reviewed: 2026-05-18
reviewer: gsd-plan-checker
---

# Phase 1 — Pre-Execution Plan Review

Goal-backward verification of `01-PLAN.md` against ROADMAP.md Phase 1 success criteria, CONTEXT.md locked decisions, RESEARCH.md pitfalls, and PATTERNS.md analogs. Result: **PASS** — plan is actionable as-written; no blockers, two minor nits.

---

## 1. Goal Coverage — Per-Criterion Mapping

All eight ROADMAP success criteria map to concrete tasks. No gaps.

| # | ROADMAP Criterion | Task(s) | Plan Lines | Notes |
|---|-------------------|---------|------------|-------|
| 1 | `Line Items (JSON)` col populated by daily + backfill | T-06 (capture/serialize) + T-07 (backfill 5/8→5/18) | 213-254, 257-304 | T-06 adds `line_items` to `fields=` query (528), `computeLineItemsCad_` helper (with Pitfalls 1+2 guards), 14th header, migration block, JSON serializer in writer. T-07 operator-runs `runUpdateForDate('2026-05-18')` then 6 chunked backfills. |
| 2 | Idempotent migration; old rows tolerated | T-06 (`lastCol < 14` migration) + T-01 (`parseLineItems` returns `[]`) + T-02 (range bump) | 232-233, 47-66, 70-90 | The two-sided idempotency (Apps Script appends, dashboard tolerates undefined) is correctly distributed across both tiers — see §2 below for order safety. |
| 3 | Dashboard parses + exposes on `OrderAttributionRow` | T-01 (type + helper) + T-02 (range + mapping) | 47-66, 70-90 | Type extension mirrors Round 5 `utmId`/`utmTerm` extension exactly. |
| 4 | `analyzeProductChannel` returns per-source breakdown | T-03 | 94-125 | Returns `{totalOrders, totalRevenue, bySource, facebookOrders, facebookRevenue, facebookShare}` matching CONTEXT shape; no `buildAnalysis` call (correct per PATTERNS §4d). |
| 5 | `CampaignDrawer` surfaces the section with summary/bar/recommendation | T-04 (memo) + T-05 (render) | 129-163, 167-208 | Section between `AttributionAnalysisPanel` (closes line 794) and `{reconciliation && (...)}` (line 802). |
| 6 | Coexistence — neither signal overrides the other | Phase boundary (CampaignsTable.tsx untouched) + T-05 placement | 23-27, 167-208, T-07 step 7 (291) | Plan explicitly forbids touching `CampaignsTable.tsx`; T-07 step 7 has an operator-level coexistence smoke ("Trust chip should look identical to before"). |
| 7 | `npm run build` passes cleanly | Verification gate after every dashboard task | 64, 86, 121, 158, 200, 336-338 | Each T-01..T-05 lists `npm run build` in its acceptance block; an aggregate gate is restated at line 336-338. |
| 8 | No regressions in existing chip flow | Phase boundary + T-07 step 7 + T-05 acceptance step 5 | 23-27, 291, 205-206 | T-05 acceptance #5 ("Verify the existing trust chip ... is unchanged — coexistence — REQ-06"). |

**Result: 8 / 8 criteria mapped.**

---

## 2. Order Correctness — Dashboard-First Sequencing

The plan ships dashboard tasks (T-01..T-05) **before** the Apps Script change (T-06) and operator deploy (T-07). RESEARCH.md §"Open Question 3" explicitly endorses this as safer than data-first because the parser tolerates `undefined` for col N.

**Verified defensive behavior is preserved:**
- T-01 description (line 53): `parseLineItems` `if (v == null || v === '') return []` then `try { JSON.parse } catch { return []; }` → **never throws** on undefined.
- T-02 description (line 77): "row[13] for old (unmigrated) rows will be `undefined`, which `parseLineItems` returns `[]` for. Idempotency invariant: old rows from May 1-7 ... come back with `lineItems: []`, which the downstream analyzer treats as 'no signal', not 'zero sales'."
- T-03 description (line 103): explicit-zero (NOT `null`) return on empty input, gating moved to renderer via `totalOrders < 3` check in T-04.

**No window where the dashboard breaks pre-T-07.** Confirmed safe.

---

## 3. Atomicity Per Task

Every task is one commit's worth of work with a measurable acceptance criterion (grep / build / smoke). Per-task verdict:

| Task | One commit? | Acceptance is measurable? |
|------|-------------|---------------------------|
| T-01 | yes (single file, additive type+helper) | `grep -n "OrderLineItem\|parseLineItems"` + `npm run build` |
| T-02 | yes (single file, range+mapping) | `grep -n "A2:N100000"` + `npm run build` + manual smoke |
| T-03 | yes (single file, new export only) | `grep -n "analyzeProductChannel\|ProductChannelBreakdown"` + `npm run build` + `buildAnalysis` count unchanged |
| T-04 | yes (single file, two surgical changes in CampaignDrawer) | `grep -n "const productChannelBreakdown"` + `grep -n "const mappedIds = useMemo"` + `npm run build` |
| T-05 | yes (single file, render section) | `npm run build` + `npm run lint` + 5-step manual smoke covering all gates |
| T-06 | **deliberately bundles 3 sub-changes in 2 files** — Shopify.gs (fields query + helper) + SheetBuilder.gs (headers + migration + writer) | Multiple greps; plan explicitly justifies the bundling. |
| T-07 | non-code operator step | Sheet inspection + dashboard inspection + commit-message confirmation |
| T-08 | yes (docs additions only) | `grep -ni "analyzeProductChannel\|Line Items\|channel-level"` + additive-only `git diff` |

**T-06 bundling is correctly justified.** Plan explicitly addresses Pitfall 5 (line 220): "they ship together — `writeOrdersAttributionForDay` will fail with a column-count mismatch if `ORDERS_ATTRIBUTION_HEADERS` is bumped without the row builder, and vice versa". This is the right call per RESEARCH.md §Pitfall 5 — splitting T-06 would create a window where the writer is broken.

---

## 4. Pattern Adherence

PATTERNS.md mapped 5/5 surfaces to analogs. The plan references each:

| Patterns §  | Task | `pattern_ref` in plan | file:line accuracy |
|-------------|------|-----------------------|--------------------|
| §1 — `getShopifyOrdersAttribution` extension | T-06 | `Shopify.gs:142-258` + `Shopify.gs:516-583` | **Verified** — `getShopifyOrdersAttribution` starts at line 516, `fields=` clause at 524-528, per-order loop at 550, push-object at 554-571. Exact match. |
| §2 — `SheetBuilder.gs` migration trio | T-06 | `SheetBuilder.gs:1466-1586` | **Verified** — `ORDERS_ATTRIBUTION_HEADERS` at 1466-1471, `ensureOrdersAttributionTab_` at 1473, migration block at 1502-1521, `writeOrdersAttributionForDay` at 1533, row builder at 1553-1567. Exact match. |
| §3 — `ordersAttribution.ts` type + parser | T-01, T-02 | `ordersAttribution.ts:18-39, :109-113, :125-128, :155-171` | **Verified** — type at 18-39, `parseSource` at 109-113, range at 128, row mapping at 155-171. Exact match. |
| §4 — `analyzeProductChannel` analog | T-03 | `attributionAnalysis.ts:524-566` | **Verified** — `analyzeAttributionForAdSet` at 524-566 (signature 524-537, null guards 538-540, filter 542-546, `buildAnalysis` call 548). Plan §4d correctly mandates NO `buildAnalysis` call. |
| §5 — `CampaignDrawer` memo + section | T-04, T-05 | `CampaignDrawer.tsx:288-314, :349, :650-794, :767-772, :736-753` | **Verified** — `attributionByAdSet` useMemo at 288-314, `mappedIds` declaration at 349, attribution panel at 650-794, recommendation chip at 767-772, breakdown bar at 736-753, reconciliation gate at 802. Exact match. |

**All file:line references hit live code.** No drift between PATTERNS.md and the actual codebase.

---

## 5. RESEARCH.md Pitfalls Application

All 5 pitfalls appear in task instructions, each with the prescribed guard:

| Pitfall | Required guard | Task | Plan line | Status |
|---------|---------------|------|-----------|--------|
| 1 — `product_id === null` filter | `if (!pid) continue;` in line-item serializer | T-06 (`computeLineItemsCad_`) | 226 ("Skip null `product_id` — `if (!pid) continue;` (Pitfall 1)") | **APPLIED** |
| 2 — `subtotal === 0` divide-by-zero guard | `subtotal > 0 ? proportional : equal-spread` | T-06 | 227 ("Guard `subtotal === 0` — spread `totalCad / items.length` equally, log `Logger.log(...)` so the operator sees it in Executions (Pitfall 2)") | **APPLIED** + the prescribed `Logger.log` for visibility |
| 3 — `facebookShare = N / 0` UI guard | `totalOrders > 0 ? facebookOrders / totalOrders : 0` | T-03 | 103, 108 ("explicit-zero `ProductChannelBreakdown` (NOT `null`) when input is unusable ... This avoids the `facebookShare = NaN` divide-by-zero per RESEARCH.md Pitfall 3"; "`facebookShare = totalOrders > 0 ? facebookOrders / totalOrders : 0` — zero, never NaN") | **APPLIED** |
| 4 — `JSON.stringify([])` not empty string + parser tolerates undefined | Writer emits `'[]'`; parser short-circuits on `null/''` | T-06 (writer) + T-01 (parser) | 234 ("use `JSON.stringify([])` (which gives `'[]'`) over empty string — keeps the writer producing a clean 14-column array"); 58 ("Pitfall 4 — undefined / empty cell returns `[]`, never throws") | **APPLIED** on both sides |
| 5 — Atomic commit for Shopify.gs + SheetBuilder.gs | Bundle the 3 sub-changes | T-06 | 219-220 ("Three coordinated Apps Script edits in **one commit** (they ship together — `writeOrdersAttributionForDay` will fail with a column-count mismatch if `ORDERS_ATTRIBUTION_HEADERS` is bumped without the row builder, and vice versa — per RESEARCH.md Pitfall 5)") | **APPLIED** + correctly explained why splitting would break |

**Result: 5 / 5 pitfalls correctly applied with the prescribed guard.**

Additionally — the plan applies one RESEARCH.md caveat NOT in the pitfall list:
- **RESEARCH.md §7 caveat** — `mappedIds` reference stability (fresh `[]` returned each render would defeat `useMemo`). T-04 (lines 137-145) wraps `mappedIds` in its own `useMemo` keyed `[productMap, storeId, campaignId]`. Verified the live code at `CampaignDrawer.tsx:349` does indeed currently return a fresh array each render (`productMap[campaignKey(...)] ?? []`). This is a real bug fix, not just defensive coding.

---

## 6. Out-of-Scope Adherence

Verified the four CONTEXT.md "do NOT touch" boundaries:

| Boundary | Plan adherence | Evidence |
|----------|----------------|----------|
| `CampaignsTable.tsx` (trust chip) | **honored** — not in `files_modified` frontmatter (lines 9-16); explicitly listed in phase-boundary block (line 24). | T-07 step 7 (line 291) adds an operator smoke that confirms trust chip looks identical. |
| Ad-set / ad channel breakdown | **honored** — line 26 ("Ad-set / ad level channel breakdown — campaign-only for v1"). Analyzer signature in T-03 takes `productIds[]` not `adSetId`/`adId`. | T-03 (line 100) marks it "**third sibling** alongside `analyzeAttributionForAdSet` / `analyzeAttributionForAd`" — sibling, not replacement. |
| `cloudSync.ts` `STATE_KEYS` | **honored** — line 25 explicitly excludes; not in `files_modified`; the new signal is "read-only". | No task touches `cloudSync.ts`. |
| Pre-May 2026 backfill | **honored** — line 27 ("Historical orders pre-May 2026 — analyzer treats unmigrated rows as `lineItems: []`"). T-07 backfill is bounded to 2026-05-08 → 2026-05-18 (line 273, 278-282, six wrappers cover exactly that range). | The "analyzer treats unmigrated rows as `lineItems: []`" guarantee comes from T-01's `parseLineItems` returning `[]` on missing cells. |

**All four out-of-scope boundaries are honored.** No scope creep.

---

## 7. Operator Handoff Clarity (T-07)

T-07 is correctly marked `type: operator-manual` with `files: (none)` (lines 260-261). The plan includes:
- **Exact site to open** (line 266: script.google.com).
- **Exact files to replace** (line 267: `Shopify.gs` and `SheetBuilder.gs`).
- **Smoke test commands** (line 268: `getShopifyOrdersAttribution('uzoshop', '2026-05-18')`; line 269: `runUpdateForDate('2026-05-18')`).
- **Header/cell inspection checklist** (lines 270-272: header row N, today's rows non-empty, earlier dates empty).
- **The 6 chunk wrappers in literal code** (lines 277-282) covering exactly the 2026-05-08 → 2026-05-18 range.
- **Reference to SETUP.md §7** (line 293).
- **Recovery instruction** (line 283: "If any chunk fails mid-run, just re-run that wrapper — `writeOrdersAttributionForDay` is idempotent").
- **Coexistence smoke** (line 291) for REQ-06/08.
- **Commit-message confirmation phrase** the verifier will check (line 300: "T-07 backfill complete 2026-05-08 → 2026-05-18 across 3 stores").

**No ambiguity.** An operator reading T-07 cold can execute it.

---

## 8. Risk + Rollback

The plan's "Risks + Rollback Notes" section (lines 348-376) explicitly covers:

1. **Apps Script timeout if backfill is one block** — addressed in T-07 description (line 273: "the Apps Script 6-minute execution limit forces splitting") and in Risk 2 (lines 355-359: re-runnable wrapper, idempotent write).
2. **Risk 1**: Orders with 0 line items (gift cards, fully-refunded, custom-only) — expected behavior, analyzer skips them.
3. **Risk 2**: Chunk failure — re-runnable.
4. **Risk 3**: Manual-edit malformed JSON — `parseLineItems` self-heals per row.
5. **Risk 4**: Pre-deploy 13-cell rows — intentional per CONTEXT.
6. **Rollback path** (lines 371-375): `git revert` T-01..T-05 → old parser at `A2:M100000` ignores col N; Apps Script edits are still safe in place. No data corruption possible because every change is additive.

**All risks covered, with concrete mitigations.**

---

## 9. Documentation Task Position

T-08 (`docs(P1-08)`) is last in the task list (line 40) and correctly sequenced to **reflect what shipped, not aspiration**. Acceptance (line 329) requires "purely additive" diffs — no rewrites or deletions of existing prose. Confirmed appropriate ordering.

---

## 10. End-to-End Bar Check

**Could an operator open a Meta campaign drawer ~3 hours after execution begins and see "X% of orders containing this product came from Facebook"?**

Walk-through:
- T-01 (~15 min): types + helper compile. Smoke: dashboard still loads.
- T-02 (~10 min): range bumped to N. Smoke: drawer opens without errors (col N comes back undefined for all rows → `[]` everywhere).
- T-03 (~30 min): analyzer + types. Smoke: function compiles, no callers yet.
- T-04 (~20 min): two surgical drawer changes (memo + stable mappedIds).
- T-05 (~45 min): drawer section render. Smoke: section is hidden everywhere (no col N data yet).
- T-06 (~30 min): Apps Script edits (single commit).
- T-07 (~45 min): operator upload + smoke + 6 backfill runs. After this, today's rows have col N populated for the May 8-18 window.
- T-08 (~15 min): docs.

**Total ~3.5 hours of focused work.** At end of T-07 step 6, the operator opens a Meta campaign drawer with mapped products → sees the new section between attribution panel and reconciliation with summary line, 4-segment bar (Facebook/Google/Direct/Other), and a recommendation chip if `facebookShare ≥ 60%` or `< 30%`. The bar is met.

---

## Issues

### BLOCKER
None.

### WARNING
None.

### NIT

1. **NIT-1 — Minor mismatch between RESEARCH `bySource` shape and plan's "Direct" lump.** RESEARCH.md Open Question 1 (line 663-666) recommends "Lump `''` into the **'Other'** bucket in the breakdown bar UI" (UI level). Plan T-03 step 4 (line 106) says "lump empty-string source into `'direct'` per Open Question 1 in RESEARCH.md" — that's at the *analyzer* level, not the UI level. Net behavior is identical because T-05 renders the bar as 4 fixed segments (Facebook / Google / Direct / Other), but the analyzer-level lump means an order with `source === ''` would be counted under the `direct` key in `bySource`. If a future caller inspects raw `bySource['']` it'll be empty. Minor terminology drift; no behavioral defect. **Nit only.**

2. **NIT-2 — T-04 says `[summary, ordersAttrData, rows, mappedIds, storeId]` deps but `mappedIds` itself becomes a memoized value that depends on `productMap, storeId, campaignId`.** The deps array is correct (React will compare `mappedIds` reference), but the comment "include `productMap` and `campaignId`" in PATTERNS.md §5a (line 509) is technically subsumed via the `mappedIds` memo. Not a defect — just a slight surface mismatch between PATTERNS guidance and plan implementation. Both work; the plan's version is arguably cleaner (encapsulation). **Nit only.**

---

## Recommendation

**Proceed to execution.**

Verdict: **PASS**. All 8 success criteria mapped, all 5 pitfalls applied with the prescribed guards, all phase boundaries honored, T-06 atomic bundling correctly justified, T-07 operator handoff has zero ambiguity, rollback path is concrete and safe.

The two nits above are textual / minor encapsulation differences that don't affect correctness — execution should proceed as planned. Address them only if convenient during T-05 review.

Estimated execution time: **~3-3.5 working hours** (T-01..T-06 ≈ 2.5 hours of Claude-driven code + ~45 minutes T-07 operator deploy + 15 minutes T-08 docs).
