# Wave 2 — Customer Value (Cohorts & LTV) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new "לקוחות" tab that answers "how much is a customer worth, and are we acquiring profitably?" — verdict sentence + KPIs + the v3c zones LTV curve + new-vs-old + collapsed cohort grid, backed by a full-history `customer_cohort_monthly` aggregate (Shopify Bulk + weekly refresh).

**Architecture:** Additive table `customer_cohort_monthly` seeded from Shopify Bulk (orders + amounts) joined to the existing `customer_first_order` ledger, refreshed weekly by an Inngest cron. Pure compute (`customerValue.ts`) derives retention/LTV/repeat; **profit is computed at render** via the editable COGS%. UI ports the approved v3c mockup. CAPI-safe (Shopify-only, opaque `customer.id`).

**Tech Stack:** Next.js + TS, Supabase Postgres, Inngest, Vitest (node + `vitest.config.dom.ts`).

**Spec:** `docs/superpowers/specs/2026-06-03-wave2-customer-value-design.md`
**Mockup (UI source of truth):** `docs/superpowers/mockups/2026-06-03-cohort-ltv/customer-value-v3c-zones.html`

**Conventions:** per-task LOCAL commit (NO push until all tasks + final review, then ONE push + supervised Bulk seed). Run `npx tsc --noEmit` before each commit; relevant vitest per task. Hebrew RTL UI, token-driven, WCAG-AA both themes, `<Money>`/`<Metric>` for numbers, mapping + readability + select-string guards stay green. Migrations live at repo-root `supabase/migrations/` (applied to prod is a SUPERVISED step, not in these tasks).

---

## File Structure

- `supabase/migrations/<ts>_customer_cohort_monthly.sql` — NEW table.
- `dashboard-web/src/lib/cohorts/cohortAggregate.ts` — NEW pure: bucket Bulk lines → cohort cells.
- `dashboard-web/src/lib/fetchers/shopifyBulkCohort.ts` — NEW: Bulk export incl. amounts/refunds/currency.
- `dashboard-web/scripts/backfillCohortMonthly.ts` — NEW: one-time/refresh seed runner.
- `dashboard-web/src/lib/postgresReaders.ts` — MODIFY: cohort reader + select-string.
- `dashboard-web/src/app/api/cohorts/route.ts` — NEW route.
- `dashboard-web/src/lib/home/customerValue.ts` — NEW pure compute (retention/LTV/repeat/new-vs-old).
- `dashboard-web/src/components/CustomerValueTab.tsx` (+ `CustomerValueCurve.tsx`, `CohortGridAdvanced.tsx`) — NEW UI.
- `dashboard-web/src/lib/urlState.ts`, `src/components/Sidebar.tsx`, `src/components/Dashboard.tsx` — tab wiring.
- `dashboard-web/src/inngest/functions/cronCohortRefresh.ts` — NEW weekly cron + register.
- docs: User Manual + ARCHITECTURE.

---

## Task 1: Migration — `customer_cohort_monthly`

**Files:** Create `supabase/migrations/<ts>_customer_cohort_monthly.sql` (timestamp after the latest existing migration).

- [ ] **Step 1: Write the migration**

```sql
-- Wave 2: per-cohort monthly aggregate (store × first-order-month × months-since).
-- Seeded from full Shopify history (Bulk) + weekly cron refresh. Additive only.
CREATE TABLE IF NOT EXISTS public.customer_cohort_monthly (
  store_id           TEXT    NOT NULL,
  first_order_month  TEXT    NOT NULL,            -- 'YYYY-MM'
  month_since        INT     NOT NULL,            -- 0..11
  active_customers   INT     NOT NULL DEFAULT 0,
  orders             INT     NOT NULL DEFAULT 0,
  gross_cad          NUMERIC NOT NULL DEFAULT 0,
  net_cad            NUMERIC NOT NULL DEFAULT 0,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, first_order_month, month_since)
);
CREATE INDEX IF NOT EXISTS idx_cohort_store_month
  ON public.customer_cohort_monthly (store_id, first_order_month);
```

