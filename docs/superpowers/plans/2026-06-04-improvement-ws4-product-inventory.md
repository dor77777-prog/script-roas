> 🚫 **DESCOPED — operator 2026-06-04. Do NOT build this workstream.** All 7 product/inventory features are out of scope for now. Plan kept for reference only if revisited.

# Product & Inventory Profit Implementation Plan
> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

Goal: Turn the Products + Customers (cohorts) tabs from "units + discount-ratio margin" into a true product-economics surface: per-product contribution **after COGS and after allocated ad spend**, real **inventory / stock-out** awareness, a standalone **product × channel** source-mix matrix, **new-product launch ramp** tracking, **first-product retention cohorts** ("which product creates repeat customers"), and **per-product replenishment cadence**.

Architecture: The dashboard is a single-operator Next.js app (App Router) reading Postgres (Supabase) through `src/lib/postgresReaders.ts` and pure compute modules under `src/lib/`. UI is token-driven React (Tailwind tokens, light+dark, Hebrew RTL). All money is CAD via the shared `<Money>` primitive. COGS is **client-recomputed** from the editable `effectiveCogsPct` (localStorage + cloud-sync), never baked into the DB. Mapping-aware spend flows through `campaignProductMap.ts` (`allocateProductRevenue`) + `productCentricView.ts` — **never** raw account totals. Cohort/cadence work joins `orders_attribution` (`line_items` JSONB + `customer_id` + `order_created_at`) to the `customer_first_order` ledger; product-dimension cohorts get a **new aggregate table** seeded by the existing Bulk pipeline.

Tech Stack: TypeScript, Next.js 15 App Router, React 18, SWR, Supabase JS, Vitest (node config `vitest.config.ts` for pure logic; jsdom config `vitest.config.dom.ts` for components), ESLint (custom `local/*` rules), Recharts (existing charts), Inngest (cron pipelines). Deploy = `git push origin main` only.

CAPI-safety (applies to EVERY task): this workstream is **reporting-only**. No task sends events to any pixel / CAPI / Triple-Pixel / Sonar; no first-touch reconstruction via pixel. The only first-party demand signal allowed anywhere is the post-purchase "how did you hear about us" survey via `note_attributes` (NOT used in this workstream). Every Feature below is marked **CAPI-safe: YES** by construction (Shopify Admin reads + internal aggregates only).

---

## File Structure

### New files
| File | Responsibility |
|---|---|
| `dashboard-web/src/lib/productProfit.ts` | Pure: per-product contribution P&L — gross/net/COGS(via effectiveCogsPct)/allocated-spend/contribution/CM%. One function `computeProductProfit`. |
| `dashboard-web/src/lib/__tests__/productProfit.test.ts` | Node tests for `computeProductProfit`. |
| `dashboard-web/src/lib/productInventory.ts` | Pure: merge catalog stock with spend-on-product → stock-out-vs-spend risk rows + thresholds. |
| `dashboard-web/src/lib/__tests__/productInventory.test.ts` | Node tests for `productInventory.ts`. |
| `dashboard-web/src/lib/productChannelMatrix.ts` | Pure: build an all-platform product × source-mix matrix from `orders_attribution` line_items (no Meta gate). |
| `dashboard-web/src/lib/__tests__/productChannelMatrix.test.ts` | Node tests for the matrix builder. |
| `dashboard-web/src/lib/productLaunch.ts` | Pure: derive per-product first-sale date + launch-window ramp + launch ROAS from `products_daily` MIN(date) + spend. |
| `dashboard-web/src/lib/__tests__/productLaunch.test.ts` | Node tests for launch tracking. |
| `dashboard-web/src/lib/cohorts/productCohortAggregate.ts` | Pure: `aggregateProductCohortCells` — first-product retention cohort cells (product × month_since). |
| `dashboard-web/src/lib/cohorts/__tests__/productCohortAggregate.test.ts` | Node tests for product-cohort aggregation. |
| `dashboard-web/src/lib/productCadence.ts` | Pure: per-product median days-between-repeat-orders from per-customer ordered timelines. |
| `dashboard-web/src/lib/__tests__/productCadence.test.ts` | Node tests for cadence. |
| `dashboard-web/src/components/ProductProfitTable.tsx` | UI: contribution-P&L columns (COGS / contribution / CM%) — extends ProductsTable visually. |
| `dashboard-web/src/components/__tests__/ProductProfitTable.dom.test.tsx` | jsdom render/contrast/Money tests. |
| `dashboard-web/src/components/ProductInventoryPanel.tsx` | UI: stock-out-vs-spend risk panel inside Products tab. |
| `dashboard-web/src/components/__tests__/ProductInventoryPanel.dom.test.tsx` | jsdom tests. |
| `dashboard-web/src/components/ProductChannelMatrix.tsx` | UI: standalone product × channel grid (new Products sub-tab). |
| `dashboard-web/src/components/__tests__/ProductChannelMatrix.dom.test.tsx` | jsdom tests. |
| `dashboard-web/src/components/ProductLaunchPanel.tsx` | UI: new-product launch ramp panel. |
| `dashboard-web/src/components/__tests__/ProductLaunchPanel.dom.test.tsx` | jsdom tests. |
| `dashboard-web/src/components/ProductCohortPanel.tsx` | UI: first-product retention cohort table (Customers tab). |
| `dashboard-web/src/components/__tests__/ProductCohortPanel.dom.test.tsx` | jsdom tests. |
| `dashboard-web/src/components/ProductCadencePanel.tsx` | UI: replenishment-cadence list (Products tab). |
| `dashboard-web/src/components/__tests__/ProductCadencePanel.dom.test.tsx` | jsdom tests. |
| `dashboard-web/src/app/api/product-cohorts/route.ts` | GET route returning `product_cohort_monthly` rows. |
| `dashboard-web/scripts/backfillProductCohortMonthly.ts` | One-time / re-runnable seed runner for `product_cohort_monthly`. |
| `supabase/migrations/20260604130000_product_cohort_monthly.sql` | New aggregate table (product × first-product-month × month_since). |
| `supabase/migrations/20260604140000_product_catalog_inventory.sql` | `ADD COLUMN IF NOT EXISTS inventory_quantity / inventory_managed` to `product_catalog`. |

### Modified files
| File | Change |
|---|---|
| `dashboard-web/src/lib/fetchers/shopify.ts` | `fetchShopifyProductsCatalog`: read `variants[].inventory_quantity` + `inventory_management`; extend `ShopifyCatalogRow`. |
| `dashboard-web/src/lib/postgresReaders.ts` | Extend `CatalogProduct` + `fetchProductCatalogFromPostgres` SELECT/map with stock; add `fetchProductsFirstSeen` (MIN date per product); add `fetchProductCohortMonthlyFromPostgres`. |
| `dashboard-web/src/lib/productCatalog.ts` | Extend `CatalogProduct` type with `inventoryQuantity` / `inventoryManaged`. |
| `dashboard-web/src/lib/cohorts/cohortAggregate.ts` | Extend `BulkCohortLine` with optional `lineItems` (back-compat) consumed by the product-cohort aggregator. |
| `dashboard-web/src/lib/fetchers/shopifyBulkCohort.ts` | Add `BULK_PRODUCT_COHORT_QUERY` + `parseBulkProductCohortNdjson` (line_items leg) — leaves the existing cohort query untouched. |
| `dashboard-web/src/components/ProductsTable.tsx` | Wire COGS settings → contribution columns (Feature 1/2). |
| `dashboard-web/src/components/Dashboard.tsx` | Add Products sub-tabs ("מטריצת ערוצים", "השקות", "מלאי", "קצב חזרה") + mount ProductCohortPanel in Customers tab; thread COGS + orders. |
| `dashboard-web/src/inngest/functions/cronCohortRefresh.ts` | Additionally refresh `product_cohort_monthly` via the new Bulk-product query (parallel step set). |
| `docs/ROAS-Dashboard-User-Manual.md` | UX docs per UI feature (pre-push docs-currency gate). |
| `docs/ARCHITECTURE.md` | Pipeline/migration/lib docs (pre-push docs-currency gate). |

### Migration apply procedure (run ONCE per migration, from repo root `/Users/dorperetz/script-roas`)
Both new migrations are **additive, nullable, `IF NOT EXISTS`** — safe to apply. The Supabase CLI parser chokes on the root `.env` (dotted keys) and on the two duplicate-timestamp gap files. Documented procedure:
```bash
# 1) hide the dotted-key .env so the CLI parser doesn't break
mv /Users/dorperetz/script-roas/.env /Users/dorperetz/script-roas/.env.hidden
# 2) move the two duplicate-timestamp gap files OUT of the migrations dir
mkdir -p /tmp/mig-gap
mv /Users/dorperetz/script-roas/supabase/migrations/20260530300000_phase_d_soak_cleanup_stale_tiktok_uzoshop_campaigns_daily.sql /tmp/mig-gap/
mv /Users/dorperetz/script-roas/supabase/migrations/20260530310000_agg_data_daily_for_date.sql /tmp/mig-gap/
# 3) push ONLY the new migrations
cd /Users/dorperetz/script-roas && supabase db push
# 4) ALWAYS restore (even on failure)
mv /tmp/mig-gap/20260530300000_phase_d_soak_cleanup_stale_tiktok_uzoshop_campaigns_daily.sql /Users/dorperetz/script-roas/supabase/migrations/
mv /tmp/mig-gap/20260530310000_agg_data_daily_for_date.sql /Users/dorperetz/script-roas/supabase/migrations/
mv /Users/dorperetz/script-roas/.env.hidden /Users/dorperetz/script-roas/.env
```
**Re-backfill note:** the inventory column is filled by the next nightly `fetchShopifyProductsCatalog` run (catalog is a full re-UPSERT each night) — no manual backfill needed, but the operator can force it via the existing "Refresh All". The `product_cohort_monthly` table needs `scripts/backfillProductCohortMonthly.ts` run once after its migration (Feature 5, Task 5.7).

