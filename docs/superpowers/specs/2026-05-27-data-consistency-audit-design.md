# End-to-End Data-Consistency & Algorithm-Correctness Audit + Fix — Design

**Date:** 2026-05-27
**Status:** Approved (brainstorming complete, pending writing-plans)
**Production target:** `https://roas-dashboard-smoky.vercel.app` (confirmed live via `/api/health` → 200)
**Trust model:** Internal tool · single-user-at-a-time · URL-obscurity. No concurrent-write scenarios.

## Goal

Make the dashboard hermetically correct before full production release. Two distinct correctness questions, both answered for **every** tab, chart, card, panel, and the operator console + cron pipeline:

1. **Reconciliation** — does the same metric agree everywhere it appears, react correctly to filters, and contain no anomalies?
2. **Algorithm correctness** — does every algorithm that produces a *conclusion* (verdict / grade / label / recommendation / insight / anomaly flag) or drives an *action* (alert / badge / projection) actually do what it claims, across many cases?

This is **audit + fix**: confirmed bugs are fixed in the same run, TDD-style, and re-verified against live production.

## Distinction from the 2026-05-24 audit

The prior audit (`.planning/audit-2026-05-24/`) was a **codebase** audit — security, algorithm code-review, pipeline, a11y, docs, perf. It did **not** verify runtime data correctness across rendered components, nor exercise the decision algorithms across a case matrix. This audit fills exactly that gap. Known prior P0s (percent-of-revenue billing) are already shipped; this run independently re-verifies them via the reconciliation harness.

## Method (hybrid)

- **Backbone:** parallel domain agents (the proven `superpowers:dispatching-parallel-agents` method from 2026-05-24). Each agent verifies **both** code (the math/contract) **and** live production (real numbers from the prod API).
- **Spine asset:** a small, reusable reconciliation **harness** (`npm run audit:reconcile`) that pulls live prod data and asserts the Level-1/Level-2 invariants deterministically. It survives the audit as a regression artifact.
- **Algorithm verification:** deterministic vitest suites (golden + edge + property-based via `fast-check`) over the pure decision functions.
- **Final pass:** browser walkthrough of the highest-value tabs to catch render/visual issues code can't.

## Invariant catalog

Each invariant is checked twice: (a) in code — prove the math/contract; (b) live — pull real prod numbers and confirm they actually hold.

### Level 1 — Same metric across components (same source; tolerance = float epsilon only)
- **INV-1 Revenue:** `KpiCards ≡ HeroOverview ≡ Σ PerStoreCards ≡ Σ DetailTable ≡ PnL` for the same range+store.
- **INV-2 Spend:** same component set.
- **INV-3 ROAS:** in each component `roas == revenue/spend`, and equal across components.
- **INV-4 Orders:** `KpiCards.orders ≡ Σ PerStoreCards ≡ Σ ordersByStore`.
- **INV-5 Net profit:** `KpiCards.netProfit` formula vs `PnL.trueNetProfit` — must agree, or the difference is documented and intentional.
- **INV-6 Per-platform spend:** `Σ fb/ga/tt in DetailTable == data_daily platform columns`.

### Level 2 — Cross-source reconciliation (different tables; tolerance ≤1% OR ≤$1 per day/store)
- **INV-7** `Σ campaigns_daily.spend` per platform ≈ `data_daily` platform spend.
- **INV-8** `Σ ads_daily` rolls up to `campaigns_daily` per campaign.
- **INV-9** `Σ products_daily.revenue` per store/day ≈ `data_daily.revenue` (gross vs net reconciled explicitly).
- **INV-10** `Σ orders_attribution.total` ≈ `data_daily.revenue`; order count ≈ `products_daily.orders`.

Any gap above tolerance is a finding requiring an explicit explanation (FX rounding, attribution-window difference) or a fix.

### Level 3 — Filter reactivity
- **INV-11** Components that should react to range/store recompute correctly.
- **INV-12** Intentional non-reactors behave per spec: GoalTracker (global), TodayLive (always today), MonthlyTables (fixed 17-month window).
- **INV-13** Previous-period delta uses the correct previous range and matches a recomputation.

### Level 4 — Anomalies / edge math
- **INV-14** No NaN/Infinity: ROAS@spend=0, margin@revenue=0, CPM@impressions=0, growth%@early≤0, CPA@conversions=0.
- **INV-15** No impossible negatives (spend, impressions, units). Refund-driven negative net revenue is legitimate and documented.
- **INV-16** No double-counting in multi-mapped product cohort attribution.
- **INV-17** Currency: FX applied exactly once; everything CAD.
- **INV-18** Date/timezone: Asia/Jerusalem boundaries consistent; "today" identical across TodayLive and crons; future-date cap honored.

### Level 5 — Live freshness / update
- **INV-19** TodayLive: today's revenue present and updating (cron-live, 15 min).
- **INV-20** Live CPM: today's impressions present (cron-live-heavy).
- **INV-21** Campaigns tab: today not empty (Phase 13.9).
- **INV-22** "synced N min ago" matches `updated_at`.