- [ ] **Step 2: Verify SQL parses** — `cat` it; ensure no syntax errors (psql-style). (Applying to prod is a later supervised step.)
- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/*_customer_cohort_monthly.sql
git commit -m "feat(db): customer_cohort_monthly aggregate table (Wave 2 cohorts/LTV)"
```

---

## Task 2: Pure cohort aggregation

**Files:** Create `dashboard-web/src/lib/cohorts/cohortAggregate.ts`; Test `src/lib/cohorts/__tests__/cohortAggregate.test.ts`.

Input: Bulk order lines `{ orderId, createdAt, customerId|null, grossCad, netCad }` + a `firstOrderMonthByCustomer: Map<customerId,'YYYY-MM'>` (from the ledger). Output: cohort cells keyed `store|first_order_month|month_since`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { aggregateCohortCells, monthsBetween } from '@/lib/cohorts/cohortAggregate';

describe('monthsBetween', () => {
  it('counts whole calendar months, floors at 0', () => {
    expect(monthsBetween('2025-07', '2025-07')).toBe(0);
    expect(monthsBetween('2025-07', '2025-09')).toBe(2);
    expect(monthsBetween('2025-07', '2026-07')).toBe(12);
    expect(monthsBetween('2025-09', '2025-07')).toBe(0); // never negative
  });
});

describe('aggregateCohortCells', () => {
  const fom = new Map([['c1','2025-07'],['c2','2025-07'],['c3','2025-08']]);
  const lines = [
    { orderId:'1', createdAt:'2025-07-05', customerId:'c1', grossCad:100, netCad:90 }, // c1 M0
    { orderId:'2', createdAt:'2025-09-05', customerId:'c1', grossCad:50,  netCad:50 }, // c1 M2
    { orderId:'3', createdAt:'2025-07-09', customerId:'c2', grossCad:80,  netCad:80 }, // c2 M0
    { orderId:'4', createdAt:'2025-08-01', customerId:'c3', grossCad:60,  netCad:55 }, // c3 M0
    { orderId:'5', createdAt:'2025-08-15', customerId:'g',  grossCad:30,  netCad:30 }, // guest → skipped
  ];
  it('buckets by first-order-month × months-since with distinct customers', () => {
    const cells = aggregateCohortCells('uzoshop', lines, fom);
    const get = (m, ms) => cells.find(c => c.first_order_month===m && c.month_since===ms);
    expect(get('2025-07',0)).toMatchObject({ active_customers:2, orders:2, gross_cad:180, net_cad:170 });
    expect(get('2025-07',2)).toMatchObject({ active_customers:1, orders:1, net_cad:50 });
    expect(get('2025-08',0)).toMatchObject({ active_customers:1, orders:1, net_cad:55 });
    expect(cells.every(c => c.store_id==='uzoshop')).toBe(true);
    // guest order excluded
    expect(cells.reduce((s,c)=>s+c.orders,0)).toBe(4);
  });
  it('caps month_since at 11', () => {
    const lines2 = [{ orderId:'9', createdAt:'2027-09-01', customerId:'c1', grossCad:10, netCad:10 }]; // 26 months → 11
    const cells = aggregateCohortCells('uzoshop', lines2, fom);
    expect(cells[0].month_since).toBe(11);
  });
});
```

- [ ] **Step 2: Run — verify fail** — `npx vitest run src/lib/cohorts/__tests__/cohortAggregate.test.ts` → module not found.
- [ ] **Step 3: Implement**

```ts
// src/lib/cohorts/cohortAggregate.ts
export interface BulkCohortLine { orderId:string; createdAt:string; customerId:string|null; grossCad:number; netCad:number; }
export interface CohortCell { store_id:string; first_order_month:string; month_since:number; active_customers:number; orders:number; gross_cad:number; net_cad:number; }

/** Whole calendar months from a→b ('YYYY-MM'), floored at 0. */
export function monthsBetween(a:string, b:string):number {
  const [ay,am]=a.split('-').map(Number), [by,bm]=b.split('-').map(Number);
  return Math.max(0, (by-ay)*12 + (bm-am));
}

