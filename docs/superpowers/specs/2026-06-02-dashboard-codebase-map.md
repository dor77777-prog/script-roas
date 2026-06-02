# ROAS Dashboard — full codebase + algorithm map (current state)

**Date:** 2026-06-02
**Method:** 9-agent evidence-based audit (8 parallel area inventories — UI surface, metric algorithms, attribution algorithms, data pipeline, API routes, state/hooks/utils, dead code, correctness issues → 1 compiler). Every item cited to `file:line`. Nothing assumed.

## Executive summary
Mature, single-tenant Next.js + Inngest + Supabase tool (3 stores, all CAD), **overwhelmingly implemented and well-audited**. UI (8 tabs, ~55 components), the metric layer (blended + platform + Shopify-attributed ROAS, P&L, COGS/tx-fee/billing proration, CPM/CTR/CPC/CPA), attribution/health/cannibalization intelligence, the full pipeline (Shopify + Meta/Google/TikTok workers + Inngest crons + Postgres + agg RPC), 27 API routes, and the client state/hooks layer are all present with extensive audit-fix provenance. Cross-component invariants (sum exactness, single FX application, guarded divisions, no NaN/∞ to UI) verified clean in the 2026-05-28 audit. **No P0/P1 correctness bugs open.** Remaining work is small/low-risk.

## Counts by status
| implemented | partial | missing | buggy | dead |
|---|---|---|---|---|
| **138** | 6 | 0 | 2 | 8 |

## Tab → component map (all `keep`)
- **בית (home)** `Dashboard.tsx:415-1034` — PerStoreRow (3-store deck, banded ROAS + Spend/Revenue/Orders/AOV + per-platform CPM) · CommandCenterHero (Revenue/Spend/OperatingProfit + CPM/Orders/COGS/ROAS, deltas + sparklines) · RoasTargetChart (independent range, 3.0x target line, pins) · InsightsBoard + ActivityFeed (live, 12s) · MobileStickyRoas.
- **פעילות (activity)** — `ActivityEventsTab` paginated store-events browser (sale/refund/add_to_cart).
- **טבלאות אופטימיזציה (archive)** — `AnalysisArchiveTab` → MonthlyTables (12-month / single-month, per-store|summary).
- **P&L (pnl)** `Dashboard.tsx:1041-1095` — GoalTracker (monthly goal, global) · BillingSettings · CogsSettings · PnLBreakdown (Revenue − AdSpend − COGS − TxFees − FixedCosts → Net).
- **מגמות (trends)** — `AnalysisTrendsTab` RoasChart + AnnotationsPanel.
- **קמפיינים (campaigns)** — QuadrantScatter + CampaignsTable → CampaignDrawer (6 sub-tabs) → AdsDrawer (per-ad true-ROAS chip).
- **מוצרים (products)** — ProductsTable + ProductCentricView (product→campaign pivot, true ROAS).
- **פירוט (detail)** — DetailTable (per-store×platform×day).

## 🔧 To-fix (6 — no P0/P1; impact-ordered)
| sev | item | evidence |
|---|---|---|
| MED | **TikTok manual-override blocked at client validator** (DB already allows tiktok) | `src/lib/operatorManualOverrides.ts:19,59` vs migration `20260522102151...:39-42` |
| MED | **MonthlyTables store dropdown desyncs from global store filter** | `src/components/MonthlyTables.tsx:22-67` |
| MED | **Hardcoded "25% COGS / 6.5% fees" prose** (COGS now editable per-store → prose can misstate) | `PnLBreakdown.tsx:27,224`; `aiReport.ts:1311` |
| LOW | **Inline `const fetcher` duplicated in 4 components** (should import shared `fetchJson`) | `AiReportButton.tsx:19`, `SyncIndicator.tsx:27`, `CommandPalette.tsx:67`, `InsightsBoard.tsx:44` |
| LOW | **Leader/Risk badge edge case** — trophy can show on a red-zone (<2.0x) "leader" | `src/lib/multiMappingCohort.ts:387` |
| LOW | **CampaignsTable tooltip clipped by overflow-auto on mobile** (needs portal/Floating-UI) | `CampaignsTable.tsx:~2533` |

## 🗑️ To-delete (8 dead — confirmed no live importers)
`high` confidence (definition-only, zero call sites): `EMAIL_COST_PER_STORE_MONTHLY` (`costs.ts:40`) · `fmtMoneyBare` (`format.ts:126`) · `fmtNum2` (`format.ts:132`) · `fmtMoneyCompactTight` (`format.ts:180`) · `fmtDeltaPct` (`format.ts:194`) · `fmtDateShort` (`format.ts:220`) · `formatPct` (`utils.ts:44`).
`verify-first`: `safeDecode` in `utils.ts:74` (used only by its own test; prod uses the internal one at `shopify.ts:810`) + its phase-5 TODO at `utils.ts:53`.

## 🟡 Partial / by-design simplifications (6 — not bugs)
- **TikTok manual-override** — backend ready, client UI missing (see To-fix #1).
- **Modeled/view-through attribution** — we only surface the platform's residual (claim − our deterministic), no in-house re-attribution model. `attributionAnalysis.ts:80-81,354,478-482`.
- **ROAS profitability simplifications** — COGS 25% / tx 6.5% defaults (editable + env override) and **VAT=0** (cross-border, by design). `analytics.ts:17,31-68,164-169`.
- **ROAS confidence interval** — models AOV dispersion only, not conversion-count uncertainty; directional. `attributionAnalysis.ts:361-399`.
- **Leader/Risk badge** robustness (see To-fix #5).
- **Campaign health-score** pivot division — already guarded (`Math.max(1.01,pivot)`), risk neutralized. `campaignHealthScore.ts:153-156`.

## 🏗️ To-build (small gaps found by the map; the strategic build items are in the improvement plan)
- **Logout UI affordance** — `/api/logout` exists (`route.ts:1-27`) but no UI button.
- **TikTok-aware manual-override editor** — finish the client side (DB+pipeline ready).
- **Operator store buttons** — show display names (STORE_ID_TO_NAME exists) instead of raw IDs.

> Strategic capability gaps (new-vs-returning/NC-ROAS, first-click lens, MER labeling) are intentionally NOT listed here — they live in the companion improvement-plan doc, since they're forward-looking features, not current-state defects.
