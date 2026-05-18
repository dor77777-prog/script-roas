# Roadmap: ROAS Tracker

## Overview

Multi-store Shopify ROAS dashboard with deterministic per-order attribution. The roadmap below tracks the GSD-managed work. Prior work (rounds 1-5 of code review, the orders-attribution pipeline foundation) was done in ad-hoc mode before formal GSD adoption — captured retroactively as Phase 0.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

- [x] **Phase 0: Foundation (retroactive)** - Apps Script collection + Next.js dashboard + 4 rounds of code review + orders-attribution pipeline (utm_id/utm_term/utm_content matching) + 5th round (Bayesian CI + window stability + trust chip fallback + 13 fix-ups)
- [ ] **Phase 1: Channel-Level Product Attribution** - Per-product "came from Facebook" signal even without strict utm_id match; enables budget decisions based on traffic source aggregated across all campaigns

## Phase Details

### Phase 0: Foundation (retroactive)
**Status**: Complete (commits up through `1a26d29`)
**Goal**: Establish Apps Script collection + Next.js dashboard end-to-end + per-order attribution pipeline with click-id matching
**Depends on**: Nothing
**Success Criteria** (verified TRUE):
  1. 3 Shopify stores' data flows daily to Google Sheets via `runDailyUpdate`
  2. Dashboard reads all 8 sheet tabs and renders 6 tabs with 31 components
  3. `{store}-orders-attribution` populates per-order with utm_id/utm_term/utm_content
  4. `analyzeAttribution` produces 4-level trust chip with Bayesian CI + window stability + outlier detection
  5. Trust chip falls back to product-mapping heuristic when click-id is unknown
  6. 7 keys cloud-sync across devices via `dashboard-state` tab
  7. All Apps Script paths are quota-safe (1500ms inter-store sleep + 500ms inter-write sleep + safeDecode_)

### Phase 1: Channel-Level Product Attribution
**Goal**: Surface per-product channel-level signal ("X% of orders containing this product came from Facebook") that's independent of per-campaign utm_id matching. Operators can confidently raise budgets when the source signal is strong, even when their utm_id pipeline has gaps.
**Depends on**: Phase 0
**Requirements**:
  - Each Shopify order's line items (product_id + units + revenue_cad) must be captured alongside the existing per-order source classification
  - Per-product channel breakdown must be computable from the captured data (orders grouped by source, filtered to those containing mapped products)
  - The signal must surface in CampaignDrawer alongside (not replacing) the existing trust chip
**Success Criteria** (what must be TRUE):
  1. `{store}-orders-attribution` tab has a `Line Items (JSON)` column with `[{p, u, r}]` per row, populated by `runDailyUpdate` for new days and backfilled for the May 2026 range via `backfillRange`
  2. Idempotent migration: existing rows in the tab get the new column populated when re-written by a backfill; tabs from earlier days that haven't been backfilled simply have empty cells without breaking the dashboard parser
  3. Dashboard parses line items from the orders-attribution rows and exposes them on `OrderAttributionRow`
  4. A new analyzer (`analyzeProductChannel` or equivalent) returns per-source breakdown for any set of `productIds`: `{ totalOrders, totalRevenue, bySource: Record<OrderSource, {orders, revenue, units}>, facebookOrders, facebookRevenue, facebookShare }`
  5. `CampaignDrawer` surfaces a "מכירות לפי ערוץ של המוצרים המשויכים" section showing total orders + per-source breakdown + a highlighted recommendation when `facebookShare > 60%`
  6. The new signal coexists with the existing per-campaign trust chip — neither overrides the other; operator sees both in the drawer to triangulate
  7. Dashboard build (`npm run build`) passes cleanly with no new TypeScript errors or lint warnings
  8. No regressions in the existing attribution chip flow (campaign / ad-set / ad chips continue to work as before)

**Plans**: TBD (planner agent will break this into atomic tasks)