---

## Feature: True per-product profitability (net of COGS + allocated ad spend) — gap `prod-profit-after-cogs-ads`
Impact: **high** · Effort: **M** · CAPI-safe: **YES** · Dependencies: none (consumes existing `effectiveCogsPct` + `allocateProductRevenue`; the editable-COGS cross-device sync bug `correctness-bugs-2026-06-02` is a separate workstream — this Feature reads `effectiveCogsPct` purely, so it is unaffected either way).

The fix: a pure module that, per product (or product×store), computes contribution = `netRevenue − COGS − allocatedAdSpend`, where COGS = `netRevenue × effectiveCogsPct(month)` and allocatedAdSpend comes from the canonical `allocateProductRevenue` campaign-spend split (NOT raw account totals). This replaces the meaning of "margin" (currently `netRevenue/grossRevenue`, a discount/refund ratio at `ProductsTable.tsx:646`).

### Task 1 — `computeProductProfit` pure core (revenue/COGS/contribution, no spend yet)
- [ ] Write failing test `dashboard-web/src/lib/__tests__/productProfit.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { computeProductProfit, type ProductProfitInput } from '@/lib/productProfit';

describe('computeProductProfit', () => {
  const base: ProductProfitInput = {
    rows: [
      { productId: 'p1', productTitle: 'Whitening Kit', storeName: 'uzoshop', month: '2026-05', units: 10, grossRevenue: 1000, netRevenue: 900 },
      { productId: 'p1', productTitle: 'Whitening Kit', storeName: 'uzoshop', month: '2026-06', units: 5,  grossRevenue: 500,  netRevenue: 480 },
      { productId: 'p2', productTitle: 'Floss',         storeName: 'uzoshop', month: '2026-06', units: 20, grossRevenue: 200,  netRevenue: 200 },
    ],
    // COGS fraction (0..1) resolved per (storeName, month) by the caller from effectiveCogsPct.
    cogsPctFor: (_store, month) => (month === '2026-05' ? 0.25 : 0.30),
    allocatedSpendByProduct: new Map([['p1', 300]]), // mapping-aware spend; p2 unmapped → 0
  };

  it('COGS uses NET revenue × per-month cogs fraction, summed across months', () => {
    const out = computeProductProfit(base);
    const p1 = out.find(r => r.productId === 'p1')!;
    // COGS = 900*0.25 + 480*0.30 = 225 + 144 = 369
    expect(p1.cogs).toBeCloseTo(369, 6);
    expect(p1.netRevenue).toBeCloseTo(1380, 6);
  });

  it('contribution = net − COGS − allocated spend; CM% = contribution / net', () => {
    const out = computeProductProfit(base);
    const p1 = out.find(r => r.productId === 'p1')!;
    // contribution = 1380 - 369 - 300 = 711 ; CM% = 711/1380
    expect(p1.contribution).toBeCloseTo(711, 6);
    expect(p1.contributionMarginPct).toBeCloseTo(711 / 1380, 6);
    const p2 = out.find(r => r.productId === 'p2')!;
    expect(p2.allocatedSpend).toBe(0); // unmapped → 0, never raw account total
  });

  it('rows sort by contribution desc', () => {
    const out = computeProductProfit(base);
    expect(out[0].productId).toBe('p1');
  });

  it('CM% is null (not NaN) when net revenue is 0', () => {
    const out = computeProductProfit({ ...base, rows: [{ productId: 'p3', productTitle: 'X', storeName: 'uzoshop', month: '2026-06', units: 0, grossRevenue: 0, netRevenue: 0 }], allocatedSpendByProduct: new Map() });
    expect(out[0].contributionMarginPct).toBeNull();
  });
});
```
- [ ] Run it, expect FAIL (module missing): `cd dashboard-web && npx vitest run src/lib/__tests__/productProfit.test.ts`
- [ ] Implement `dashboard-web/src/lib/productProfit.ts` (minimal):
```ts
/**
 * Pure per-product contribution P&L. Replaces the old discount/refund "margin"
 * (netRevenue/grossRevenue) with REAL economics:
 *   COGS         = Σ_month netRevenue_month × cogsPctFor(store, month)   (NET basis)
 *   contribution = Σ netRevenue − COGS − allocatedAdSpend
 *   CM%          = contribution / Σ netRevenue   (null when net = 0, never NaN)
 *
 * MAPPING-AWARE: allocatedAdSpend is the per-product slice from
 * allocateProductRevenue (campaignProductMap), NEVER a raw account total.
 * COGS uses the editable effectiveCogsPct (resolved per row's month by the
 * caller) so the operator's COGS edits flow through at render time.
 * CAPI-safe: Shopify-side numbers only; no pixel/CAPI emission.
 */
export interface ProductProfitRowInput {
  productId: string;
  productTitle: string;
  storeName: string;
  /** 'YYYY-MM' for cogsPctFor resolution. */
  month: string;
  units: number;
  grossRevenue: number;
  netRevenue: number;
}
export interface ProductProfitInput {
  rows: ProductProfitRowInput[];
  /** Resolve the COGS fraction (0..1) for a (store, 'YYYY-MM'). */
  cogsPctFor: (storeName: string, month: string) => number;
  /** productId → allocated ad spend (CAD) from allocateProductRevenue. */
  allocatedSpendByProduct: Map<string, number>;
}
export interface ProductProfitRow {
  productId: string;
  productTitle: string;
  storeName: string;
  units: number;
  grossRevenue: number;
  netRevenue: number;
  cogs: number;
  allocatedSpend: number;
  contribution: number;
  /** contribution / netRevenue, or null when net ≤ 0. */
  contributionMarginPct: number | null;
}

export function computeProductProfit(input: ProductProfitInput): ProductProfitRow[] {
  const { rows, cogsPctFor, allocatedSpendByProduct } = input;
  type Acc = Omit<ProductProfitRow, 'cogs' | 'allocatedSpend' | 'contribution' | 'contributionMarginPct'> & { cogs: number };
  const byProduct = new Map<string, Acc>();
  for (const r of rows) {
    let a = byProduct.get(r.productId);
    if (!a) {
      a = { productId: r.productId, productTitle: r.productTitle, storeName: r.storeName, units: 0, grossRevenue: 0, netRevenue: 0, cogs: 0 };
      byProduct.set(r.productId, a);
    }
    a.units += r.units;
    a.grossRevenue += r.grossRevenue;
    a.netRevenue += r.netRevenue;
    a.cogs += r.netRevenue * cogsPctFor(r.storeName, r.month);
  }
  const out: ProductProfitRow[] = [];
  for (const a of byProduct.values()) {
    const allocatedSpend = allocatedSpendByProduct.get(a.productId) ?? 0;
    const contribution = a.netRevenue - a.cogs - allocatedSpend;
    out.push({
      ...a,
      allocatedSpend,
      contribution,
      contributionMarginPct: a.netRevenue > 0 ? contribution / a.netRevenue : null,
    });
  }
  out.sort((x, y) => y.contribution - x.contribution);
  return out;
}
```
- [ ] Run tests, expect PASS: `cd dashboard-web && npx vitest run src/lib/__tests__/productProfit.test.ts`
- [ ] Commit: `git add dashboard-web/src/lib/productProfit.ts dashboard-web/src/lib/__tests__/productProfit.test.ts && git commit -m "feat(products): computeProductProfit — contribution after COGS + allocated spend"`