### Level 6 — Algorithm correctness (NEW)
**In scope:** any algorithm producing a conclusion or driving an action. **Out of scope:** pure formatting.

For each algorithm: extract its intended contract → build a case matrix (known-answer, edge/degenerate, property-based behavioral invariants) → run against the current implementation → flag every divergence between actual behavior and the contract.

Algorithms to verify:
- **Campaign Health Score** (A–F; weights profitability 40 / volume 15 / trajectory 25 / attribution 20; cohort adjustment).
- **Cannibalization detection** (`cannibalizationDetection.ts`).
- **Window stability / "volatile" verdict** (`computeWindowStability`).
- **Insights engine** (anomalies / recommendations / opportunities + severity tiers).
- **Forecast / month-end projection + GoalTracker pacing** (`forecastMonthEnd`, `projectedNetMtd`).
- **Multi-mapping cohort attribution** (true revenue, pixel-vs-Shopify delta).
- **ROAS banding** (color thresholds) + leader/risk badge logic.
- **AI executive-briefing math** (`aiReport.ts`) — verify input/prompt assembly and numeric post-processing only; **not** the LLM output (non-deterministic).

Example property invariants: all-else-equal, higher profitability ⇒ health grade not lower (monotonicity); banding is a total, gap-free, non-overlapping partition of the ROAS axis; projection ≥ MTD-actual when remaining days ≥ 0.

## Execution architecture — 10 parallel domain agents

Each agent reads code **and** pulls live prod data for its domain, and emits findings with severity + evidence (code `file:line` + live numbers).

- **A1** Revenue/Spend/ROAS/Orders cross-component (INV-1..6).
- **A2** Profit & P&L deep (INV-5): COGS, transaction fees, fixed costs, percent-of-revenue, forecast inputs.
- **A3** Campaigns & Ads rollup + Health Score wiring (INV-7,8) + campaign-level anomalies.
- **A4** Products & cohort/attribution (INV-9,10,16): multi-mapping, cannibalization wiring.
- **A5** Filters & reactivity + URL state (INV-11,12,13).
- **A6** Anomaly & edge-math sweep (INV-14..18) across all components.
- **A7** Live freshness + pipeline write-correctness (INV-19..22) + cron non-clobber logic (cron-daily vs cron-live vs cron-live-heavy SELECT+UPSERT preserve).
- **A8** Operator console correctness (sync / jobs / backfill / overrides / token-failures / reset).
- **A9** Decision algorithms (Level 6): Health Score, cannibalization, stability, insights, badges, ROAS banding.
- **A10** Projection algorithms (Level 6): forecast/projection, GoalTracker pacing, cohort attribution math, AI-report math.

## Deliverables

- **Reconciliation harness:** `dashboard-web/scripts/audit/reconcile.ts`, runnable via `npm run audit:reconcile`. Pulls live prod (`/api/data`, `/api/campaigns`, `/api/products`, `/api/orders-attribution`) over a set of (range × store) combos, asserts Level-1/2 invariants within tolerance, prints a pass/fail table. **Manual-run only** (does not pull prod on every push).
- **Algorithm test suites:** vitest golden + edge + property (`fast-check`) over the Level-6 pure functions. **These run in pre-push/CI** (local, fast, deterministic).
- **Audit report:** `.planning/audit-2026-05-27-data-consistency/` — `MASTER-REPORT.md` + one file per domain (mirrors the 2026-05-24 layout).
- **Fixes:** commits with tests for every confirmed P0/P1.
- **Doc updates:** per the memory rule — User Manual for any UX-visible change, Architecture doc for any pipeline/algorithm change.

## Severity model

- **P0** — wrong number shown to the user in production / conflict between components / NaN visible / algorithm contract violated in a realistic case.
- **P1** — cross-source mismatch beyond tolerance / reactivity bug / stale-but-recoverable data / algorithm edge-case divergence.
- **P2** — cosmetic / unlikely edge / minor.

## Fix workflow

For each confirmed P0/P1:
1. `superpowers:systematic-debugging` to root-cause.
2. TDD: write a failing test that reproduces the wrong math / contract violation with representative data.
3. Fix the code → test green.
4. Re-run the live harness (reconciliation bugs) or the property suite (algorithm bugs) to confirm.
5. Reactivity/visual fixes verified via the `run` skill / browser.

## Decisions (locked)

- **Cross-source tolerance:** ≤1% OR ≤$1 per day/store.
- **Harness gating:** live reconciliation = manual (`npm run audit:reconcile`); algorithm property/golden tests = pre-push + CI.
- **Algorithm depth:** comprehensive — golden + edge + property-based (`fast-check`).

## Out of scope

- Security re-audit (covered 2026-05-24).
- a11y / Tailwind-physical-class cleanup (covered 2026-05-24 P1/P2).
- Non-determinism of LLM output in the AI report (only its surrounding math is verified).
- New features. This run only verifies and corrects existing behavior.
