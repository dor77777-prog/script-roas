# A2 — Profit & P&L Correctness Audit

**Date:** 2026-05-28  
**Agent:** A2  
**Domain:** Profit & P&L correctness (INV-5 deep)  
**Production:** https://roas-dashboard-smoky.vercel.app  
**Data pulled:** `/api/data?from=2026-05-01&to=2026-05-26` — 78 rows, 3 stores

---

## Live P&L Cascade (2026-05-01..05-26, All stores, seed billing)

Computed manually from raw API rows to verify code matches live output:

```
Revenue:           CAD    97,787.17
Ad Spend:          CAD    41,266.78  (42.2%)
COGS (25.0%):      CAD    24,446.79  (25.0%)  — all 78 rows hasCogs=True
Tx Fees (6.5%):    CAD     6,356.17  (6.5%)
Fixed (seed only): CAD        52.00           — 3× $20/mo email × 26/30 days
────────────────────────────────────────────
True Net Profit:   CAD    25,665.43  (26.2%)
```

Per-store breakdown (all at 25.0% COGS, 6.5% tx fees):

| Store | Revenue | COGS | Effective COGS% |
|-------|---------|------|-----------------|
| uzoshop | 84,793.40 | 21,198.35 | 25.00% |
| Zol Plus | 7,744.20 | 1,936.05 | 25.00% |
| 360usmile | 5,249.57 | 1,312.39 | 25.00% |

---

## Findings Table

| ID | Severity | INV | File:Line | Live Evidence | Why Wrong | Suggested Fix |
|----|----------|-----|-----------|---------------|-----------|---------------|
| A2-01 | PASS | INV-5 | KpiCards.tsx:219 + PnLBreakdown.tsx:117 | Both render `current.trueNetProfit` from same `filtered.curAgg` object | No conflict — same object, same value by construction | N/A |
| A2-02 | PASS | — | analytics.ts:165–168 | All 78 rows hasCogs=True; effective COGS=25% all stores | COGS read directly from row (`r.cogs`) when `hasCogs=True`; per-store fallback only fires for legacy rows | N/A |
| A2-03 | PASS | — | analytics.ts:169 | Σ tx fees by store = $6,356.17 = global $97,787.17×6.5% | All stores use default 6.5%; sum invariant holds exactly | N/A |
| A2-04 | PASS | — | analytics.ts:247 | grossProfit = $56,520.39 = $97,787.17 − $41,266.78 | `grossProfit: revenue − spend` — correctly revenue minus ad-spend, not COGS-mislabeled | N/A |
| A2-05 | PASS | — | analytics.ts:255 | trueMargin = 0 when revenue=0 | Protected: `revenue > 0 ? trueNetProfit / revenue : 0` | N/A |
| A2-06 | P1 | INV-5 | billing.ts:241–252 + analytics.ts:231–237 | Scenario: 2%-of-revenue `All` row with May data: filter=uzoshop shows fixedCosts=$1,695.87; PerStoreCards (aggregateByStore) shows uzoshop=$651.91; Δ=$1,043.96 | `All`-row percent uses **even split** in `aggregateByStore` but charges **2% of that store's revenue** in single-store filter path. Σ invariant holds (both sum to $1,955.74) but per-store attribution is internally inconsistent. | Change `billingForRange` All-row percent `byStore` split from even to revenue-weighted: `byStore[s] += amount × revenueByStore[s] / total` when `revenueByStore` supplied. |
| A2-07 | P2 | — | costs.ts:46–74 | `buildPnLBreakdown` exported but zero callers (`grep` confirmed) | Dead code uses fixed `TRANSACTION_FEES_RATE=0.065` ignoring per-store env var calibration — would produce wrong tx fees if ever called | Delete the dead function or add a deprecation JSDoc. |
| A2-08 | P2 | — | PnLBreakdown.tsx:242 | All 3 live stores use exactly 25.00% — no live error today | Note text hardcoded `"הערכה: 25% מההכנסה"` — will mislead if any store gets `${STORE}_COGS_RATE` set differently. KpiCards already removed the label suffix for this reason (commit line 192-199). | Derive note dynamically: show effective COGS% from `current.cogs / current.revenue` instead of the literal "25%". |
| A2-09 | P1 | — | insights.ts:599–607 | Forecast uses `billingForRange({ revenue: projectedRev })` with no `revenueByStore` | Store-specific percent-of-revenue rows in the forecast use even-split fallback. Only affects the projected-net line in GoalTracker. Already documented as known limitation in code comment. | Pass `revenueByStore` derived from the last-7-day baseline store split. Low urgency — `All` rows are the dominant operator pattern. |
| A2-10 | PASS | — | billing.ts:204 + analytics.ts:208–223 | Flat recurring `All` rows: Σ per-store = global. Flat per-store rows: each charged exactly once. One-time `All` rows: split evenly. | All flat-cost invariants hold exactly. | N/A |

