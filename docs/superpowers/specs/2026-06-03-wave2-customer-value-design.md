# Wave 2 — Customer Value (Cohorts & LTV) — Design Spec (2026-06-03)

**Source:** Wave 2 of the Triple-Whale-tier roadmap
(`docs/superpowers/specs/2026-06-03-triple-whale-tier-deep-research.md`). The
single tier-defining gap: customer economics over time (retention + LTV +
LTV:nCAC + payback). Unblocked by `read_customers` + the seeded
`customer_first_order` ledger (41,146 rows).

**Approved mockup:** `docs/superpowers/mockups/2026-06-03-cohort-ltv/customer-value-v3c-zones.html`
(operator picked v3c). Lead with the **answer**, not the matrix.

## Operator decisions (locked)

1. **LTV measures BOTH** — small toggle revenue↔profit, default **profit**.
2. **Cohort grid** = first-order-month × **months-since (M0..M11), 12-month horizon** (advanced/collapsed view only).
3. **Primary UX = v3c**: plain-Hebrew verdict sentence → 4 KPI cards → the **zones curve** (amber "still paying back" left / green "profit" right, split at payback, glow+gradient, hover read-out) → "new vs old cohorts" comparison → collapsed **"advanced: full cohort grid"** (no info loss).
4. **Placement:** new **"לקוחות"** tab in the sidebar.
5. **Scope:** per-store + business (selector). **FX-null:** preserve-prior. **Basis:** net (Wave-1).
6. **Profit computed at RENDER** via the editable COGS% (not baked into the table).
7. **CAPI-safe:** Shopify-only data; zero pixel/CAPI events; only opaque `customer.id` read (no PII).

## The data reality (honest constraints — surface in UI)

- **Orders history** = full (Shopify Bulk, 40k+/store) → retention + LTV can go back the full history.
- **Ad-spend history** = **May 2026 onward only** (`data_daily` rolling window). So **per-cohort nCAC / LTV:nCAC / payback exist only for May+ cohorts.** Pre-May cohorts show LTV + retention but a muted "אין נתוני הוצאה" for the acquisition-cost metrics. The **headline KPI** LTV:nCAC + payback use the **current blended nCAC** (from Wave-1 `computeNewCustomerMetrics`), which is honest and available.
- Sample numbers in the mockup are illustrative; real numbers come from the build.

## Architecture

### A. New aggregate table `customer_cohort_monthly`

```
store_id           TEXT
first_order_month  TEXT     -- 'YYYY-MM' (from customer_first_order ledger)
month_since        INT      -- 0..11 (months between order month and first_order_month; cap 11)
active_customers   INT      -- distinct customers of the cohort who ordered in that month_since
orders             INT
gross_cad          NUMERIC  -- Σ order gross (total_price) in CAD
net_cad            NUMERIC  -- Σ order net (gross − refunds) in CAD
PK (store_id, first_order_month, month_since)
```
Additive migration at repo-root `supabase/migrations/`.

### B. Full-history seed + weekly refresh (Shopify Bulk)

- **Extend the Bulk export** (`shopifyBulkFirstOrder.ts` pattern → a new `shopifyBulkCohort.ts`) to also export per order: `currentTotalPriceSet`/`totalPriceSet` (gross) + `totalRefundedSet` (refunds) + `currencyCode`. Compute per-order net = gross − refunds, convert to CAD via the existing `cadConvert` (FX-null → omit/preserve).
- **Aggregate:** join each order → its customer's `first_order_month` (ledger) → `month_since = monthsBetween(orderMonth, firstOrderMonth)` (cap 11) → sum into `(store, first_order_month, month_since)` cells. Distinct-customer count per cell for retention.
- **Seed runner:** `scripts/backfillCohortMonthly.ts` (mirrors `backfillFirstOrderLedger.ts`; DRY_RUN guard; env-mapping note for dotted `.env`). One-time + re-runnable (full replace per store).
- **Maintenance:** a **weekly** Inngest cron `cron-cohort-refresh` re-runs the Bulk aggregate per store (full replace). Cohort/LTV is a slow-moving strategic metric — weekly is fresh enough and avoids incremental double-counting. (Daily current-month freshness from `orders_attribution` is an optional later refinement, NOT in this wave.)

### C. Reader + API

- `fetchCohortMonthlyFromPostgres({ storeId? })` in `postgresReaders.ts` (SELECT-string + mapped type, covered by the select-string guard) → `CohortMonthlyRow[]`.
- New route `GET /api/cohorts` returning all stores' cohort rows (client slices by store, like `/api/orders-attribution`). 5-min cache.