export function aggregateCohortCells(storeId:string, lines:BulkCohortLine[], firstOrderMonthByCustomer:Map<string,string>):CohortCell[] {
  const cells = new Map<string,CohortCell & {custSet:Set<string>}>();
  for (const l of lines) {
    if (!l.customerId) continue;                 // guest → unclassifiable
    const fom = firstOrderMonthByCustomer.get(l.customerId);
    if (!fom) continue;                          // no ledger entry
    const om = String(l.createdAt).slice(0,7);
    const ms = Math.min(11, monthsBetween(fom, om));
    const key = `${fom}|${ms}`;
    let c = cells.get(key);
    if (!c) { c = { store_id:storeId, first_order_month:fom, month_since:ms, active_customers:0, orders:0, gross_cad:0, net_cad:0, custSet:new Set() }; cells.set(key,c); }
    c.orders += 1; c.gross_cad += l.grossCad||0; c.net_cad += l.netCad||0; c.custSet.add(l.customerId);
  }
  return [...cells.values()].map(({custSet,...c}) => ({ ...c, active_customers: custSet.size }));
}
```

- [ ] **Step 4: Run — pass** — `npx vitest run src/lib/cohorts/__tests__/cohortAggregate.test.ts`
- [ ] **Step 5: Commit** — `git commit -m "feat(cohorts): pure cohort cell aggregation (month_since bucketing)"`

---

## Task 3: Bulk cohort fetcher (orders + amounts)

**Files:** Create `dashboard-web/src/lib/fetchers/shopifyBulkCohort.ts`; Test `src/lib/fetchers/__tests__/shopifyBulkCohort.test.ts`.

Mirror `shopifyBulkFirstOrder.ts` (read it). Extend the GraphQL Bulk query to export per order: `id, createdAt, customer{id}, currentTotalPriceSet{shopMoney{amount,currencyCode}}, totalRefundedSet{shopMoney{amount}}`. Provide `parseBulkCohortNdjson(ndjson)` → `{ orderId, createdAt, customerId, grossNative, refundNative, currency }[]`, and `startBulkCohortExport(store)` + `pollBulkCohortUrl(store)` (reuse the same Bulk polling shape).

- [ ] **Step 1: Write the failing test** (NDJSON parse only — the fetch is integration):

```ts
import { describe, it, expect } from 'vitest';
import { parseBulkCohortNdjson } from '@/lib/fetchers/shopifyBulkCohort';

const ndjson = [
  JSON.stringify({ id:'gid://shopify/Order/10', createdAt:'2025-07-05T10:00:00Z', customer:{id:'gid://shopify/Customer/1'}, currentTotalPriceSet:{shopMoney:{amount:'100.00',currencyCode:'CAD'}}, totalRefundedSet:{shopMoney:{amount:'10.00'}} }),
  JSON.stringify({ id:'gid://shopify/Order/11', createdAt:'2025-07-06T10:00:00Z', customer:null, currentTotalPriceSet:{shopMoney:{amount:'40.00',currencyCode:'CAD'}}, totalRefundedSet:{shopMoney:{amount:'0'}} }),
].join('\n');

describe('parseBulkCohortNdjson', () => {
  it('maps id/createdAt/customer + gross + refund + currency (gid tails)', () => {
    const rows = parseBulkCohortNdjson(ndjson);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ orderId:'10', createdAt:'2025-07-05T10:00:00Z', customerId:'1', grossNative:100, refundNative:10, currency:'CAD' });
    expect(rows[1].customerId).toBeNull();
  });
});
```

- [ ] **Step 2: Run — fail.** `npx vitest run src/lib/fetchers/__tests__/shopifyBulkCohort.test.ts`
- [ ] **Step 3: Implement** — port `shopifyBulkFirstOrder.ts`; add the amount/refund/currency fields to the GraphQL doc + `parseBulkCohortNdjson` (gidTail for order + customer; `Number(amount)`; currency from `currentTotalPriceSet.shopMoney.currencyCode`). Keep the privacy note (only customer.id).
- [ ] **Step 4: Run — pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(fetchers): shopifyBulkCohort — full-history orders+amounts Bulk export"`

---

## Task 4: Seed runner `backfillCohortMonthly.ts`

**Files:** Create `dashboard-web/scripts/backfillCohortMonthly.ts`. (No unit test — operator-run script; mirror `backfillFirstOrderLedger.ts` exactly for env + Supabase client + run-command header.)

