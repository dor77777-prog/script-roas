# Data-Consistency & Algorithm-Correctness Audit — Plan

**Date:** 2026-05-27 (execution began; harness first run 2026-05-28)
**Method:** Hybrid — reusable live reconciliation harness + 10 parallel domain agents (code + live prod) + property/golden algorithm tests.
**Spec:** `docs/superpowers/specs/2026-05-27-data-consistency-audit-design.md`
**Plan:** `docs/superpowers/plans/2026-05-27-data-consistency-audit.md`
**Production:** `https://roas-dashboard-smoky.vercel.app` (all live verification — never localhost).
**Branch:** `audit/data-consistency-2026-05-27`

## Tolerances (locked)
- **Same-source (L1):** exact within float epsilon (`max(1¢, 1ppm of peak)`).
- **Cross-source (L2):** ≤1% OR ≤$1 **per (day, store) cell**.

## Severity model
- **P0** — wrong number shown to the user in production / conflict between components / NaN visible / algorithm contract violated in a realistic case.
- **P1** — cross-source mismatch beyond tolerance / reactivity bug / stale-but-recoverable data / algorithm edge divergence.
- **P2** — cosmetic / unlikely edge / minor.

## Verified facts (from scaffolding)
- API params: `/api/data?from=&to=` (and it **ignores** `?store=`, always returns all stores — client slices). Others: `?range.from=&range.to=&store=All|<storeName>`.
- Real store names: **`uzoshop`, `Zol Plus`, `360usmile`** (NOT `zolplus`/`usmile360` — those were wrong in early drafts).
- `products_daily.revenue` = GROSS (pre-refund); `products_daily.netRevenue` = NET (`net_revenue_cad`, nullable for old rows). `data_daily.revenue` = NET (cross-day refund attribution). Reconciliation compares NET↔NET.

## 10-agent ownership (Phase 1)
| Agent | Domain | Invariants |
|-------|--------|-----------|
| A1 | Revenue/Spend/ROAS/Orders cross-component | INV-1..6 |
| A2 | Profit & P&L deep | INV-5 |
| A3 | Campaigns & Ads rollup + Health wiring | INV-7,8 |
| A4 | Products & cohort/attribution | INV-9,10,16 |
| A5 | Filters & reactivity + URL state | INV-11,12,13 |
| A6 | Anomaly & edge-math sweep | INV-14..18 |
| A7 | Live freshness + pipeline write-correctness | INV-19..22 |
| A8 | Operator console | functional |
| A9 | Decision algorithms (Level 6) | Health, cannibalization, stability, insights, badges, banding |
| A10 | Projection algorithms (Level 6) | forecast/projection, GoalTracker pacing, cohort attribution math, AI-report math |

## Seed findings (live harness first run, 2026-05-28)
The `npm run audit:reconcile` harness found **~70 violations** across the May windows. These are leads for Phase 1 to root-cause (some may be legitimate/expected — agents must confirm):

- **SEED-1 (INV-9, → A4/A1/A2): systematic.** `data_daily.revenue` is consistently LOWER than `products_daily(net)` across almost every (date, store). Examples: `2026-05-04/uzoshop 7023.4 vs 7291.16`; `2026-05-01/360usmile 630.3 vs 693.03`. Not noise — a systematic bias. Hypotheses to test: different refund handling (cross-day attribution in data_daily vs per-day net in products), FX timing, or a revenue-definition divergence. **Highest priority.**
- **SEED-2 (INV-10, → A1/A4): co-fires with SEED-1.** `orders_attribution` total also exceeds `data_daily.revenue` on the same cells → confirms `data_daily` is the outlier anchor, not two independent source errors.
- **SEED-3 (INV-7, → A3/A7): early-May Meta spend.** uzoshop 2026-05-01..05-07 shows `data_daily` Meta spend $2200–2706/day but `campaigns_daily` $0. Campaign-level rows possibly missing for those dates (Apps Script legacy bulk write, or cron-live-heavy lookback gap).
- **SEED-4 (INV-7, → A7): today/yesterday boundary.** All-platform `data_daily 0 vs campaigns_daily <large>` for the current day. Likely expected (nightly cron not yet run; cron-live-heavy feeds campaigns_daily). A7 must confirm it self-resolves and is not surfaced to the user as a real zero.
- **SEED-5 (INV-10, → A1): single-day spike.** `2026-05-20/uzoshop data_daily 986.07 vs orders_attribution 2000.09` — a >$1000 one-day gap. Possible pipeline incident.
- **S1 (→ A1/A5):** `/api/data` ignored `?store=`; an earlier probe with `?from=&to=` returned empty while malformed params returned default rows. Confirm param parsing / silent-default behavior is intentional.
- **S2 (→ A6):** `STORE_COLORS` defined twice with different hex per store (`PerStoreCards.tsx:10`, `TodayLive.tsx:139`). Confirm no store is visually mislabeled across components.

## Outputs
- `MASTER-REPORT.md` — consolidated, triaged, dependency-ordered (Phase 2).
- `A1..A10-*.md` — per-domain findings (Phase 1).
- Fixes as commits with tests (Phase 3); live harness re-run clean (Phase 4).