---

## Narrative

### INV-5: KpiCards.netProfit vs PnLBreakdown.trueNetProfit (verified PASS)

Both tiles draw from the **same Aggregate object** (`filtered.curAgg`) computed by a single `aggregate(cur, filters.range)` call in `Dashboard.tsx:178`. The KpiCards "רווח נטו" card uses `rawValue={current.trueNetProfit}` (KpiCards.tsx:221). PnLBreakdown computes `finalProfit = revenue − spend − cogs − transactionFees − fixedCosts` in its render (PnLBreakdown.tsx:114–117), which is algebraically identical to `aggregate().trueNetProfit` (analytics.ts:239). No conflict — **identical by construction**.

The PnLBreakdown `trueMargin` chip uses `current.trueMargin` from the same object — also consistent.

### COGS Rate: Single rate (25%) uniformly applied, correctly (PASS)

All 78 rows in the May 2026 window have `hasCogs=True`, meaning the cron writer persisted the COGS value. `aggregate()` uses `r.cogs` directly for these rows (analytics.ts:165–167), bypassing the read-side `getCogsRateForStore()` fallback. Effective rate = exactly 25.00% for all 3 stores — no per-store env var calibration has been set in production. The fallback path (`hasCogs=False` → `r.revenue × getCogsRateForStore()`) is correct code but untriggered on current data.

### Transaction Fees: Single rate (6.5%), invariant holds (PASS)

No per-store `${STORE}_TX_FEES_RATE` env vars are set. `getTransactionFeesRateForStore()` returns the default 0.065 for all stores. Since fees are computed per-row (`r.revenue × rate`) and all stores share the same rate, Σ per-store = global exactly. The revenue-weighted accumulation logic in `aggregate()` is correct and would be correct for heterogeneous rates too.

### Gross Profit Tile: Correctly labeled (PASS)

`aggregate().grossProfit = revenue − spend` (analytics.ts:247). This is revenue minus **ad spend** (Meta + Google + TikTok), not revenue minus COGS. The label "רווח גולמי" accurately reflects this. The PnLBreakdown cascade's first subtraction line is ad spend → the "נשאר" running total after that step equals the KpiCards grossProfit tile — consistent.

### Fixed Costs: Flat rows invariant holds; percent-of-revenue All rows have attribution inconsistency (P1 — A2-06)

**Flat recurring rows** (fixed `monthlyCAD`): `billingForRange` charges `All`-store rows once and splits evenly across `storeNames`. For the `aggregateByStore` path, `storeNames = all 3 stores` and each bucket picks its own `byStore[store]` share → Σ per-store = global. For per-store rows, each is charged exactly once → Σ = global. **Invariant holds.**

**Percent-of-revenue `All` rows:** This is where a real inconsistency exists:

- `aggregateByStore` path: `billingForRange` is called with `storeNames = all 3 stores`, `revenue = global revenue`. Amount = `global_rev × pct/100`. Then **split evenly**: each store gets `amount / 3`. With May data (2% example): uzoshop = $651.91.
- Single-store filter path (`filters.store = 'uzoshop'`): `billingForRange` is called with `storeNames = ['uzoshop']`, `revenue = uzoshop_revenue`. Amount = `uzoshop_rev × pct/100`. With one store, the "even split" means the whole amount goes to uzoshop: $1,695.87.
- **Δ = $1,043.96** on a single 2% cost line, in the same period.

The global Σ invariant still holds (both approaches sum to $1,955.74) but the two UI views of uzoshop's P&L will show different trueNetProfit, which is confusing. The correct economic interpretation for a percent-of-revenue `All` row is **revenue-weighted** split (each store pays its proportional share), not even split.

Currently, PerStoreCards does not display `trueNetProfit` — only `grossProfit` — so this inconsistency is **not visible on any screen today**. It would become visible if per-store true-net is ever added to PerStoreCards, or if the operator compares the single-store filter view against the per-store card.

### buildPnLBreakdown: Dead code (P2 — A2-07)

`costs.ts:buildPnLBreakdown` is exported but has zero callers in `src/`. Its `transactionFees = revenue × TRANSACTION_FEES_RATE` is not per-store calibrated. No live impact.

### PnLBreakdown COGS note: Stale hardcoded "25%" (P2 — A2-08)

`PnLBreakdown.tsx:242` shows `note="הערכה: 25% מההכנסה (ממוצע היסטורי 25-26%)"`. Since all stores currently run at exactly 25%, there is no live error. However, if a store is calibrated via `${STORE}_COGS_RATE` env var, the note will misstate the effective rate. KpiCards removed its hardcoded label for the same reason (lines 192-199). The fix is to compute the effective rate from `current.cogs / current.revenue` dynamically.

### Forecast billing (P1 — A2-09, pre-existing known limitation)

`insights.ts:forecastMonthEnd` calls `billingForRange` with `revenue: projectedRev` but no `revenueByStore`. Store-specific percent-of-revenue rows in the forecast use the even-split fallback. This is acknowledged in the code comment (lines 594-596) and flagged as a P1 follow-up. Dominant operator pattern is `All`-scoped rows, so impact is limited.

---

## Verified Formulas (computed against live API)

```
aggregate().grossProfit     = revenue − totalSpend          = 56,520.39 ✓
aggregate().netProfit       = revenue − totalSpend − cogs   = 32,073.60 (legacy, not surfaced)
aggregate().trueNetProfit   = revenue − spend − cogs − txFees − fixedCosts
                            = 97,787.17 − 41,266.78 − 24,446.79 − 6,356.17 − 52.00
                            = 25,665.43
aggregate().trueMargin      = 25,665.43 / 97,787.17 = 26.25% ✓
KpiCards "רווח נטו"         = current.trueNetProfit = 25,665.43 (same object) ✓
PnLBreakdown "רווח נטו"     = finalProfit = same formula = 25,665.43 ✓
```

---

## Pass/Fail Summary

| Check | Result |
|-------|--------|
| INV-5: KpiCards.netProfit == PnLBreakdown.trueNetProfit | PASS |
| COGS rate applied once, consistently | PASS |
| Tx fees rate applied once, consistently | PASS |
| Gross Profit = revenue − ad-spend (not mislabeled) | PASS |
| trueMargin divide-by-zero protection | PASS |
| Flat fixed costs Σ per-store == global | PASS |
| Percent-of-revenue All row attribution consistency | **FAIL (P1)** — even split in aggregateByStore vs full allocation in filter path |
| buildPnLBreakdown callers | PASS (dead code — no callers) |
| PnLBreakdown COGS note accuracy | **P2** — hardcoded 25% |
| Forecast billing with store-specific percent rows | **P1** — no revenueByStore (pre-existing, documented) |