### Task 2 — `ProductProfitTable` component (token-driven, light+dark, RTL, Money)
- [ ] Write failing test `dashboard-web/src/components/__tests__/ProductProfitTable.dom.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProductProfitTable } from '@/components/ProductProfitTable';
import type { ProductProfitRow } from '@/lib/productProfit';

const rows: ProductProfitRow[] = [
  { productId: 'p1', productTitle: 'Whitening Kit', storeName: 'uzoshop', units: 15, grossRevenue: 1500, netRevenue: 1380, cogs: 369, allocatedSpend: 300, contribution: 711, contributionMarginPct: 0.515 },
  { productId: 'p2', productTitle: 'Floss', storeName: 'uzoshop', units: 20, grossRevenue: 200, netRevenue: 200, cogs: 60, allocatedSpend: 0, contribution: 140, contributionMarginPct: 0.70 },
];

describe('ProductProfitTable', () => {
  it('renders a contribution column and the product title', () => {
    render(<ProductProfitTable rows={rows} />);
    expect(screen.getByText('Whitening Kit')).toBeInTheDocument();
    // Hebrew column header for contribution.
    expect(screen.getByText('רווח תרומה')).toBeInTheDocument();
  });
  it('renders CM% and an em-dash when net is 0', () => {
    render(<ProductProfitTable rows={[{ ...rows[0], netRevenue: 0, contributionMarginPct: null }]} />);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
  it('uses no native title tooltip on numeric cells beyond Money overflow-recovery', () => {
    const { container } = render(<ProductProfitTable rows={rows} />);
    // Money may set title for compaction; assert there is at least one tabular-nums money cell.
    expect(container.querySelectorAll('.metric-num').length).toBeGreaterThan(0);
  });
});
```
- [ ] Run it, expect FAIL: `cd dashboard-web && npx vitest run --config vitest.config.dom.ts src/components/__tests__/ProductProfitTable.dom.test.tsx`
- [ ] Implement `dashboard-web/src/components/ProductProfitTable.tsx` — mirror `ProductsTable` markup conventions (`TableBase`, `Money` with `prefix="none" locale="he-IL" compactAbove={100_000}`, `HelpTooltip`, status tokens `text-status-greenFg`/`text-status-redFg`, logical `text-start`/`text-end`/`me-*`, no raw hex). Columns: מוצר · יחידות · ברוטו · נטו · עלות מוצר (COGS) · הוצ׳ פרסום (allocatedSpend) · רווח תרומה (contribution, green ≥0 / red <0) · מרג׳ תרומה (CM%, `—` when null). Use `<HelpTooltip>` (NOT native `title`) to explain "רווח תרומה = נטו − עלות מוצר − הוצאות פרסום משויכות".
- [ ] Run tests, expect PASS: `cd dashboard-web && npx vitest run --config vitest.config.dom.ts src/components/__tests__/ProductProfitTable.dom.test.tsx`
- [ ] Run lint to confirm token/RTL/tooltip guards pass: `cd dashboard-web && npx eslint src/components/ProductProfitTable.tsx`
- [ ] Commit: `git add dashboard-web/src/components/ProductProfitTable.tsx dashboard-web/src/components/__tests__/ProductProfitTable.dom.test.tsx && git commit -m "feat(products): ProductProfitTable — contribution-P&L columns (token-driven, RTL, Money)"`

### Task 3 — wire COGS + allocated spend into the Products tab (gap `prod-profit-after-cogs-ads` + `per-product-contribution-pnl` UI surface)
- [ ] Write failing DOM test `dashboard-web/src/components/__tests__/ProductsTableContribution.dom.test.tsx` asserting that when COGS settings + a campaign-product map are present in localStorage, the ProductsTable region exposes a "רווח" / contribution affordance (mock SWR + `readCogsSettings`/`readProductMap`). Use the existing pattern from `CogsSettings.dom.test.tsx`.
- [ ] Run it, expect FAIL.
- [ ] In `dashboard-web/src/components/ProductsTable.tsx`: import `readCogsSettings`, `effectiveCogsPct`, `COGS_SETTINGS_EVENT` (re-render on edit, mirror billing pattern), `readProductMap`, `allocateProductRevenue`, and `computeProductProfit`. Build `allocatedSpendByProduct` from the campaigns SWR (already fetched by `ProductCentricView`; reuse the `/api/campaigns` SWR key so SWR dedupes) + `/api/products` rows + `/api/orders-attribution` (for deterministic allocation). Render `<ProductProfitTable>` as a collapsible "רווח תרומה למוצר" section under the existing units table (do NOT delete the units table — `feedback_no_info_loss_across_tabs`). Keep the old "מרג׳ין" column but relabel its tooltip to clarify it is the discount/refund ratio, NOT profit.
- [ ] Run tests, expect PASS.
- [ ] Run full suites: `cd dashboard-web && npm run test && npm run test:components`
- [ ] Commit: `git add -A dashboard-web/src/components && git commit -m "feat(products): per-product contribution P&L wired into Products tab (COGS + mapping-aware spend)"`

### Task 4 — docs + self-check for Feature
- [ ] Update `docs/ROAS-Dashboard-User-Manual.md`: new "רווח תרומה למוצר" subsection under Products; bump version footer (e.g. 2.32.0 → 2.33.0).
- [ ] Update `docs/ARCHITECTURE.md`: add `productProfit.ts` to the lib map; note COGS-at-render + mapping-aware spend.
- [ ] Run gates: `cd dashboard-web && npx tsc --noEmit && npm run lint`
- [ ] Commit: `git commit -am "docs(products): document contribution-P&L (UM + ARCHITECTURE)"`

---

## Feature: Per-product contribution P&L for the product-centric pivot — gap `per-product-contribution-pnl`
Impact: **medium** · Effort: **M** · CAPI-safe: **YES** · Dependencies: Feature 1 (`computeProductProfit`).

`ProductCentricView.tsx` / `productCentricView.ts` report `blendedRoas = totalNetRevenue / totalCohortSpend` and have **no profit column at all**. This Feature adds a contribution column to the product-centric pivot using the same `computeProductProfit` core, so the pivot answers "after goods cost + this product's ad spend, did it actually make money?".

### Task 1 — extend `ProductCohortRow` consumers with a contribution field (pure)
- [ ] Write failing test `dashboard-web/src/lib/__tests__/productCentricContribution.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { computeProductProfit } from '@/lib/productProfit';

describe('product-centric contribution reuse', () => {
  it('contribution for a pivot row = net − COGS − cohort spend', () => {
    // The pivot already has totalNetRevenue + totalCohortSpend per product.
    const out = computeProductProfit({
      rows: [{ productId: 'p1', productTitle: 'Kit', storeName: 'uzoshop', month: '2026-06', units: 5, grossRevenue: 600, netRevenue: 600 }],
      cogsPctFor: () => 0.25,
      allocatedSpendByProduct: new Map([['p1', 200]]), // = totalCohortSpend
    });
    expect(out[0].contribution).toBeCloseTo(600 - 150 - 200, 6); // 250
    expect(out[0].contributionMarginPct).toBeCloseTo(250 / 600, 6);
  });
});
```
- [ ] Run it, expect PASS already (validates the contract — `computeProductProfit` is reused, no new pure code needed). If it fails, fix the import/contract. Command: `cd dashboard-web && npx vitest run src/lib/__tests__/productCentricContribution.test.ts`
- [ ] Commit: `git add dashboard-web/src/lib/__tests__/productCentricContribution.test.ts && git commit -m "test(products): pin pivot-contribution reuse of computeProductProfit"`

