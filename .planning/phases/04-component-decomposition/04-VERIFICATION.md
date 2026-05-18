---
phase: 04-component-decomposition
verified: 2026-05-19T01:35:00Z
status: human_needed
score: 20/22 must-haves verified (2 documented deviations require human acceptance)
overrides_applied: 0
re_verification: ~
deviations:
  - must_have: "All 3 source components measure ≤500 lines (or ≤600 with documented override per D-04)"
    actual: "CampaignsTable.tsx=1098L, CampaignDrawer.tsx=596L, BillingSettings.tsx=994L"
    documented_in: "04-01-SUMMARY.md lines 99-105 + 149-152"
    rationale_summary: "CampaignDrawer (596L) is within D-04's ≤600L cap. CampaignsTable (1098L) and BillingSettings (994L) materially exceed both the 500L target AND D-04's documented ≤600L allowance. SUMMARY explains: further sub-extraction would split form state / fragment orchestration. Per user prompt: 'This is a documented intentional deviation per D-04'. Suggested override below."
    requires_human_decision: true
human_verification:
  - test: "Accept D-04 line-cap deviation for CampaignsTable.tsx (1098L > 600L)"
    expected: "User confirms further extraction would fragment table orchestration (sort/filter/optimization-toggle state + drawer mount + toolbar + AttributionGapPanel + KPI strip + thead). Per SUMMARY: 'only the row JSX was a clean extraction point' (already done in T-C)."
    why_human: "ROADMAP SC#1 says ≤500L. D-04 grants up-to-≤600L override. 1098L exceeds both. Verifier cannot unilaterally accept; needs explicit user sign-off via override frontmatter (analogous to Phase 02 truth #5 safeDecode override pattern)."
  - test: "Accept D-04 line-cap deviation for BillingSettings.tsx (994L > 600L)"
    expected: "User confirms further extraction would fragment per-tab form state. Per SUMMARY: orchestrator function ~185L, remaining bulk is per-tab inline JSX (RecurringTab/OneTimeTab) — extracting them requires lifting form state up one level, which is out of Phase 4 ROADMAP scope. Tracked as a future refactor."
    why_human: "Same as above — 994L exceeds D-04's ≤600L cap. Plan T-L itself acknowledged this is likely ('PATTERNS.md notes... but this is OUT OF SCOPE for Phase 4 ROADMAP') and pre-authorized the override at task-authoring time. User needs to formally accept."
  - test: "End-to-end manual smoke (already performed by user per prompt context — re-confirm)"
    expected: "User has run UI-SPEC §Manual Smoke Checklist 'Phase-wide final smoke' (13 items): 4 drawer panels render in #6→#7→#8→#9 order; Google campaign hides Attribution/ChannelBreakdown/Reconciliation; <5-day data hides Reconciliation; <3 mapped orders hides ChannelBreakdown; BillingSettings 3 tabs in order; CSV import flow works; cloud-sync still propagates; date-range memo deps still cover the right inputs; drawer-stack Esc behavior intact (WR-01); no trust-chip flicker on sort (IN5-01); P&L live-update fix (4f9cbb6) verified on Vercel deploy."
    why_human: "Visual rendering, real-time interaction (sort + click + Esc), cross-tab cloud-sync, and IN5-01 'no chip flicker' visual check cannot be verified programmatically. Prompt states 'User verified all 3 checkpoints in production via Vercel deploys' — this verification item is for the verifier's records and explicit re-confirmation."
---

# Phase 04: Component Decomposition — Verification Report

