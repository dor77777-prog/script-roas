# Wave 1 — Trust & Correctness (Design Spec, 2026-06-03)

**Source:** first wave of the Triple-Whale-tier roadmap
(`docs/superpowers/specs/2026-06-03-triple-whale-tier-deep-research.md`).
**Goal:** eliminate the revenue-basis inconsistencies that make derived metrics
silently disagree with the headline **MER**, before the Wave-2 customer-economics
layer is built on the same basis. Cheap, high-trust, no migration, no new fetch.

## Problem

- Headline **MER** uses `data_daily.revenue_cad` = **net** of refunds.
- Everything derived from `orders_attribution.total_cad` uses **gross**
  (immutable `total_price` at order creation — deliberately immutable so
  historical attribution sums don't shrink on cron re-runs; P0-2 fix 2026-05-28).
- So **NC-ROAS** revenue and the AI report's **revenue-by-source $** sit on
  gross right next to net MER (NC-ROAS reads high by the refund rate), and
  per-store **AOV** mixes bases _within one metric_ (net revenue ÷ gross
  order-count), which can wrongly flip the locked AOV color band on a refund day.

## Operator decisions (locked)

1. **NC-ROAS revenue basis** → **net via blended refund-rate** (scale gross
   new-customer revenue by the store/period net÷gross ratio). Label
   "net (refund-adj)". NOT per-order refunds (that's a Wave-2 option if
   cohort-LTV needs exact per-order net).
2. **AOV basis** → **gross ÷ orders** (standard "average order value at
   checkout"; stable on refund days).
3. **NC-ROAS confidence gate** → **two-stage**: unclassifiable share `>20%` →
   "low confidence" badge; `>40%` → suppress the ratio ("not enough data").

## Key facts that shape the approach

- `data_daily` **already** has `gross_revenue_cad`, `revenue_cad` (net), and
  `refund_deduction_cad`. So the blended net-adj factor is already in our data —
  **no migration, no new fetch.**
- The blended net-adj factor is **uniform per store/period**. Therefore:
  - **NC-ROAS** (new-revenue ÷ spend) — absolute revenue → **must** be re-based.
  - **revenue-by-source $** (absolute) — **should** be re-based (or labeled).
  - **coverage %** (revenue-with-signal ÷ total-revenue) — a ratio of two
    revenues → the factor **cancels** → **unchanged, no fix needed.** (This
    refines the research note that "coverage sits on gross": its % is
    basis-invariant; only absolute $ matters.)
- The current agg (`filtered.curAgg` / `cur`) carries net `revenue`, `spend`,
  `cogs`, `roas` but **not** `grossRevenue`. The factor needs gross, so the
  data_daily aggregation must also sum `gross_revenue_cad` into the agg.

## Design

### A. Net revenue basis (P0)

1. **Extend the data_daily aggregation** (the function that builds
   `curAgg`/`cur` from data_daily rows) to also sum `gross_revenue_cad` into a
   new agg field `grossRevenue: number`. Keep `revenue` (net) as-is.
2. **New pure helper** `netAdjustFactor(net: number, gross: number): { factor: number; degraded: boolean }`
   in `src/lib/home/` (e.g. `revenueBasis.ts`):
   - `gross > 0 && net >= 0` → `{ factor: net / gross, degraded: false }`.
   - `gross <= 0` or null/NaN → `{ factor: 1, degraded: true }` (no adjustment;
     surface nothing misleading). Clamp factor to `[0, 1.5]` as a sanity guard.
3. **`computeNewCustomerMetrics`** (`src/lib/home/newCustomerMetrics.ts`): accept
   the factor (or net+gross) and apply it to `ncRevenue` before computing
   `ncRoas`. Signature extends additively; `nCac` (spend ÷ new-orders) and
   `ncOrders` are **count-based → unchanged**. Update both call sites
   (`Dashboard.tsx:825`, `storeDetail.ts:251`).
4. **AI report revenue-by-source** (`aiReport.ts:~638`): apply the same factor to
   the per-source `revenue` totals (absolute $). The deterministic **coverage %**
   computed there is a ratio → leave its math untouched (factor cancels).
5. **Labels:** wherever these net-adj numbers render (NC-ROAS tile in
   `CommandCenterHero`, NC row in `StoreDetailModal`, AI report), add a short
   "net (refund-adj)" qualifier + a `HelpTooltip` explaining it's gross order
   value reduced by the store's blended refund rate so it reconciles to MER.

### B. AOV = gross ÷ orders (P1)

- `src/lib/home/storeDetail.ts:157` currently `aov = cur.revenue (net) / orders`.
  Change to **gross ÷ orders using a single consistent source/timing**:
  preferred = `Σ orders_attribution.total_cad ÷ count(orders_attribution rows)`
  for the store/period (one source for numerator AND denominator, removing the
  net÷gross AND any timing mix). If the full per-store order rows aren't already
  in scope there, fall back to `cur.grossRevenue ÷ orders` (gross from the agg ÷
  the same order count the tile already shows) — the plan picks the cleanest
  available, but the invariant is: **numerator and denominator share one
  basis + source + timing.**
- The locked AOV bands ($>70 green ▴ / $50–70 neutral / $<50 red ▾) are
  **unchanged** — only the input becomes consistent.

### C. NC-ROAS confidence gate (P1)

- `computeNewCustomerMetrics` returns a new field
  `confidence: 'ok' | 'low' | 'suppressed'` derived from `unclassifiableShare`:
  `>0.40 → 'suppressed'`, `>0.20 → 'low'`, else `'ok'`. (Thresholds as named
  constants.)
- **UI** (`CommandCenterHero` NC tile + `StoreDetailModal` NC row):
  - `low` → render NC-ROAS with a small "ביטחון נמוך" badge + tooltip naming the
    unclassifiable share.
  - `suppressed` → hide the ratio; show "לא מספיק דאטה לסיווג" + the share.
  - `ok` → unchanged.
- Prod is **0 NULL** today, so this is forward-protection; default state = `ok`.

### D. Hermetic guards

- Extend `npm run audit:reconcile` to assert NC-ROAS revenue uses the net-adj
  basis (e.g. NC revenue ≤ gross and factor applied) so a future regression to
  gross is caught.
- **Unit tests:** `netAdjustFactor` (normal, gross=0, null/NaN, clamp);
  `computeNewCustomerMetrics` net-adj math + `confidence` thresholds (0.2/0.4
  boundaries); gross-AOV calc + band stability across a refund day.
- **DOM tests:** the `low` badge appears at >20%; the `suppressed` state hides
  the ratio at >40%; the "net (refund-adj)" label renders. Must pass the
  existing readability/token guards.

## Out of scope (by decision)

- No DB migration, no new Shopify/ad fetch (reuse existing `data_daily` columns).
- No per-order refund plumbing (Wave-2 option only if cohort-LTV needs exact
  per-order net).
- `total_cad` stays immutable gross. ROAS bands + AOV bands unchanged. VAT=0.
- No re-basing of MER itself (already net). No removal of the signed-row
  machinery (it's live + tested; per-campaign ROAS stays gross-of-refunds, just
  labeled in a later wave if desired).

## Testing & acceptance

- `tsc` clean; node + DOM vitest green; lint 0; mapping guards green;
  `audit:reconcile` green with the new assertion.
- Manual (prod URLs only): NC-ROAS magnitude drops by ~the refund rate and now
  reconciles in scale with MER; AOV stable across a known refund day; gate
  states reachable with a synthetic high-unclassifiable input.

## Affected files (for planning)

- `src/lib/home/newCustomerMetrics.ts` (net-adj + confidence)
- `src/lib/home/revenueBasis.ts` (NEW — `netAdjustFactor`)
- data_daily aggregation builder (add `grossRevenue`) — likely `src/lib/home/adapters.ts` and/or the agg used by `Dashboard.tsx`
- `src/lib/home/storeDetail.ts` (AOV + pass factor)
- `src/components/Dashboard.tsx` (call site + pass gross/net)
- `src/components/home/CommandCenterHero.tsx`, `StoreDetailModal.tsx` (labels + gate states)
- `src/lib/aiReport.ts` (revenue-by-source $ net-adj)
- `audit:reconcile` script + tests