- [ ] **Step 1: Implement** — for each store: (1) `startBulkCohortExport`→`pollBulkCohortUrl`→download→`parseBulkCohortNdjson`; (2) convert each line gross/net (gross−refund) to CAD via the existing `cadConvert` (FX-null → skip the line's $ but still count the order? NO — if FX fails, OMIT the line to avoid wrong CAD; log count); (3) load `firstOrderMonthByCustomer` from `customer_first_order` (SELECT store_id,customer_id,first_created_at → month); (4) `aggregateCohortCells`; (5) DELETE existing rows for the store then INSERT the cells (full replace, batched); DRY_RUN prints counts only. Include the dotted-`.env`→UPPER_SNAKE mapping header comment (copy from `backfillFirstOrderLedger.ts`).
- [ ] **Step 2: Typecheck** — `npx tsc --noEmit`
- [ ] **Step 3: Commit** — `git commit -m "feat(scripts): backfillCohortMonthly — seed cohort table from Bulk history"`

---

## Task 5: Cohort reader

**Files:** Modify `dashboard-web/src/lib/postgresReaders.ts`; Test `src/lib/__tests__/postgresReadersCohort.test.ts` (+ the existing select-string guard auto-covers it).

- [ ] **Step 1: Write the failing test** — assert `fetchCohortMonthlyFromPostgres` maps a raw row `{store_id, first_order_month, month_since, active_customers, orders, gross_cad, net_cad}` → `CohortMonthlyRow` (camelCase, numbers coerced). Use the file's existing supabase-mock pattern (read neighbors).
- [ ] **Step 2: Run — fail.**
- [ ] **Step 3: Implement** — add `CohortMonthlyRow` type + `COHORT_MONTHLY_SELECT` const (`'store_id, first_order_month, month_since, active_customers, orders, gross_cad, net_cad'`) + `fetchCohortMonthlyFromPostgres({ storeId? })` (optional store filter; order by first_order_month, month_since). Map with `toNumber` for numerics. Ensure the select-string guard test recognizes the new SELECT.
- [ ] **Step 4: Run — pass** (incl. `postgresReadersSelectStrings.test.ts`).
- [ ] **Step 5: Commit** — `git commit -m "feat(readers): cohort_monthly reader + select-string"`

---

## Task 6: `/api/cohorts` route

**Files:** Create `dashboard-web/src/app/api/cohorts/route.ts`; Test `src/app/api/__tests__/cohortsRoute.test.ts` (mirror an existing simple route test).

- [ ] **Step 1: Write the failing test** — GET returns `{ rows: CohortMonthlyRow[], lastUpdated }`; degraded path on reader error → 200 `{ rows:[], error }` (mirror `/api/orders-attribution`).
- [ ] **Step 2: Run — fail.**
- [ ] **Step 3: Implement** — copy the shape of `orders-attribution/route.ts` (no store param; `revalidate=300`; `cacheControl('ordersAttribution')` or a new cache key; `captureRouteError`). Returns all stores' rows.
- [ ] **Step 4: Run — pass + tsc.**
- [ ] **Step 5: Commit** — `git commit -m "feat(api): /api/cohorts route"`

---

## Task 7: Pure compute `customerValue.ts`

**Files:** Create `dashboard-web/src/lib/home/customerValue.ts`; Test `src/lib/home/__tests__/customerValue.test.ts`.

- [ ] **Step 1: Write the failing tests** — given `CohortMonthlyRow[]` + opts `{ storeName?, basis:'net'|'profit', cogsPctByMonth?, feesRate, spendByMonth?, blendedNcac }`:
  - `retentionByMonthSince[m]` = Σ active_customers at m / Σ M0 across cohorts (0..1).
  - `cumulativeNetPerCustomer[m]` = running Σ(net per cohort) normalized by M0 size, averaged across mature cohorts.
  - `ltv12Net` = cumulative at M11 (mature cohorts ≥12mo only).
  - `repeatRate` = customers with any m≥1 order / M0 customers.
  - `newVsOld` = recent cohorts' cumNet[0..2] vs older cohorts'.
  - profit mode: `cumulative[m] = net[m] × (1 − cogsPct − feesRate)`.
  - per-cohort `nCac` only when `spendByMonth[first_order_month]` exists; else null; headline uses `blendedNcac`.
  - `payback` = first m where cumulative profit ≥ nCac (else null).

  Write concrete fixtures + expected numbers (small, hand-computable).

- [ ] **Step 2: Run — fail.**
- [ ] **Step 3: Implement** the pure functions per the test. No spend recompute from raw totals — `spendByMonth` + `blendedNcac` are passed in (mapping-aware upstream). Export a single `computeCustomerValue(rows, opts)` returning `{ retention, cumulativeNet, cumulativeProfit, ltv12Net, ltv12Profit, repeatRate, newVsOld, blendedNcac, paybackMonths, ltvToNcac }`.
- [ ] **Step 4: Run — pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(home): customerValue pure compute (retention/LTV/repeat/payback)"`

---

## Task 8: UI — `CustomerValueTab` + zones curve + advanced grid

**Files:** Create `dashboard-web/src/components/CustomerValueTab.tsx`, `CustomerValueCurve.tsx`, `CohortGridAdvanced.tsx`; Test `src/components/__tests__/CustomerValueTab.dom.test.tsx`.

Port the approved mockup `customer-value-v3c-zones.html`: verdict sentence, 4 KPI cards (`<Money>`/`<Metric>`), the zones SVG curve (gradient + glow + amber/green zones split at payback + pulsing callout + hover tooltip; `prefers-reduced-motion` guard), new-vs-old bars, collapsed `<details>` advanced cohort grid (heatmap). Profit/revenue toggle + store selector. Token-driven, light+dark, RTL, WCAG-AA (white on-accent for the callout pill), numbers overflow-safe.

- [ ] **Step 1: Write the failing DOM tests** — with a fed `customerValue` result: renders the verdict numbers, 4 KPI cards, an SVG path (curve), the payback callout, the toggle switches profit↔revenue, the advanced `<details>` contains the grid, and a pre-May/low-data cohort shows the muted "אין נתוני הוצאה" nCAC state.
- [ ] **Step 2: Run — fail.** `npx vitest run --config vitest.config.dom.ts src/components/__tests__/CustomerValueTab.dom.test.tsx`
- [ ] **Step 3: Implement** the components (data via SWR `/api/cohorts`, sliced by store; compute via Task 7; COGS via `effectiveCogsPct`). Reuse existing primitives + tokens; no hardcoded colors.
- [ ] **Step 4: Run — pass + tsc + lint.**
- [ ] **Step 5: Commit** — `git commit -m "feat(ui): CustomerValueTab — verdict + KPIs + zones LTV curve + cohort grid"`

---

## Task 9: Tab wiring (sidebar + urlState + Dashboard)

**Files:** Modify `dashboard-web/src/lib/urlState.ts` (add `'customers'` to `TabKey`), `src/components/Sidebar.tsx` (nav item `{ key:'customers', label:'לקוחות', icon:<Users size={16}/>, slot:3 }` — import `Users` from lucide; bump later slots), `src/components/Dashboard.tsx` (render `<CustomerValueTab/>` when `activeTab==='customers'`).

- [ ] **Step 1: Write the failing test** — extend a sidebar/urlState test: `'customers'` is a valid `TabKey` and the nav item renders with label "לקוחות".
- [ ] **Step 2: Run — fail.**
- [ ] **Step 3: Implement** the three edits.
- [ ] **Step 4: Run — pass + tsc + DOM suite.**
- [ ] **Step 5: Commit** — `git commit -m "feat(nav): wire 'לקוחות' tab (sidebar + urlState + Dashboard)"`

---

## Task 10: Weekly refresh cron

**Files:** Create `dashboard-web/src/inngest/functions/cronCohortRefresh.ts`; register in the Inngest functions array (grep where cronDaily is registered for `/api/inngest`).

- [ ] **Step 1: Write the failing test** — `src/inngest/functions/__tests__/cronCohortRefresh.test.ts`: the function has the expected id + a weekly cron expr (`0 4 * * 1` Mon 04:00) and, given mocked Bulk + ledger, writes cohort cells per store (full replace). Mock the fetcher + Supabase like existing cron tests.
- [ ] **Step 2: Run — fail.**
- [ ] **Step 3: Implement** — per store: same pipeline as Task 4 (Bulk → parse → cadConvert → aggregate → DELETE+INSERT), wrapped as an Inngest cron. Reuse `aggregateCohortCells` + `shopifyBulkCohort` (DRY). Soft-fail per store so one store's Bulk error doesn't kill the others. Register the function so Inngest serves it.
- [ ] **Step 4: Run — pass + tsc.**
- [ ] **Step 5: Commit** — `git commit -m "feat(cron): weekly cron-cohort-refresh (Bulk re-aggregate)"`

---

## Task 11: Docs

**Files:** Modify `docs/ROAS-Dashboard-User-Manual.md` (new "לקוחות" tab section + version bump) + `docs/ARCHITECTURE.md` (cohort table + weekly cron + Bulk seed + the May+ nCAC constraint).

- [ ] **Step 1: Write** the UM section (how to read the verdict + curve + zones + KPIs + the "advanced grid"; note nCAC/payback only for May+ cohorts) and the ARCHITECTURE entry. Bump UM version.
- [ ] **Step 2: Commit** — `git commit -m "docs: Wave 2 customer-value tab (UM + ARCHITECTURE)"`

---

## Final (after all tasks)

- [ ] Dispatch a final code-review subagent over the whole Wave-2 diff.
- [ ] Full gates: `npx tsc --noEmit`; `npx vitest run`; `npx vitest run --config vitest.config.dom.ts`; eslint on changed files; mapping + select-string guards.
- [ ] **SUPERVISED (operator "go"):** apply the migration to prod (hide root `.env` around supabase CLI per the learned procedure); run `backfillCohortMonthly.ts` (DRY_RUN first) to seed; verify `customer_cohort_monthly` populated.
- [ ] ONE `git push origin main` (UM touched → docs-currency gate satisfied). Vercel builds; Inngest serves the new weekly cron.
- [ ] Post-deploy (prod): the "לקוחות" tab renders; numbers reconcile in scale with the NC-ROAS headline; weekly cron scheduled.