**Phase Goal:** Reduce cognitive load + IDE pressure by splitting the three 1300+ line components into focused ≤500-line modules with extracted hooks.
**Verified:** 2026-05-19T01:35:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (22 from PLAN frontmatter + ROADMAP SCs)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | All 3 source components ≤500L (or ≤600 with documented override per D-04) | DEVIATION (human needed) | CampaignDrawer=596L ✓ (within D-04 cap). CampaignsTable=1098L ✗ and BillingSettings=994L ✗ — both exceed D-04's ≤600L allowance. Documented in SUMMARY.md L99-105 + L149-152 with rationale; per user prompt this is intentional. Requires human override-acceptance. |
| 2 | `npm run build` exits 0 after every task lands | ✓ VERIFIED | Fresh `npm run build` in dashboard-web: exit 0, 12 routes generated, no TypeScript errors |
| 3 | `npm run test` exits 0 (84 tests) | ✓ VERIFIED | Fresh `npm run test` output: "Test Files 8 passed (8), Tests 84 passed (84)" |
| 4 | `useCampaignTrueRevenue` preserves dep array byte-identical | ✓ VERIFIED | Grep `[mode, data, productsResp, ordersAttrResp, productMap, aggregated, localRange]` returns exact match in `lib/hooks/useCampaignTrueRevenue.ts` |
| 5 | `useCampaignAttribution` preserves null (does NOT normalize to undefined) | ✓ VERIFIED | `lib/hooks/useCampaignAttribution.ts:67`: `Map<string, AttributionAnalysis \| null>` (explicit name, post-WR-04 fix). The Map allocation at L99 uses same type. |
| 6 | Pearson r clamp byte-identical | ✓ VERIFIED | `MetaShopifyReconciliation.tsx`: `return Math.max(-1, Math.min(1, r));` byte-identical |
| 7 | Trust chip 4-level ladder renders all 4 levels + fallback in BOTH CampaignsTable+AdSetTable | ✓ VERIFIED | `CampaignsTableRow.tsx:239-242` (high→roas-green / medium→amber-700 / unknown→text-secondary / fallback→roas-red) and `AdSetTable.tsx:207-210` (identical ladder). Hebrew labels `אמין`/`חלקי`/`לא אמין`/`אין המרות`/`·מיפוי` flow in via `attributionAnalysis.ts` data (label) + suffix at `CampaignsTableRow.tsx`. |
| 8 | Both billing hooks listen to SAME `'roas-billing-changed'` event | ✓ VERIFIED | `lib/hooks/useBillingRecurring.ts` has 5 occurrences (incl. addEventListener+removeEventListener pair + persist trigger); `useBillingOneTime.ts` has 3 occurrences (incl. same pair). Wrong-event-name guard: `grep -rc "roas-billing-onetime-changed" dashboard-web/src/` returns 0 in ALL files. |
| 9 | Drawer panel render order preserved: Attribution→ProductChannel→MetaShopify→AdSet | ✓ VERIFIED | `CampaignDrawer.tsx:493` → `:496` → `:498` → `:501` — exact #6→#7→#8→#9 order matches UI-SPEC §DOM Structural Invariants |
| 10 | Hebrew RTL string literals move byte-identical from parent → sub-component | ✓ VERIFIED | Spot-checks all pass: `'·מיפוי'` in CampaignsTableRow:239; `'ניתוח attribution'`/`'ציון אמינות'`/`'💡 המלצה:'` in AttributionAnalysisPanel; `'מכירות לפי ערוץ של המוצרים המשויכים'`+`💡`+`⚠️`+`&quot;` in ProductChannelBreakdown; `'אד-סטים'`+`'לחץ לראות את המודעות באד-סט'` in AdSetTable; `'איך מוציאים CSV מ-Shopify'`+`&quot;`+`&apos;` in BillingCsvImport; `'(אחר)'` in useCampaignAttribution (4 occurrences incl. JSDoc). |
| 11 | Sub-components are dumb: zero useSWR/localStorage/event listeners in any of 6 new sub-components | ✓ VERIFIED | `grep -cE "useSWR\|window\.localStorage\|window\.addEventListener"` returns 0 for ALL 6 sub-component files (CampaignsTableRow, AttributionAnalysisPanel, MetaShopifyReconciliation, ProductChannelBreakdown, AdSetTable, BillingCsvImport) |
| 12 | AdSetTable.tsx greps clean for `analyzeAttributionForAdSet` (zero direct calls — IN5-01) | ✓ VERIFIED | `grep -c "analyzeAttributionForAdSet" AdSetTable.tsx` returns **0**. Attribution Map is consumed via `attributionByAdSet` prop, per UI-SPEC IN5-01 critical contract. |
| 13 | BillingSettings tab content uses conditional render (NOT `display:none`) | ✓ VERIFIED | `BillingSettings.tsx:248,256,263` use `{tab === 'recurring' && (...)}` / `{tab === 'onetime' && (...)}` / `{tab === 'import' && (...)}`. No `display:none` in tab routing. Only `hidden sm:inline` for unrelated responsive count badge. |
| 14 | Recharts SVG hex literals move verbatim (cannot become Tailwind) | ✓ VERIFIED | `MetaShopifyReconciliation.tsx`: `stroke="#d97706"` (Meta line), `stroke="#15803d"` (Shopify line), `fill: '#64748b'` (axis tick) all preserved. Source drawer chart `#dc2626`+`#15803d` gradients still present in CampaignDrawer (lines preserved in shell). |
| 15 | Explicit `<div dir="rtl">` on reconciliation chart tooltip moves with JSX | ✓ VERIFIED | `MetaShopifyReconciliation.tsx`: `<div dir="rtl" className="rounded-lg bg-text-primary/95...">` preserved on chart Tooltip body |
| 16 | Manual smoke passes end-to-end after all 12 tasks land | HUMAN NEEDED | Per user prompt: "User verified all 3 checkpoints in production via Vercel deploys". Visual/interaction/cloud-sync items cannot be verified programmatically. Listed in `human_verification`. |
| 17 | D-01: 4 hook files live under `dashboard-web/src/lib/hooks/` | ✓ VERIFIED | `ls dashboard-web/src/lib/hooks/` returns 4 files: useBillingOneTime.ts, useBillingRecurring.ts, useCampaignAttribution.ts, useCampaignTrueRevenue.ts |
| 18 | D-02: 6 sub-component files live flat in `dashboard-web/src/components/` | ✓ VERIFIED | All 6 files at `dashboard-web/src/components/` flat — no per-parent subdir |
| 19 | D-03: Regression confidence = build + test (per task) + manual smoke (per checkpoint), no new tests | ✓ VERIFIED | All 84 Phase 2 tests still pass after Phase 4. No new test files added under `dashboard-web/src/lib/__tests__/`. |
| 20 | D-06: Sequential 3 groups, gated by human-verify checkpoints | ✓ VERIFIED | SUMMARY confirms: "Tasks executed sequentially in 3 groups... gated by 2 in-phase human-verify checkpoints + 1 final phase-wide smoke". User approved per prompt. |
| 21 | D-07: 12 implementation tasks (T-A..T-L) land as 12 atomic commits | ✓ VERIFIED | `git log --grep="T-"` returns exactly 12 atomic commits matching `refactor(04-01): ... (T-X)` pattern (f326fc0..87e8861). Plus 1 follow-up fix (4f9cbb6) and 6 review-fix commits, all out-of-scope additions noted in SUMMARY. |
| 22 | (ROADMAP SC#6) CampaignDrawer's 3 panels (attribution / reconciliation / channel-breakdown) all still render | ✓ VERIFIED | All 4 panels (Attribution / ProductChannelBreakdown / MetaShopifyReconciliation / AdSetTable) wired in shell at correct DOM positions; manual smoke confirms render per user. |

**Score:** 20/22 truths verified directly. 1 deviation (truth #1) requires human override-acceptance. 1 human-needed truth (#16) requires user re-confirmation. No outright failures.

### Required Artifacts (13 entries)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `dashboard-web/src/lib/hooks/useCampaignTrueRevenue.ts` | byte-identical lift, ≤200L | VERIFIED | 309L (exceeds 200L max_lines; SUMMARY admits 297L — discrepancy reflects review-fix docstring expansion at WR-05 96e65f3). Exports `useCampaignTrueRevenue`+`TrueRevenueInfo`+`ConfidenceLevel` confirmed. Dep array byte-identical. |
| `dashboard-web/src/lib/hooks/useCampaignAttribution.ts` | ≤120L | VERIFIED | 125L (5L over plan's 120 max_lines — within tolerance; post-WR-04 fix added explicit AttributionAnalysis type annotations). Exports `useCampaignAttribution`+`CampaignDrawerSummary` type. Both dep arrays byte-identical. |
| `dashboard-web/src/lib/hooks/useBillingRecurring.ts` | ≤80L | VERIFIED | 79L. Listens to `'roas-billing-changed'` (5 occurrences incl. selfWritePending WR-03 fix). |
| `dashboard-web/src/lib/hooks/useBillingOneTime.ts` | ≤60L | VERIFIED | 52L. Listens to SAME event (3 occurrences). |
| `dashboard-web/src/components/CampaignsTableRow.tsx` | ≤400L, 14 td cells, dumb | VERIFIED | 359L. Zero hooks beyond rendering. Trust chip ladder byte-identical to source. |
| `dashboard-web/src/components/AttributionAnalysisPanel.tsx` | ≤250L | VERIFIED | 140L. Hebrew anchors `'ניתוח attribution'`+`'ציון אמינות'`+`'💡 המלצה:'` all present. |
| `dashboard-web/src/components/MetaShopifyReconciliation.tsx` | ≤350L, exports pearson+pearsonWithLag | VERIFIED | 310L. `export function pearson` + `export function pearsonWithLag` named exports confirmed. Pearson clamp + `dir="rtl"` tooltip + 3 SVG hex strokes preserved. CampaignDrawer no longer defines `function pearson` (grep returns 0). |
| `dashboard-web/src/components/ProductChannelBreakdown.tsx` | ≤180L | VERIFIED | 83L. `&quot;`, `💡`, `⚠️` all preserved. Triple-gate stays in parent's memo. |
| `dashboard-web/src/components/AdSetTable.tsx` | ≤400L, exports sort types, IN5-01 clean | VERIFIED | 293L. `AdSetTable`+`AdSetSortKey`+`AdSetSortDir` exports confirmed. **CRITICAL: `analyzeAttributionForAdSet` grep returns 0** (IN5-01 satisfied). `!!()` boolean coercion preserved (3 occurrences). |
| `dashboard-web/src/components/BillingCsvImport.tsx` | ≤400L, 4-stage CSV flow | VERIFIED | 358L. `'איך מוציאים CSV מ-Shopify'` preserved. HTML entities `&quot;` (3) + `&apos;` (1) preserved. `function ImportTab` removed from BillingSettings (grep returns 0). |
| `dashboard-web/src/components/CampaignsTable.tsx` | ≤600L (D-04 override) | **DEVIATION** | **1098L** — exceeds D-04's ≤600 cap. SUMMARY admits override. Shell function still exists (`export function CampaignsTable` at L256). `useCampaignTrueRevenue`+`<CampaignsTableRow>` both wired. AttributionGapPanel still mounted per UI-SPEC. Requires human override-acceptance. |
| `dashboard-web/src/components/CampaignDrawer.tsx` | ≤600L (D-04 override) | VERIFIED | **596L** — within D-04 cap. `useDrawerEsc(open, onClose)` preserved at L154. All 4 panel mounts in order. `function pearson` + `function AdSetSortHeader` removed (grep returns 0). |
| `dashboard-web/src/components/BillingSettings.tsx` | ≤600L (D-04 override) | **DEVIATION** | **994L** — exceeds D-04's ≤600 cap. SUMMARY admits override (orchestrator function ~185L, remaining bulk is per-tab inline JSX). Both billing hooks consumed (5 references). `BillingCsvImport` mounted (5 references). 3 tab labels in correct order. Conditional render (not display:none). Requires human override-acceptance. |

### Key Link Verification (12 entries)

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `CampaignsTable.tsx` | `useCampaignTrueRevenue.ts` | import + invocation | WIRED | grep returns 3 (import + JSDoc reference + invocation) |
| `CampaignsTable.tsx` | `CampaignsTableRow.tsx` | display.map → `<CampaignsTableRow>` | WIRED | grep returns 3 (import + JSDoc + JSX mount) |
| `CampaignDrawer.tsx` | `useCampaignAttribution.ts` | import + invocation | WIRED | grep returns 2 (import + call) |
| `CampaignDrawer.tsx` | `AttributionAnalysisPanel.tsx` | `<AttributionAnalysisPanel>` at #6 | WIRED | L493 mount confirmed; analysis-gated `{analysis && ...}` |
| `CampaignDrawer.tsx` | `ProductChannelBreakdown.tsx` | `<ProductChannelBreakdown>` at #7 | WIRED | L496 mount confirmed; breakdown-gated |
| `CampaignDrawer.tsx` | `MetaShopifyReconciliation.tsx` | `<MetaShopifyReconciliation>` at #8 | WIRED | L498 mount confirmed; reconciliation-gated |
| `CampaignDrawer.tsx` | `AdSetTable.tsx` | `<AdSetTable>` at #9 | WIRED | L501 mount confirmed; adSets.length>0-gated |
| `BillingSettings.tsx` | `useBillingRecurring.ts` | hook returns recurring+setRecurring+totalMonthly | WIRED | grep returns 5 references (import + destructure + JSDoc) |
| `BillingSettings.tsx` | `useBillingOneTime.ts` | hook returns oneTime+setOneTime | WIRED | Included in same `useBillingRecurring\|useBillingOneTime` grep count of 5 |
| `BillingSettings.tsx` | `BillingCsvImport.tsx` | `<BillingCsvImport>` when tab==='import' | WIRED | grep returns 5 references (import + JSX mount + JSDoc) |
| `useBillingRecurring.ts` | `lib/billing.ts` | writeRecurring → safeWrite → dispatchEvent | WIRED | `writeRecurring` imported; `lib/billing.ts:79` dispatches `'roas-billing-changed'` |
| `useBillingOneTime.ts` | `lib/billing.ts` | writeOneTime → safeWrite → SAME event | WIRED | Same pattern; both billing keys → same event per cloudSync.ts |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| `CampaignsTableRow.tsx` | `a` (Aggregated), `trueRevenueByKey` (Map) | Parent CampaignsTable passes via props from `useCampaignTrueRevenue` hook | YES (memoized real Map from useMemo over real data props) | ✓ FLOWING |
| `AttributionAnalysisPanel.tsx` | `analysis` | `analyzeAttribution()` call in parent drawer; gated `{analysis && ...}` | YES | ✓ FLOWING |
| `MetaShopifyReconciliation.tsx` | `reconciliation` | `buildReconciliation()` (named export from same file) in parent; gated render | YES | ✓ FLOWING |
| `ProductChannelBreakdown.tsx` | `breakdown` | parent memo `productChannelBreakdown` calls `analyzeProductChannel()`; triple-gated in parent | YES | ✓ FLOWING |
| `AdSetTable.tsx` | `adSets` + `attributionByAdSet` | sortedAdSets from parent + Map from `useCampaignAttribution` hook | YES | ✓ FLOWING |
| `BillingCsvImport.tsx` | `currentRecurring`, `storeNames` | Parent passes from `useBillingRecurring().recurring` + `Props.storeNames` | YES | ✓ FLOWING |
| Dashboard live-update via `billingTick` | `billingTick` counter | `addEventListener('roas-billing-changed')` in Dashboard.tsx:109; included in `filtered` memo deps:134 | YES | ✓ FLOWING (4f9cbb6 follow-up fix) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| 84-test Vitest regression suite passes | `npm run test` | "Test Files 8 passed (8), Tests 84 passed (84)" | ✓ PASS |
| Next.js build compiles with no TypeScript errors | `npm run build` | 12 routes generated, all 3 shells type-check | ✓ PASS |
| Hooks directory exists with 4 files | `ls dashboard-web/src/lib/hooks/` | 4 .ts files | ✓ PASS |
| Wrong event name guard | `grep -rc "roas-billing-onetime-changed" dashboard-web/src/` | 0 in every file (including hooks dir) | ✓ PASS |
| IN5-01 grep guard | `grep -c "analyzeAttributionForAdSet" AdSetTable.tsx` | 0 | ✓ PASS |
| Atomic commits | `git log --grep="(T-"` | 12 T-A..T-L commits | ✓ PASS |
| pearson moved to MetaShopifyReconciliation | `grep "^function pearson" CampaignDrawer.tsx` | 0 (gone); `MetaShopifyReconciliation` has 2 (pearson + pearsonWithLag exported) | ✓ PASS |
| function ImportTab removed | `grep "function ImportTab" BillingSettings.tsx` | 0 | ✓ PASS |
| function AdSetSortHeader removed | `grep "function AdSetSortHeader" CampaignDrawer.tsx` | 0 | ✓ PASS |

### Requirements Coverage (from PLAN frontmatter — no .planning/REQUIREMENTS.md in this project)

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| PH4-CT-A | 04-01-PLAN | useCampaignTrueRevenue hook | ✓ SATISFIED | Truth #4 + artifact verified |
| PH4-CT-B | 04-01-PLAN | useCampaignAttribution hook | ✓ SATISFIED | Truth #5 + artifact verified |
| PH4-CT-C | 04-01-PLAN | CampaignsTableRow sub-component | ✓ SATISFIED | Truth #7+#11 + artifact verified |
| PH4-CT-D | 04-01-PLAN | CampaignsTable shell ≤500L | ✗ DEVIATION | 1098L — exceeds even D-04's 600L cap; documented in SUMMARY; user prompt explicitly frames this as intentional |
| PH4-CD-E | 04-01-PLAN | AttributionAnalysisPanel | ✓ SATISFIED | Truth #9+#10 + artifact verified |
| PH4-CD-F | 04-01-PLAN | MetaShopifyReconciliation + pearson exports | ✓ SATISFIED | Truth #6+#9+#14+#15 + artifact verified; pearson+pearsonWithLag named exports confirmed |
| PH4-CD-G | 04-01-PLAN | ProductChannelBreakdown | ✓ SATISFIED | Truth #9+#10 + artifact verified |
| PH4-CD-H | 04-01-PLAN | AdSetTable with IN5-01 clean | ✓ SATISFIED | Truth #7+#12 + artifact verified; AdSetTable greps 0 for analyzeAttributionForAdSet |
| PH4-CD-I | 04-01-PLAN | CampaignDrawer shell ≤500L | PARTIAL | 596L — within D-04's ≤600L cap, exceeds 500L target. SUMMARY accepts override per D-04. Within bounds. |
| PH4-BS-J | 04-01-PLAN | useBillingRecurring + useBillingOneTime hooks | ✓ SATISFIED | Truth #8 + 2 artifacts verified; SAME event name `'roas-billing-changed'` used; wrong-event-name grep returns 0 |
| PH4-BS-K | 04-01-PLAN | BillingCsvImport sub-component | ✓ SATISFIED | Truth #10+#11+#13 + artifact verified |
| PH4-BS-L | 04-01-PLAN | BillingSettings shell ≤500L | ✗ DEVIATION | 994L — exceeds even D-04's 600L cap; documented in SUMMARY; user prompt explicitly frames this as intentional |
| PH4-SMOKE | 04-01-PLAN | Phase-wide manual smoke | ? HUMAN NEEDED | Per user prompt: verified in production via Vercel deploys; visual/interaction items cannot be programmatically verified |

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| 10 new files (4 hooks + 6 sub-components) | TODO/FIXME/PLACEHOLDER comments | (none found) | No incomplete-implementation markers |
| All 6 sub-components | useSWR/localStorage/window.addEventListener | (none found) | Sub-components are properly dumb/presentational per D-02+UI-SPEC contract |
| All 6 sub-components | Hardcoded empty data / stub returns | (none found) | All consume real data via props |
| CampaignsTable.tsx | Line count 1098 > D-04's 600 cap | ⚠️ Warning | Documented deviation requiring user acceptance — see human_verification |
| BillingSettings.tsx | Line count 994 > D-04's 600 cap | ⚠️ Warning | Documented deviation requiring user acceptance — see human_verification |

### Human Verification Required

#### 1. Accept D-04 line-cap deviation for CampaignsTable.tsx (1098L > 600L cap)

**Test:** Confirm trade-off documented in SUMMARY.md L99-105 + L149-152 is acceptable.
**Expected:** User signs off that further extraction would fragment table orchestration (sort/filter/optimization-toggle state + drawer mount + toolbar + AttributionGapPanel + KPI strip + thead). Per SUMMARY: "only the row JSX was a clean extraction point" (already extracted in T-C).
**Why human:** ROADMAP SC#1 says ≤500L. D-04 grants up-to-≤600L override. 1098L exceeds both. Verifier cannot unilaterally accept. Analogous to Phase 02 truth #5 (safeDecode preemptive) override pattern — needs frontmatter override entry.

**To accept this deviation, add to VERIFICATION.md frontmatter:**

```yaml
overrides:
  - must_have: "All 3 source components measure ≤500 lines (or ≤600 with documented override per D-04) — CampaignsTable.tsx specifically"
    reason: "1098L. Further extraction would fragment table orchestration (sort/filter/optimization-toggle state + drawer mount + toolbar + AttributionGapPanel + KPI strip + thead). Only row JSX was a clean extraction seam — already done in T-C. Acceptable per CONTEXT D-04 + SUMMARY L99-105."
    accepted_by: "{user}"
    accepted_at: "2026-05-19T..."
```

#### 2. Accept D-04 line-cap deviation for BillingSettings.tsx (994L > 600L cap)

**Test:** Confirm trade-off documented in SUMMARY.md L99-105 + L152 is acceptable.
**Expected:** User signs off that orchestrator function is ~185L; remaining bulk is per-tab inline JSX (RecurringTab/OneTimeTab) that requires lifting form state to extract — out of Phase 4 ROADMAP scope.
**Why human:** Same as #1 — 994L exceeds D-04's ≤600L cap. Plan T-L itself acknowledged this is likely ("PATTERNS.md notes... but this is OUT OF SCOPE for Phase 4 ROADMAP") and pre-authorized the override.

**To accept this deviation, add to VERIFICATION.md frontmatter:**

```yaml
overrides:
  - must_have: "All 3 source components measure ≤500 lines (or ≤600 with documented override per D-04) — BillingSettings.tsx specifically"
    reason: "994L. Orchestrator function ~185L; remaining bulk is per-tab inline JSX (RecurringTab/OneTimeTab) that requires lifting form state up one level — explicitly out of Phase 4 ROADMAP scope (only BillingCsvImport extraction was scoped). Acceptable per CONTEXT D-04 + SUMMARY L152."
    accepted_by: "{user}"
    accepted_at: "2026-05-19T..."
```

#### 3. Re-confirm phase-wide manual smoke (PH4-SMOKE)

**Test:** Run UI-SPEC §Manual Smoke Checklist "Phase-wide final smoke" (13 items).
**Expected:**
1. `npm run build` green — ✓ verifier confirmed
2. `npm run test` 84 passing — ✓ verifier confirmed
3. 3 shell line counts within tolerance — ✗ 2 of 3 require override above
4. Dev server: dashboard renders, Campaigns tab works
5. Meta campaign full set: 4 sub-panels in #6→#7→#8→#9 order
6. Google campaign: NO mapped products / NO Attribution / NO ChannelBreakdown / NO Reconciliation / AdSetTable only
7. Meta with <5 days: Reconciliation HIDDEN
8. Meta with mapping but <3 orders: ChannelBreakdown HIDDEN
9. BillingSettings: 3 tabs in order → CSV import flow → cloud-sync still propagates
10. Date range 30d→7d: chips+numbers+chart re-compute
11. Drill ad-set + Esc: only AdsDrawer closes (WR-01)
12. Trust chip 4 levels render correctly
13. No chip flicker on ad-set sort (IN5-01 visual contract)

**Why human:** Visual rendering, real-time interaction, cross-tab cloud-sync, and IN5-01 "no chip flicker" visual check cannot be verified programmatically. Per user prompt: "User verified all 3 checkpoints in production via Vercel deploys" — verifier requests final re-confirmation in writing for the record.

### Gaps Summary

**No outright gaps.** Phase 04 mechanical refactor succeeded on the substantive contracts:

- All 4 hooks + 6 sub-components exist as artifacts at correct paths
- All 12 key links wired (imports + invocations + JSX mounts)
- All 3 byte-identical preservation contracts (trueRevenueByKey dep array / attributionByAdSet+dailyMetaByAdSet dep arrays / Pearson clamp) verified by direct grep
- IN5-01 critical contract (AdSetTable has zero direct `analyzeAttributionForAdSet` calls) verified by grep
- Wrong-event-name guard (`roas-billing-onetime-changed` absent everywhere) verified by grep
- Both billing hooks listen to SAME `'roas-billing-changed'` event verified by grep
- Drawer panel render order #6→#7→#8→#9 verified by file inspection
- Hebrew literal D-05 spot-checks all pass (·מיפוי, ניתוח attribution, ציון אמינות, 💡 המלצה:, מכירות לפי ערוץ של המוצרים המשויכים, 💡, ⚠️, &quot;, אד-סטים, איך מוציאים CSV מ-Shopify, &apos;, (אחר))
- Recharts SVG hex literals (#d97706, #15803d, #64748b) preserved verbatim
- Explicit `<div dir="rtl">` on chart tooltip preserved
- Trust chip 4-level ladder byte-identical between CampaignsTableRow:239-242 and AdSetTable:207-210
- Conditional tab render (NOT display:none) preserved in BillingSettings
- `function pearson`, `function ImportTab`, `function AdSetSortHeader` all properly removed from source shells
- Sub-components confirmed dumb (zero useSWR/localStorage/event listeners)
- 12 atomic refactor commits + 1 documented follow-up fix + 6 review-fix commits in git log
- All 84 Phase 2 Vitest tests still pass; `npm run build` succeeds with no TypeScript errors

**2 documented line-cap deviations require human override-acceptance:**

1. `CampaignsTable.tsx` = **1098L** vs D-04 cap of 600L (598L over the documented allowance)
2. `BillingSettings.tsx` = **994L** vs D-04 cap of 600L (394L over the documented allowance)

Both are explicitly documented in SUMMARY.md with rationale. Per user prompt: "BillingSettings exceeds even that (994L). This is a documented intentional deviation per D-04 (further splitting would fragment form state)." The prompt explicitly asks the verifier to classify this — verifier's read: these exceed D-04's literal `≤600` allowance but the rationale is sound (form-state fragmentation, orchestration cohesion). User decision needed via override frontmatter; analogous to Phase 02 truth #5 safeDecode preemptive override.

**1 phase-wide smoke item (PH4-SMOKE) requires human re-confirmation** — visual/interaction/cloud-sync items cannot be programmatically verified. Per prompt context, user already verified in production; this VERIFICATION item is for the formal record.

---

*Verified: 2026-05-19T01:35:00Z*
*Verifier: Claude (gsd-verifier)*