### D. Pure compute layer `src/lib/home/customerValue.ts`

- `computeCustomerValue(cohortRows, opts)` → derives, per scope (business or store):
  - **retention[m]** = active_customers[m] / cohort M0 size (weighted across cohorts).
  - **cumulativeNet[m]** / **cumulativeGross[m]** per customer (the LTV curve points, M0..M11).
  - **ltv12** (net + gross) = cumulative at M11 for mature cohorts (≥12mo old), weighted.
  - **repeatRate** = share of customers with ≥1 order after M0.
  - **newVsOld** = recent-cohorts' M0..M2 cumulative vs older cohorts'.
- **Profit at render:** `profit[m] = net[m] × (1 − effectiveCogsPct − feesRate)` using `effectiveCogsPct(cogsSettings, store, month)` + the constant fees rate — same helpers as the P&L. nCAC + LTV:nCAC + payback reuse Wave-1 `computeNewCustomerMetrics` (blended) for the headline; per-cohort nCAC = `spend(first_order_month) ÷ cohort M0` only when spend exists (May+).
- Pure + unit-tested; never recomputes spend from raw account totals (mapping-aware via the same aggregates).

### E. UI — new `CustomerValueTab` (matches v3c)

- `src/components/CustomerValueTab.tsx` (+ subcomponents): verdict sentence, 4 KPI cards (`<Money>`/`<Metric>` primitives), the **zones LTV curve** (SVG: gradient fill, glow, amber/green zones split at payback, pulsing payback callout, hover tooltip — port v3c; `prefers-reduced-motion` guard), new-vs-old bars, and a collapsed `<details>` advanced cohort grid (heatmap). Profit/revenue toggle + store selector. Token-driven, light+dark, RTL, WCAG-AA (on-accent white for the callout pill), numbers overflow-safe.
- Sidebar: add `TabKey` `'customers'` + nav item `{ key:'customers', label:'לקוחות', icon:<Users size={16}/>, slot:3 }` (push the rest down). Wire in `Dashboard.tsx` tab switch + `urlState.ts`.

## Out of scope (this wave)

- No pixel/CAPI/multi-touch. No per-order refund plumbing into `orders_attribution` (the cohort table holds its own net via Bulk). No daily cohort incremental (weekly refresh only). No predictive/forecast LTV. No per-SKU margin (uses store-level COGS%). ROAS/AOV bands untouched.

## Testing & acceptance

- `tsc` clean; node + DOM vitest green; lint 0; mapping guards green; select-string guard covers the new reader.
- Unit: `computeCustomerValue` (retention, cumulative, ltv12 maturity weighting, repeat, new-vs-old, profit-at-render, per-cohort nCAC gated to spend-available months); Bulk aggregation (month_since bucketing, cap 11, guest skip, FX-null preserve); cohort table reader mapping.
- DOM: verdict renders, KPI cards, zones curve (payback split + hover), advanced grid, profit/revenue toggle, store selector, low-data/empty states (pre-May cohort → muted nCAC).
- Live (operator, post-deploy): seed runner populates `customer_cohort_monthly`; numbers reconcile in scale with the NC-ROAS headline; weekly cron refreshes.

## Affected files (for planning)

- `supabase/migrations/<ts>_customer_cohort_monthly.sql` (NEW)
- `dashboard-web/src/lib/fetchers/shopifyBulkCohort.ts` (NEW — Bulk export w/ amounts)
- `dashboard-web/scripts/backfillCohortMonthly.ts` (NEW — seed runner)
- `dashboard-web/src/inngest/functions/cronCohortRefresh.ts` (NEW — weekly) + register in the Inngest client/serve
- `dashboard-web/src/lib/postgresReaders.ts` (cohort reader + select-string)
- `dashboard-web/src/app/api/cohorts/route.ts` (NEW)
- `dashboard-web/src/lib/home/customerValue.ts` (NEW — pure compute)
- `dashboard-web/src/components/CustomerValueTab.tsx` (+ curve/grid subcomponents) (NEW)
- `dashboard-web/src/components/Sidebar.tsx`, `src/lib/urlState.ts`, `src/components/Dashboard.tsx` (tab wiring)
- docs: User Manual (new "לקוחות" tab section) + ARCHITECTURE (cohort table + weekly cron + Bulk).