### Task 2 — add contribution column to `ProductCentricView`
- [ ] Write failing DOM test `dashboard-web/src/components/__tests__/ProductCentricViewContribution.dom.test.tsx` mocking the two SWR routes + `readCogsSettings`, asserting a "רווח תרומה" header renders next to the existing blended-ROAS column.
- [ ] Run it, expect FAIL.
- [ ] In `ProductCentricView.tsx`: import `readCogsSettings`/`effectiveCogsPct`/`computeProductProfit`; for each `ProductCohortRow`, compute contribution from `totalNetRevenue` (split by the row's months — use the products SWR rows already in scope to apportion net by month, falling back to the current month when month-detail is unavailable) + `totalCohortSpend` as the allocated spend. Render a "רווח תרומה" column (green/red token) and a "מרג׳ תרומה" CM% column. Preserve every existing column (`feedback_no_info_loss_across_tabs`).
- [ ] Run tests, expect PASS.
- [ ] Lint + commit: `cd dashboard-web && npx eslint src/components/ProductCentricView.tsx && git add -A dashboard-web/src/components && git commit -m "feat(products): contribution + CM% columns in product-centric pivot"`

### Task 3 — docs + gate
- [ ] Update UM (pivot section) + ARCHITECTURE (note pivot now carries contribution).
- [ ] `cd dashboard-web && npx tsc --noEmit && npm run lint && npm run test:components`
- [ ] Commit: `git commit -am "docs(products): pivot contribution column"`

---

## Feature: Inventory / stock-out awareness — flag spend on out-of-stock products — gap `inventory-stockout-vs-spend`
Impact: **high** · Effort: **M** · CAPI-safe: **YES** · Dependencies: none (additive migration + existing catalog fetcher + `allocateProductRevenue`). Coordinate with any other workstream touching `fetchShopifyProductsCatalog` to avoid conflicting `ShopifyCatalogRow` edits.

Today inventory never enters the pipeline: `fetchShopifyProductsCatalog` (`shopify.ts:708`) requests `variants` but reads only `variants[0].price` (lines 754-759), discarding `inventory_quantity` / `inventory_management`. `product_catalog` has no stock column. This Feature adds nullable stock columns, captures them in the nightly catalog fetch, and surfaces a panel flagging products with **ad spend running on (near-)empty stock**.

### Task 1 — migration: nullable stock columns on `product_catalog`
- [ ] Create `supabase/migrations/20260604140000_product_catalog_inventory.sql`:
```sql
-- 2026-06-04 — inventory awareness on the product catalog snapshot.
-- Additive + idempotent + NULLABLE: pre-existing rows read back NULL until the
-- next nightly fetchShopifyProductsCatalog UPSERT fills them. No backfill needed
-- (the catalog is a full re-UPSERT each night). CAPI-safe: Shopify Admin read.
ALTER TABLE public.product_catalog
  ADD COLUMN IF NOT EXISTS inventory_quantity INT;
ALTER TABLE public.product_catalog
  ADD COLUMN IF NOT EXISTS inventory_managed BOOLEAN;

COMMENT ON COLUMN public.product_catalog.inventory_quantity IS
  '2026-06-04 — Σ variant inventory_quantity across the product''s variants at fetch time. NULL when no variant manages inventory or the field is absent.';
COMMENT ON COLUMN public.product_catalog.inventory_managed IS
  '2026-06-04 — TRUE when at least one variant has inventory_management set (so 0 means real stock-out, not "untracked").';
```
- [ ] Apply via the documented migration procedure (see File Structure). Verify columns exist:
```bash
# after apply (uses the restored .env dotted keys → psql against prod)
PGURL="$(grep -E '^supabase\.db\.url=' /Users/dorperetz/script-roas/.env | cut -d= -f2-)"
psql "$PGURL" -c "\d public.product_catalog" | grep inventory
```
- [ ] Commit: `git add supabase/migrations/20260604140000_product_catalog_inventory.sql && git commit -m "feat(inventory): product_catalog stock columns (nullable, additive)"`

### Task 2 — capture inventory in the catalog fetcher
- [ ] Write failing test `dashboard-web/src/lib/fetchers/__tests__/shopifyCatalogInventory.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchShopifyProductsCatalog } from '@/lib/fetchers/shopify';

// Mock creds + fetch so the test is hermetic (mirror existing shopify fetcher tests).
vi.mock('@/lib/fetchers/shopify', async (orig) => orig()); // ensure real impl under test

describe('fetchShopifyProductsCatalog inventory', () => {
  afterEach(() => vi.restoreAllMocks());
  it('sums inventory_quantity across variants and marks managed', async () => {
    // Arrange a fetch stub returning one product with 2 variants.
    // (Use the same fetchWithBackoff/getShopifyCreds mocking strategy as the
    //  existing shopify.test.ts; assert the returned row.)
    // EXPECT: inventoryQuantity === 7, inventoryManaged === true
  });
});
```
  (Implement the stub to mirror the existing `src/lib/fetchers/__tests__/shopify*.test.ts` mocking style — mock `getShopifyCreds` + `fetchWithBackoff` to return `{ products: [{ id: 1, variants: [{ price: '10', inventory_quantity: 5, inventory_management: 'shopify' }, { price: '10', inventory_quantity: 2, inventory_management: 'shopify' }] }] }`.)
- [ ] Run it, expect FAIL: `cd dashboard-web && npx vitest run src/lib/fetchers/__tests__/shopifyCatalogInventory.test.ts`
- [ ] In `dashboard-web/src/lib/fetchers/shopify.ts`:
  - Add to `ShopifyCatalogRow` (after `vendor`): `inventoryQuantity: number | null; inventoryManaged: boolean | null;`
  - Widen the narrowed `CatalogProductPayload.variants` item type to `{ price?: string | number; inventory_quantity?: number | null; inventory_management?: string | null }`.
  - In the product loop, after `priceCad`, compute:
```ts
const variants = p.variants ?? [];
const managed = variants.some(v => v.inventory_management != null && String(v.inventory_management).trim() !== '');
const qtySum = variants.reduce((s, v) => {
  const q = typeof v.inventory_quantity === 'number' ? v.inventory_quantity : NaN;
  return Number.isFinite(q) ? s + q : s;
}, 0);
const hasAnyQty = variants.some(v => typeof v.inventory_quantity === 'number' && Number.isFinite(v.inventory_quantity));
const inventoryQuantity = hasAnyQty ? qtySum : null;
const inventoryManaged = variants.length > 0 ? managed : null;
```
  - Push `inventoryQuantity, inventoryManaged` into the row.
- [ ] Run tests, expect PASS.
- [ ] **Catalog writer wiring**: locate the catalog UPSERT (grep `product_catalog` writer in `src/inngest/functions/cronDaily.ts` and any catalog writer) and add `inventory_quantity: r.inventoryQuantity, inventory_managed: r.inventoryManaged` to the UPSERT payload. Add/extend a writer test if one exists.
- [ ] Commit: `git add -A dashboard-web/src/lib/fetchers dashboard-web/src/inngest && git commit -m "feat(inventory): capture variant inventory in nightly catalog fetch + UPSERT"`

### Task 3 — extend the catalog reader + `CatalogProduct` type
- [ ] Write failing test extending `dashboard-web/src/lib/__tests__/postgresReadersSelectStrings.test.ts` (or a new `postgresReadersCatalogInventory.test.ts`) asserting `fetchProductCatalogFromPostgres` SELECT includes `inventory_quantity, inventory_managed` and maps them.
- [ ] Run it, expect FAIL.
- [ ] In `dashboard-web/src/lib/productCatalog.ts`: add `inventoryQuantity: number | null; inventoryManaged: boolean | null;` to `CatalogProduct`.
- [ ] In `dashboard-web/src/lib/postgresReaders.ts` `fetchProductCatalogFromPostgres`: add `inventory_quantity, inventory_managed` to the `.select(...)` and map `inventoryQuantity: r.inventory_quantity == null ? null : toNumber(r.inventory_quantity)`, `inventoryManaged: r.inventory_managed == null ? null : Boolean(r.inventory_managed)`.
- [ ] Run tests, expect PASS.
- [ ] Commit: `git add -A dashboard-web/src/lib && git commit -m "feat(inventory): read stock columns into CatalogProduct"`

### Task 4 — `productInventory.ts` risk core (pure)
- [ ] Write failing test `dashboard-web/src/lib/__tests__/productInventory.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { computeInventoryRisk, type InventoryRiskInput } from '@/lib/productInventory';

const input: InventoryRiskInput = {
  catalog: [
    { productId: 'p1', productTitle: 'Kit',   inventoryQuantity: 0,  inventoryManaged: true },
    { productId: 'p2', productTitle: 'Floss', inventoryQuantity: 3,  inventoryManaged: true },
    { productId: 'p3', productTitle: 'Brush', inventoryQuantity: 50, inventoryManaged: true },
    { productId: 'p4', productTitle: 'Bag',   inventoryQuantity: null, inventoryManaged: null }, // untracked
  ],
  spendByProduct: new Map([['p1', 120], ['p2', 40], ['p3', 10], ['p4', 5]]),
  lowStockThreshold: 5,
};

describe('computeInventoryRisk', () => {
  it('flags spend on out-of-stock (qty 0, managed) as critical', () => {
    const out = computeInventoryRisk(input);
    const p1 = out.find(r => r.productId === 'p1')!;
    expect(p1.severity).toBe('out');     // qty 0 + spend > 0
    expect(p1.wastedSpend).toBe(120);
  });
  it('flags low-stock under threshold with spend as warning', () => {
    const out = computeInventoryRisk(input);
    expect(out.find(r => r.productId === 'p2')!.severity).toBe('low');
  });
  it('never flags healthy stock or untracked products', () => {
    const out = computeInventoryRisk(input);
    expect(out.find(r => r.productId === 'p3')).toBeUndefined();
    expect(out.find(r => r.productId === 'p4')).toBeUndefined(); // managed null → cannot trust 0
  });
  it('sorts by wastedSpend desc', () => {
    const out = computeInventoryRisk(input);
    expect(out[0].productId).toBe('p1');
  });
};
```
  (Note: fix the trailing `}` typo to `})` when transcribing the final `describe` close.)
- [ ] Run it, expect FAIL: `cd dashboard-web && npx vitest run src/lib/__tests__/productInventory.test.ts`
- [ ] Implement `dashboard-web/src/lib/productInventory.ts`: only consider rows where `inventoryManaged === true` (untracked → cannot trust 0). `severity = 'out'` when `qty <= 0 && spend > 0`; `'low'` when `0 < qty <= lowStockThreshold && spend > 0`; otherwise excluded. `wastedSpend = severity==='out' ? spend : 0`. Sort by `wastedSpend` desc then `spend` desc. Export `InventoryRiskInput`, `InventoryRiskRow`, `computeInventoryRisk`.
- [ ] Run tests, expect PASS.
- [ ] Commit: `git add dashboard-web/src/lib/productInventory.ts dashboard-web/src/lib/__tests__/productInventory.test.ts && git commit -m "feat(inventory): computeInventoryRisk — spend-on-empty-stock detection"`

### Task 5 — `ProductInventoryPanel` UI + Products sub-tab mount
- [ ] Write failing DOM test `dashboard-web/src/components/__tests__/ProductInventoryPanel.dom.test.tsx`: render with two risk rows; assert the out-of-stock row shows a red status token + the wasted-spend `<Money>`, and that an empty risk list shows a healthy/empty state (Hebrew).
- [ ] Run it, expect FAIL.
- [ ] Implement `dashboard-web/src/components/ProductInventoryPanel.tsx` (token-driven, light+dark, RTL, `Money`, `HelpTooltip`, status tokens). Mount it as a new Products sub-tab "מלאי" in `Dashboard.tsx` (`PRODUCTS_SUBTABS`), fetching `/api/products` (spend) + a catalog source. The panel computes `spendByProduct` from `allocateProductRevenue` (mapping-aware) over the campaigns SWR. Empty/untracked state explains that only inventory-managed products are evaluated.
- [ ] Run tests, expect PASS.
- [ ] Lint + full tests: `cd dashboard-web && npx eslint src/components/ProductInventoryPanel.tsx && npm run test && npm run test:components`
- [ ] Commit: `git add -A dashboard-web/src/components && git commit -m "feat(inventory): ProductInventoryPanel + Products 'מלאי' sub-tab"`

### Task 6 — docs + gate
- [ ] UM: "מלאי" sub-tab section. ARCHITECTURE: migration + fetcher + `productInventory.ts` notes + the inventory column re-fill note.
- [ ] `cd dashboard-web && npx tsc --noEmit && npm run lint`
- [ ] Commit: `git commit -am "docs(inventory): stock-out-vs-spend panel + pipeline"`

---

## Feature: Standalone product × channel performance matrix — gap `product-channel-matrix-standalone`
Impact: **medium** · Effort: **M** · CAPI-safe: **YES** · Dependencies: none. Reuses `orders_attribution` `line_items` + the source classification already in `analyzeProductChannel`, but **ungated** (no Meta / ≥3-orders / drawer gate) and pivoted per product.

`ProductChannelBreakdown.tsx` is locked behind a triple-gate inside `CampaignDrawer` (platform === Meta AND mapped products AND ≥3 orders). This Feature builds a top-level grid: for EACH product, the share of its actual orders' revenue by source (Meta / Google / TikTok / Direct / Other) — the Shopify-side order-source mix, not spend share.

### Task 1 — `productChannelMatrix.ts` builder (pure)
- [ ] Write failing test `dashboard-web/src/lib/__tests__/productChannelMatrix.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildProductChannelMatrix, type ProductChannelMatrixInput } from '@/lib/productChannelMatrix';

const orders = [
  { storeId: 'uzoshop', date: '2026-06-01', source: 'meta-paid',   lineItems: [{ productId: 'p1', units: 1, revenueCad: 100 }] },
  { storeId: 'uzoshop', date: '2026-06-02', source: 'google-paid', lineItems: [{ productId: 'p1', units: 1, revenueCad: 50 }] },
  { storeId: 'uzoshop', date: '2026-06-03', source: 'tiktok-paid', lineItems: [{ productId: 'p2', units: 2, revenueCad: 80 }] },
  { storeId: 'uzoshop', date: '2026-06-04', source: '',            lineItems: [{ productId: 'p1', units: 1, revenueCad: 50 }] }, // → direct
];
const input: ProductChannelMatrixInput = {
  storeId: 'uzoshop', dateFrom: '2026-06-01', dateTo: '2026-06-30',
  orders, productTitles: new Map([['p1', 'Kit'], ['p2', 'Floss']]),
};

describe('buildProductChannelMatrix', () => {
  it('splits each product revenue across exclusive source buckets', () => {
    const out = buildProductChannelMatrix(input);
    const p1 = out.find(r => r.productId === 'p1')!;
    expect(p1.totalRevenue).toBeCloseTo(200, 6);
    expect(p1.bySource.meta).toBeCloseTo(100, 6);
    expect(p1.bySource.google).toBeCloseTo(50, 6);
    expect(p1.bySource.direct).toBeCloseTo(50, 6);  // empty source → direct
    expect(p1.bySource.tiktok).toBe(0);
  });
  it('shares sum to 1 (within rounding) per product', () => {
    const out = buildProductChannelMatrix(input);
    const p1 = out.find(r => r.productId === 'p1')!;
    const sum = p1.shares.meta + p1.shares.google + p1.shares.tiktok + p1.shares.direct + p1.shares.other;
    expect(sum).toBeCloseTo(1, 6);
  });
  it('respects the date + store window and sorts by revenue desc', () => {
    const out = buildProductChannelMatrix(input);
    expect(out[0].productId).toBe('p1');
    const none = buildProductChannelMatrix({ ...input, dateFrom: '2025-01-01', dateTo: '2025-01-31' });
    expect(none.length).toBe(0);
  });
});
```
- [ ] Run it, expect FAIL: `cd dashboard-web && npx vitest run src/lib/__tests__/productChannelMatrix.test.ts`
- [ ] Implement `dashboard-web/src/lib/productChannelMatrix.ts`. Classify each order's source into 5 exclusive buckets — `meta` (`meta-paid`|`meta-organic`), `google` (`google-paid`|`google-organic`), `tiktok` (`tiktok-paid`), `direct` (`direct`|`''`), `other` (everything else). For each line item, attribute `revenueCad`/`units` to the order's bucket per product. Output one row per product with `bySource` (CAD) + `shares` (0..1, divide by product total; 0 when total ≤ 0). Window-filter on `date`/`storeId`. Sort by `totalRevenue` desc. Keep it independent of `analyzeProductChannel` (no Meta-bias counters) but document the shared classification intent in the header comment.
- [ ] Run tests, expect PASS.
- [ ] Commit: `git add dashboard-web/src/lib/productChannelMatrix.ts dashboard-web/src/lib/__tests__/productChannelMatrix.test.ts && git commit -m "feat(products): buildProductChannelMatrix — all-platform per-product source mix"`

### Task 2 — `ProductChannelMatrix` UI (segmented bars, brand colors, AA)
- [ ] Write failing DOM test `dashboard-web/src/components/__tests__/ProductChannelMatrix.dom.test.tsx`: render two matrix rows; assert product titles + a per-product 5-segment bar render, and the share legend uses Hebrew labels (פייסבוק / גוגל / טיקטוק / ישיר / אחר).
- [ ] Run it, expect FAIL.
- [ ] Implement `dashboard-web/src/components/ProductChannelMatrix.tsx`. Reuse the segmented-bar pattern from `ProductChannelBreakdown.tsx` (`CHART_COLORS.meta/google/tiktok`, neutral `bg-ink-muted`/`bg-ink-subtle` for direct/other) but render one bar per product row. Numbers via `<Money>`. RTL-safe (`dir="ltr"` only on the bar track, like the existing component). Text legibility: segment labels live on a neutral scrim line ABOVE the bar (never colored-text-on-colored-bar), matching `ProductChannelBreakdown`. Add a `<HelpTooltip>` clarifying this is the **Shopify order-source mix** (where buyers actually came from), distinct from spend share.
- [ ] Mount as a new Products sub-tab "מטריצת ערוצים" in `Dashboard.tsx`. Fetch `/api/orders-attribution` (needs `line_items`; that route already reads them) + `/api/products` for titles. Window from `filters.range`, store from `filters.store` (render a "בחר חנות" hint when `All`, mirroring `ProductCentricView`).
- [ ] Run tests, expect PASS.
- [ ] Lint + full suites: `cd dashboard-web && npx eslint src/components/ProductChannelMatrix.tsx && npm run test && npm run test:components`
- [ ] Commit: `git add -A dashboard-web/src/components && git commit -m "feat(products): standalone product × channel matrix sub-tab"`

### Task 3 — docs + gate
- [ ] UM: "מטריצת ערוצים" sub-tab section (clarify order-source mix ≠ ad spend share). ARCHITECTURE: `productChannelMatrix.ts` lib note.
- [ ] `cd dashboard-web && npx tsc --noEmit && npm run lint`
- [ ] Commit: `git commit -am "docs(products): product × channel matrix"`

---

## Feature: New-product launch tracking (first-sale date, ramp, launch ROAS) — gap `new-product-launch-tracking`
Impact: **medium** · Effort: **M** · CAPI-safe: **YES** · Dependencies: none. Derives first-sale date from `products_daily` MIN(date) per product (no schema change needed).

There is no concept of a product launch date. `ProductsTable` buckets by calendar period; `fetchProductsFromPostgres` has no first-seen notion. This Feature derives per-product `firstSeenDate = MIN(date)` from `products_daily`, classifies "new" products (first-seen within N days of today), and renders a launch-window ramp (cumulative units/revenue since launch) + launch-window ROAS (mapping-aware spend over the window).

### Task 1 — `fetchProductsFirstSeen` reader
- [ ] Write failing test extending `dashboard-web/src/lib/__tests__/postgresReadersSelectStrings.test.ts` (or new `postgresReadersFirstSeen.test.ts`) asserting `fetchProductsFirstSeen` queries `products_daily` for `product_id, date` and returns a `Map<productId, firstSeenDate>` keyed to the MIN date. (Mock `getSupabase().from(...).select(...)` like the other reader tests.)
- [ ] Run it, expect FAIL.
- [ ] In `dashboard-web/src/lib/postgresReaders.ts` add:
```ts
/**
 * 2026-06-04 — per-product first-sale date for launch tracking. MIN(date) over
 * products_daily (rows are written from a product's first day with units/revenue,
 * so MIN(date) is the launch proxy). No range filter — the full history defines
 * "first seen". CAPI-safe: Shopify-side aggregate.
 */
export async function fetchProductsFirstSeen(): Promise<Map<string, string>> {
  let data: DbRow[];
  try {
    data = await paginate<DbRow>(() =>
      getSupabase().from('products_daily').select('product_id, date'),
    );
  } catch (e) {
    throw new Error(`postgresReaders.fetchProductsFirstSeen: ${(e as Error).message}`);
  }
  const out = new Map<string, string>();
  for (const r of data) {
    const pid = String(r.product_id ?? '').trim();
    if (!pid) continue;
    const d = String(r.date);
    const cur = out.get(pid);
    if (!cur || d < cur) out.set(pid, d);
  }
  return out;
}
```
- [ ] Run tests, expect PASS.
- [ ] Commit: `git add -A dashboard-web/src/lib && git commit -m "feat(products): fetchProductsFirstSeen — MIN(date) launch proxy"`

### Task 2 — `productLaunch.ts` ramp core (pure)
- [ ] Write failing test `dashboard-web/src/lib/__tests__/productLaunch.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { computeLaunches, type LaunchInput } from '@/lib/productLaunch';

const input: LaunchInput = {
  firstSeen: new Map([['p1', '2026-05-25'], ['p2', '2026-01-10']]),
  rows: [
    { productId: 'p1', productTitle: 'Kit',   date: '2026-05-25', units: 2, netRevenue: 200 },
    { productId: 'p1', productTitle: 'Kit',   date: '2026-05-26', units: 3, netRevenue: 300 },
    { productId: 'p2', productTitle: 'Old',   date: '2026-06-01', units: 5, netRevenue: 500 },
  ],
  spendByProduct: new Map([['p1', 250]]),
  today: '2026-06-04',
  newWithinDays: 30,
};

describe('computeLaunches', () => {
  it('classifies products first-seen within newWithinDays as new launches', () => {
    const out = computeLaunches(input);
    expect(out.map(l => l.productId)).toEqual(['p1']); // p2 is 145 days old → excluded
  });
  it('computes launch-window cumulative units/revenue + launch ROAS', () => {
    const out = computeLaunches(input);
    const p1 = out[0];
    expect(p1.windowUnits).toBe(5);
    expect(p1.windowNetRevenue).toBeCloseTo(500, 6);
    expect(p1.daysSinceLaunch).toBe(10);
    expect(p1.launchRoas).toBeCloseTo(500 / 250, 6);
  });
  it('launchRoas null when no spend mapped (never raw account total)', () => {
    const out = computeLaunches({ ...input, spendByProduct: new Map() });
    expect(out[0].launchRoas).toBeNull();
  });
};
```
  (Transcribe the final `}` as `})`.)
- [ ] Run it, expect FAIL: `cd dashboard-web && npx vitest run src/lib/__tests__/productLaunch.test.ts`
- [ ] Implement `dashboard-web/src/lib/productLaunch.ts`: `daysBetween(a,b)` UTC-date diff helper; include a product when `daysBetween(firstSeen, today) <= newWithinDays`; sum its `products_daily` rows from `firstSeen` onward into `windowUnits` / `windowNetRevenue`; `launchRoas = spend>0 ? windowNetRevenue/spend : null`; expose a 0-indexed `ramp: { day: number; cumUnits: number; cumNet: number }[]` for the chart. Sort by `firstSeen` desc (newest launch first). Spend strictly from the mapping-aware `spendByProduct`.
- [ ] Run tests, expect PASS.
- [ ] Commit: `git add dashboard-web/src/lib/productLaunch.ts dashboard-web/src/lib/__tests__/productLaunch.test.ts && git commit -m "feat(products): computeLaunches — launch-window ramp + launch ROAS"`

### Task 3 — `ProductLaunchPanel` UI + sub-tab
- [ ] Write failing DOM test `dashboard-web/src/components/__tests__/ProductLaunchPanel.dom.test.tsx`: render one launch; assert "ימים מההשקה" + cumulative `<Money>` + a ramp visual render; assert empty state when no new launches.
- [ ] Run it, expect FAIL.
- [ ] Implement `dashboard-web/src/components/ProductLaunchPanel.tsx` (token-driven, light+dark, RTL, `Money`). Use the existing `Sparkline` primitive for the ramp (it draws on a neutral plot scrim per the chart-ink readability rule) — confirm import path via `grep -rl "Sparkline" src/components/ui`. Mount as Products sub-tab "השקות". Compute `spendByProduct` mapping-aware from campaigns SWR + `allocateProductRevenue`. Add a `newWithinDays` control (default 30) and a `<HelpTooltip>` noting first-seen = first day with sales (a launch proxy, not a catalog publish date).
- [ ] Run tests, expect PASS.
- [ ] Lint + full suites: `cd dashboard-web && npx eslint src/components/ProductLaunchPanel.tsx && npm run test && npm run test:components`
- [ ] Commit: `git add -A dashboard-web/src/components && git commit -m "feat(products): ProductLaunchPanel + 'השקות' sub-tab"`

### Task 4 — docs + gate
- [ ] UM: "השקות" sub-tab. ARCHITECTURE: `fetchProductsFirstSeen` + `productLaunch.ts`.
- [ ] `cd dashboard-web && npx tsc --noEmit && npm run lint`
- [ ] Commit: `git commit -am "docs(products): launch tracking"`

---

## Feature: First-product retention cohorts — "which product drives repeat customers" — gap `product-cohort-repeat-driver`
Impact: **high** · Effort: **L** · CAPI-safe: **YES** · Dependencies: own new migration + extends the Bulk cohort pipeline (Feature shares the existing `customer_first_order` ledger). Coordinate with any workstream touching `cronCohortRefresh.ts` / `shopifyBulkCohort.ts`.

Cohorts today are keyed only by `(store_id, first_order_month, month_since)`; the Bulk cohort query `BULK_COHORT_QUERY` doesn't even fetch `line_items`. This Feature adds a product dimension: each customer's **first product** (the product in their first order), then retention/repeat by that first product. The honest "% who reorder" lives per first-product.

### Task 1 — migration: `product_cohort_monthly`
- [ ] Create `supabase/migrations/20260604130000_product_cohort_monthly.sql`:
```sql
-- 2026-06-04 — first-product retention cohort aggregate.
-- (store × first_product_id × first_order_month × month_since 0..11).
-- Additive + idempotent. Seeded from full Shopify Bulk history (line_items leg)
-- joined to customer_first_order; refreshed weekly by cron-cohort-refresh.
-- CAPI-safe: Shopify Admin reads only; customer.id opaque, no PII.
CREATE TABLE IF NOT EXISTS public.product_cohort_monthly (
  store_id           TEXT    NOT NULL,
  first_product_id   TEXT    NOT NULL,
  first_product_title TEXT,
  first_order_month  TEXT    NOT NULL,            -- 'YYYY-MM'
  month_since        INT     NOT NULL,            -- 0..11
  active_customers   INT     NOT NULL DEFAULT 0,
  orders             INT     NOT NULL DEFAULT 0,
  gross_cad          NUMERIC NOT NULL DEFAULT 0,
  net_cad            NUMERIC NOT NULL DEFAULT 0,
  repeat_customers   INT,                          -- M0 row only (distinct in-window repeaters)
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, first_product_id, first_order_month, month_since)
);
CREATE INDEX IF NOT EXISTS idx_product_cohort_store_product
  ON public.product_cohort_monthly (store_id, first_product_id);

COMMENT ON TABLE public.product_cohort_monthly IS
  '2026-06-04 — first-product retention cohorts (store × first_product_id × first_order_month × month_since 0..11). Seeded from full Shopify Bulk history (line_items) joined to customer_first_order; refreshed weekly (full replace per store). Answers "which first product creates the highest-repeat customers". Guests never aggregated.';
COMMENT ON COLUMN public.product_cohort_monthly.first_product_id IS
  '2026-06-04 — the productId of the customer''s FIRST order (highest-revenue line item when the first order had several).';
COMMENT ON COLUMN public.product_cohort_monthly.repeat_customers IS
  '2026-06-04 — distinct customers of this (product, cohort) with ≥1 repeat order within the 12-month window; M0 row only (NULL elsewhere / pre-backfill). The honest repeat-rate numerator.';

-- URL-obscurity trust model (no RLS): anon reads, service_role writes — mirrors customer_cohort_monthly.
GRANT ALL ON public.product_cohort_monthly TO anon, service_role;
```
- [ ] Apply via the documented migration procedure. Verify:
```bash
PGURL="$(grep -E '^supabase\.db\.url=' /Users/dorperetz/script-roas/.env | cut -d= -f2-)"
psql "$PGURL" -c "\d public.product_cohort_monthly" | head
```
- [ ] Commit: `git add supabase/migrations/20260604130000_product_cohort_monthly.sql && git commit -m "feat(cohorts): product_cohort_monthly table (first-product retention)"`

### Task 2 — Bulk product-cohort query + parser (line_items leg)
- [ ] Write failing test `dashboard-web/src/lib/fetchers/__tests__/shopifyBulkProductCohort.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseBulkProductCohortNdjson } from '@/lib/fetchers/shopifyBulkCohort';

describe('parseBulkProductCohortNdjson', () => {
  it('parses order + nested line-item NDJSON (Bulk connection flattening)', () => {
    // Bulk exports nested edges as separate lines with __parentId.
    const ndjson = [
      JSON.stringify({ id: 'gid://shopify/Order/1', createdAt: '2026-05-01T00:00:00Z', customer: { id: 'gid://shopify/Customer/9' }, totalPriceSet: { shopMoney: { amount: '100', currencyCode: 'CAD' } }, totalRefundedSet: { shopMoney: { amount: '0' } } }),
      JSON.stringify({ id: 'gid://shopify/LineItem/11', quantity: 2, product: { id: 'gid://shopify/Product/77' }, originalTotalSet: { shopMoney: { amount: '100' } }, __parentId: 'gid://shopify/Order/1' }),
    ].join('\n');
    const rows = parseBulkProductCohortNdjson(ndjson);
    expect(rows).toHaveLength(1);
    expect(rows[0].orderId).toBe('1');
    expect(rows[0].customerId).toBe('9');
    expect(rows[0].lineItems).toEqual([{ productId: '77', units: 2, grossNative: 100 }]);
  });
  it('skips guest line-only fragments and malformed lines', () => {
    expect(parseBulkProductCohortNdjson('not-json\n')).toEqual([]);
  });
});
```
- [ ] Run it, expect FAIL: `cd dashboard-web && npx vitest run src/lib/fetchers/__tests__/shopifyBulkProductCohort.test.ts`
- [ ] In `dashboard-web/src/lib/fetchers/shopifyBulkCohort.ts` add (leaving `BULK_COHORT_QUERY` untouched):
  - `BULK_PRODUCT_COHORT_QUERY` — same orders query PLUS a nested `lineItems(first: 250) { edges { node { id quantity product { id } originalTotalSet { shopMoney { amount } } } } }`. (Bulk requires nested connections; the exporter flattens them into separate NDJSON lines with `__parentId`.)
  - `BulkProductCohortRow` type: `{ orderId; createdAt; customerId; grossNative; refundNative; currency; lineItems: { productId; units; grossNative }[] }`.
  - `parseBulkProductCohortNdjson(ndjson)` — two-pass: first index line-item fragments by `__parentId`, then build one row per order node, attaching its line items (gidTail-normalized productId, `quantity` → units, `originalTotalSet.shopMoney.amount` → grossNative). Reuse `gidTail` + `toAmount`. Skip malformed lines (try/catch per line, like `parseBulkCohortNdjson`).
- [ ] Run tests, expect PASS.
- [ ] Commit: `git add -A dashboard-web/src/lib/fetchers && git commit -m "feat(cohorts): Bulk product-cohort query + NDJSON parser (line_items leg)"`

### Task 3 — `aggregateProductCohortCells` (pure)
- [ ] Write failing test `dashboard-web/src/lib/cohorts/__tests__/productCohortAggregate.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { aggregateProductCohortCells, type ProductCohortLine } from '@/lib/cohorts/productCohortAggregate';

const fom = new Map([['c1', '2025-07'], ['c2', '2025-07']]);
// firstProduct per customer (from their first order's dominant line item).
const firstProduct = new Map([['c1', { id: 'A', title: 'Kit' }], ['c2', { id: 'B', title: 'Floss' }]]);
const lines: ProductCohortLine[] = [
  { orderId: '1', createdAt: '2025-07-05', customerId: 'c1', grossCad: 100, netCad: 90 }, // c1 M0
  { orderId: '2', createdAt: '2025-09-05', customerId: 'c1', grossCad: 50,  netCad: 50 }, // c1 M2 (repeat)
  { orderId: '3', createdAt: '2025-07-09', customerId: 'c2', grossCad: 80,  netCad: 80 }, // c2 M0
  { orderId: '4', createdAt: '2025-08-15', customerId: 'g',  grossCad: 30,  netCad: 30 }, // guest skipped
];

describe('aggregateProductCohortCells', () => {
  it('keys cells by first_product_id and folds repeat customers on M0', () => {
    const cells = aggregateProductCohortCells('uzoshop', lines, fom, firstProduct);
    const A0 = cells.find(c => c.first_product_id === 'A' && c.month_since === 0)!;
    expect(A0).toMatchObject({ active_customers: 1, orders: 1, net_cad: 90, first_product_title: 'Kit' });
    expect(A0.repeat_customers).toBe(1); // c1 reordered → product A drives repeat
    const B0 = cells.find(c => c.first_product_id === 'B' && c.month_since === 0)!;
    expect(B0.repeat_customers).toBe(0);
  });
  it('drops orders past month 11 and guests', () => {
    const cells = aggregateProductCohortCells('uzoshop', lines, fom, firstProduct);
    expect(cells.every(c => c.month_since <= 11)).toBe(true);
    expect(cells.reduce((s, c) => s + c.orders, 0)).toBe(3); // guest excluded
  });
});
```
- [ ] Run it, expect FAIL: `cd dashboard-web && npx vitest run src/lib/cohorts/__tests__/productCohortAggregate.test.ts`
- [ ] Implement `dashboard-web/src/lib/cohorts/productCohortAggregate.ts`. Mirror `aggregateCohortCells` exactly (same `monthsBetween`, same `ms > 11` drop, same M0-only `repeat_customers`, same guest/no-ledger skip) but key cells by `${fom}|${firstProductId}|${ms}` and carry `first_product_id` + `first_product_title` (from the `firstProduct` map). Customers whose first-product is unknown (not in the map) are skipped. Export `ProductCohortLine`, `ProductCohortCell`, `aggregateProductCohortCells`. Re-export `monthsBetween` from `cohortAggregate.ts` (do not duplicate).
- [ ] Run tests, expect PASS.
- [ ] Commit: `git add -A dashboard-web/src/lib/cohorts && git commit -m "feat(cohorts): aggregateProductCohortCells — first-product retention cells"`

### Task 4 — reader + API route
- [ ] Write failing test `dashboard-web/src/lib/__tests__/postgresReadersProductCohort.test.ts` asserting `fetchProductCohortMonthlyFromPostgres` SELECTs the full column list and maps to camelCase `ProductCohortMonthlyRow` (mirror `postgresReadersCohort.test.ts`).
- [ ] Run it, expect FAIL.
- [ ] In `dashboard-web/src/lib/postgresReaders.ts` add `PRODUCT_COHORT_MONTHLY_SELECT`, `ProductCohortMonthlyRow`, `fetchProductCohortMonthlyFromPostgres` — copy the `fetchCohortMonthlyFromPostgres` pattern (including `STORE_NAME_BY_ID` projection + `repeatCustomers` null handling), adding `firstProductId` / `firstProductTitle`. Order by `first_product_id, first_order_month, month_since`.
- [ ] Run tests, expect PASS.
- [ ] Create `dashboard-web/src/app/api/product-cohorts/route.ts` — copy `app/api/cohorts/route.ts` (same `revalidate = 300`, degraded-200 error path, `cacheControl('cohorts')`). Returns all stores' rows; client slices.
- [ ] Add a smoke test for the route (mirror any existing `app/api/*/route` test if present; otherwise a reader-call test is sufficient).
- [ ] Commit: `git add -A dashboard-web/src/lib dashboard-web/src/app/api/product-cohorts && git commit -m "feat(cohorts): product-cohort reader + /api/product-cohorts route"`

### Task 5 — `ProductCohortPanel` UI in the Customers tab
- [ ] Write failing DOM test `dashboard-web/src/components/__tests__/ProductCohortPanel.dom.test.tsx` (mock `/api/product-cohorts`): assert it lists first products ranked by repeat rate, shows a repeat-% per product, and renders an empty state for low data. Mirror `CustomerValueTab.dom.test.tsx` mocking.
- [ ] Run it, expect FAIL.
- [ ] Implement `dashboard-web/src/components/ProductCohortPanel.tsx`. Pure-compute the per-first-product repeat rate = `Σ M0 repeat_customers ÷ Σ M0 active_customers` (the honest distinct numerator, same `every()` fallback guard as `customerValue.ts` for pre-backfill rows). Render a ranked table: מוצר ראשון · לקוחות חדשים (M0) · % חוזרים · LTV נטו (cumulative net per customer). Token-driven, light+dark, RTL, `Money`, `HelpTooltip` ("המוצר שקנו בהזמנה הראשונה — אילו מוצרים מביאים לקוחות חוזרים"). Mount inside `CustomerValueTab` (the Customers tab) under the existing store-level cohort sections — **add, do not replace** (`feedback_no_info_loss_across_tabs`). Wire `activeTab === 'customers'` already mounts CustomerValueTab in `Dashboard.tsx`; the panel fetches its own `/api/product-cohorts` via SWR.
- [ ] Run tests, expect PASS.
- [ ] Lint + full suites: `cd dashboard-web && npx eslint src/components/ProductCohortPanel.tsx && npm run test && npm run test:components`
- [ ] Commit: `git add -A dashboard-web/src/components && git commit -m "feat(cohorts): ProductCohortPanel — which first product drives repeat customers"`

### Task 6 — wire weekly refresh into `cronCohortRefresh`
- [ ] Write failing test extending `dashboard-web/src/inngest/functions/__tests__/cronCohortRefresh.test.ts`: assert the refresh ALSO computes product-cohort cells per store and calls a `replaceProductCohortCells` dependency. (Inject the new fetch/aggregate/replace fns via the same DI seam the existing test uses.)
- [ ] Run it, expect FAIL.
- [ ] In `dashboard-web/src/inngest/functions/cronCohortRefresh.ts`: add a parallel step set per store that runs `BULK_PRODUCT_COHORT_QUERY` → download → `parseBulkProductCohortNdjson` → derive `firstProduct` per customer (dominant line item of the customer's first order) + CAD-convert lines → `aggregateProductCohortCells` → full-replace `product_cohort_monthly`. Keep each `step.run` under the 60s budget (decompose start/poll/download like the existing cohort flow). Do NOT change the existing customer-cohort steps.
- [ ] Run tests, expect PASS.
- [ ] Commit: `git add -A dashboard-web/src/inngest && git commit -m "feat(cohorts): cron-cohort-refresh also refreshes product_cohort_monthly"`

### Task 7 — backfill runner + run (supervised)
- [ ] Create `dashboard-web/scripts/backfillProductCohortMonthly.ts` — copy `scripts/backfillCohortMonthly.ts` structure (same env-export run-command header, DRY_RUN, FX-omit policy, full-replace per store) but use `BULK_PRODUCT_COHORT_QUERY` + `aggregateProductCohortCells` + the `firstProduct` derivation + `product_cohort_monthly` table.
- [ ] DRY-RUN (counts only): `DRY_RUN=1 npx tsx dashboard-web/scripts/backfillProductCohortMonthly.ts` (after exporting env per the header).
- [ ] APPLY (supervised, once): `npx tsx dashboard-web/scripts/backfillProductCohortMonthly.ts`. Verify row counts in prod via `psql`.
- [ ] Commit: `git add dashboard-web/scripts/backfillProductCohortMonthly.ts && git commit -m "feat(cohorts): product-cohort backfill runner"`

### Task 8 — docs + gate
- [ ] UM: "מוצר ראשון → חזרה" section in the Customers tab docs. ARCHITECTURE: new table, Bulk query, aggregator, reader, route, cron change, backfill.
- [ ] `cd dashboard-web && npx tsc --noEmit && npm run lint`
- [ ] Commit: `git commit -am "docs(cohorts): first-product retention cohorts"`

---

## Feature: Repeat-purchase cadence per product (days-between-orders) — gap `repeat-purchase-cadence-per-product`
Impact: **low** · Effort: **L** · CAPI-safe: **YES** · Dependencies: reuses `orders_attribution` (`customer_id` + `order_created_at` + `line_items`) via the existing `/api/orders-attribution` route. No schema change.

Retention today is store-level month-since only. This Feature computes, per product, the **median days between a customer's successive orders of that product** — a replenishment-timing signal.

### Task 1 — `productCadence.ts` core (pure)
- [ ] Write failing test `dashboard-web/src/lib/__tests__/productCadence.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { computeProductCadence, type CadenceOrder } from '@/lib/productCadence';

// Two customers, product A repurchased at known gaps.
const orders: CadenceOrder[] = [
  { customerId: 'c1', orderCreatedAt: '2026-01-01T00:00:00Z', lineItems: [{ productId: 'A', units: 1 }] },
  { customerId: 'c1', orderCreatedAt: '2026-01-31T00:00:00Z', lineItems: [{ productId: 'A', units: 1 }] }, // +30d
  { customerId: 'c2', orderCreatedAt: '2026-02-01T00:00:00Z', lineItems: [{ productId: 'A', units: 1 }] },
  { customerId: 'c2', orderCreatedAt: '2026-03-13T00:00:00Z', lineItems: [{ productId: 'A', units: 1 }] }, // +40d
  { customerId: 'c2', orderCreatedAt: '2026-03-20T00:00:00Z', lineItems: [{ productId: 'B', units: 1 }] }, // B has no repeat
];

describe('computeProductCadence', () => {
  it('median days between successive same-product orders per customer', () => {
    const out = computeProductCadence({ orders, productTitles: new Map([['A', 'Kit']]) });
    const a = out.find(r => r.productId === 'A')!;
    expect(a.medianDays).toBe(35);          // median of [30, 40]
    expect(a.repeatIntervals).toBe(2);
    expect(a.repeatCustomers).toBe(2);
  });
  it('excludes products with no repeat (need ≥1 interval)', () => {
    const out = computeProductCadence({ orders, productTitles: new Map() });
    expect(out.find(r => r.productId === 'B')).toBeUndefined();
  });
  it('ignores guests (null customerId)', () => {
    const out = computeProductCadence({
      orders: [{ customerId: null, orderCreatedAt: '2026-01-01T00:00:00Z', lineItems: [{ productId: 'A', units: 1 }] }],
      productTitles: new Map(),
    });
    expect(out).toEqual([]);
  });
};
```
  (Transcribe the final `}` as `})`.)
- [ ] Run it, expect FAIL: `cd dashboard-web && npx vitest run src/lib/__tests__/productCadence.test.ts`
- [ ] Implement `dashboard-web/src/lib/productCadence.ts`: group orders by `(productId, customerId)` (guests excluded), sort each customer's same-product order dates ascending, compute consecutive day-gaps, pool gaps per product, take the median (sorted middle; average of two middles when even). Output one row per product with `medianDays`, `repeatIntervals` (gap count), `repeatCustomers` (distinct customers with ≥1 gap), `productTitle`. Exclude products with 0 intervals. Sort by `repeatCustomers` desc then `medianDays` asc.
- [ ] Run tests, expect PASS.
- [ ] Commit: `git add dashboard-web/src/lib/productCadence.ts dashboard-web/src/lib/__tests__/productCadence.test.ts && git commit -m "feat(products): computeProductCadence — median reorder interval per product"`

### Task 2 — `ProductCadencePanel` UI + sub-tab
- [ ] Write failing DOM test `dashboard-web/src/components/__tests__/ProductCadencePanel.dom.test.tsx` (mock `/api/orders-attribution`): assert it lists products with "כל X ימים" cadence + repeat-customer counts, and an empty state when no repeats.
- [ ] Run it, expect FAIL.
- [ ] Implement `dashboard-web/src/components/ProductCadencePanel.tsx` (token-driven, light+dark, RTL, `<Money>` only where money appears — cadence is days, render via `formatNumber` + tabular-nums, never clipped). `<HelpTooltip>`: "חציון הימים בין הזמנות חוזרות של אותו מוצר — מתי לקוח ממוצע חוזר לקנות שוב". Mount as Products sub-tab "קצב חזרה". Fetch `/api/orders-attribution` (already carries `customer_id` + `order_created_at` + `line_items`) + `/api/products` for titles; window from `filters.range`, store from `filters.store`.
- [ ] Run tests, expect PASS.
- [ ] Lint + full suites: `cd dashboard-web && npx eslint src/components/ProductCadencePanel.tsx && npm run test && npm run test:components`
- [ ] Commit: `git add -A dashboard-web/src/components && git commit -m "feat(products): ProductCadencePanel + 'קצב חזרה' sub-tab"`

### Task 3 — docs + final gate
- [ ] UM: "קצב חזרה" sub-tab. ARCHITECTURE: `productCadence.ts`.
- [ ] Run ALL pre-push gates: `cd dashboard-web && npx tsc --noEmit && npm run lint && npm run test && npm run test:components`
- [ ] (Optional, if any new component sits on a colored band) run the visual a11y gate: `cd dashboard-web && npm run test:visual:axe` — only if the operator's environment has Playwright auth set up; otherwise note for operator live-verify.
- [ ] Commit: `git commit -am "docs(products): replenishment cadence"`

---

## Self-Review

**Spec coverage** — all 7 workstream gap ids have a dedicated Feature with full TDD tasks:
- `prod-profit-after-cogs-ads` → Feature 1 (`computeProductProfit` + `ProductProfitTable` + Products-tab wiring).
- `per-product-contribution-pnl` → Feature 2 (pivot contribution column; reuses the same core, so no duplicate logic — DRY).
- `inventory-stockout-vs-spend` → Feature 3 (nullable migration + catalog-fetcher inventory capture + reader + `computeInventoryRisk` + panel).
- `product-channel-matrix-standalone` → Feature 4 (`buildProductChannelMatrix`, ungated, order-source mix, new sub-tab).
- `new-product-launch-tracking` → Feature 5 (`fetchProductsFirstSeen` + `computeLaunches` + `ProductLaunchPanel`).
- `product-cohort-repeat-driver` → Feature 6 (new `product_cohort_monthly` table + Bulk line_items leg + aggregator + reader + route + panel + cron + backfill).
- `repeat-purchase-cadence-per-product` → Feature 7 (`computeProductCadence` + `ProductCadencePanel`).

**Placeholder scan** — every task carries real file paths, real function/type names taken from the codebase (`allocateProductRevenue`, `effectiveCogsPct`, `aggregateCohortCells`, `fetchProductCatalogFromPostgres`, `fetchShopifyProductsCatalog`, `parseBulkCohortNdjson`, `CHART_COLORS`, `<Money>`, `TableBase`, `HelpTooltip`, `STORE_NAME_BY_ID`), real test bodies, real run commands (`npx vitest run …`, `npm run test:components`), and real git commits. No "similar to Task N" references; the one intentional reuse (Feature 2 reusing `computeProductProfit`) is spelled out with its own pinning test. The two `describe` blocks with a trailing `}`-vs-`})` note are flagged inline so the worker fixes them.

**Type consistency** — new pure modules export explicit interfaces; UI props are typed off those exports. Money rendering always uses `<Money prefix="none" locale="he-IL" compactAbove={100_000}>` (matching `ProductsTable`). COGS is read at render via `effectiveCogsPct` (fraction 0..1) — never persisted; allocated spend always flows through `allocateProductRevenue` (mapping-aware), never raw account totals. Both migrations are `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`, nullable, additive, with the documented apply procedure and re-fill/backfill notes. Cohort readers project store_id → display name via `STORE_NAME_BY_ID` (the A1 fix), matching the existing cohort reader so the scope selector works.

**Guardrails honored** — token-only styles (no raw hex; status/`ink`/`glass` tokens), logical-direction classes, `HelpTooltip` instead of native `title`, segment-bar labels on neutral scrim (chart-ink + on-color readability), no info loss (new panels ADD, never replace existing tables), CAPI-safe by construction in every Feature.

## Open questions for the operator
1. **Editable per-product COGS**: the plan applies the **store-wide** `effectiveCogsPct` to every product (per the gap's "follow effectiveCogsPct, avoid a new migration"). Do you also want an **editable per-product COGS override** (a small client-side `productCogsPct` map mirroring `cogsSettings.ts`), or is store-wide % acceptable for v1?
2. **"New product" window**: default launch threshold is 30 days (first-sale within 30d = "new"). Is 30 right, or do you prefer 14 / 60?
3. **Low-stock threshold**: default flags managed products at `inventory_quantity ≤ 5` with active spend. What number reads as "near-empty" for your catalog?
4. **First-product definition** for the retention cohort: when a customer's first order had several line items, the plan picks the **highest-revenue** line item as the "first product". Acceptable, or should it be highest-units / first-listed?
5. **Sub-tab sprawl**: this adds 4 new Products sub-tabs (מטריצת ערוצים / השקות / מלאי / קצב חזרה) on top of טבלה / פיבוט. Keep all six as flat sub-tabs, or group some under a "מתקדם" menu?
6. **Cadence currency vs days**: cadence is reported in days only (no money). Do you also want an inferred "next reorder due" date per product (today + median cadence) as an actionable follow-up, or is the median interval enough for v1?
