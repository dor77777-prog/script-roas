# Payment-Method Breakdown — Design Spec (2026-06-03)

## 1. Goal
A dedicated **"תשלומים" (Payments)** tab showing, per month, the split of sales by payment gateway — **credit card vs PayPal vs other** — as **order count · revenue (CAD) · % share**, **business-wide and per-store**. Pure reporting (reads Shopify order data we already have access to); CAPI-safe (no events sent).

## 2. Operator-locked decisions
- **Metric:** order count + revenue (CAD) + % (per gateway, per month). % computed on order count.
- **Placement:** a NEW top-level tab **"תשלומים"** (its own room to grow — e.g. real per-gateway processing fees later).
- **Scope:** business-wide (default) + per-store, via a self-contained scope toggle in the panel (business / per-store + store picker) — matches the approved mockup.
- **Mockup APPROVED:** `docs/superpowers/mockups/2026-06-03-payment-methods/payment-methods-mockup.html` (light+dark, business+per-store, two-tier table, share bars). Build to match it, in the existing graphic language (MonthlyTables chrome + mesh/glass tokens).

## 3. Data source & availability
- Shopify exposes the gateway on every order: REST `payment_gateway_names` (array, e.g. `["shopify_payments"]`, `["paypal"]`, `["gift_card","shopify_payments"]`), GraphQL `paymentGatewayNames`. Covered by **`read_orders`** (already granted) — **NOT** blocked by the `read_customers` gap that blocks NC-ROAS.
- **Not stored today.** `orders_attribution` (the per-order table, PK `store_id,order_id`, all stores) stores totals/date/attribution/line_items/first-order flags — but no gateway. The fetcher `fetchShopifyOrdersAttribution` (`src/lib/fetchers/shopify.ts:1112`) requests `id,total_price,financial_status,test,landing_site,referring_site,note_attributes,source_name,line_items,customer,created_at` — no gateway field.

## 4. Data model
- **Migration:** `ALTER TABLE orders_attribution ADD COLUMN payment_gateway TEXT;` — stores the order's **raw primary gateway name** (e.g. `shopify_payments`, `paypal`, `gift_card`, `manual`). Keep raw (not a pre-bucketed category) so categorization stays adjustable + future per-gateway fee work is possible. NULL = unknown/not-yet-backfilled.
- **Primary-gateway rule** (an order can list multiple): pick the gateway of the **largest-amount sale transaction** if transactions are available; else the **first** name in `payment_gateway_names` that is not `gift_card`/`manual` (those are usually a secondary tender), else the first name. Store that single raw string. Documented in the helper.
- **Categorization helper** `categorizePaymentGateway(raw: string | null): 'credit' | 'paypal' | 'other'` (`src/lib/payments.ts`):
  - `paypal*` (paypal, paypal_express, "PayPal Express Checkout") → **paypal**
  - card gateways → **credit**: `shopify_payments`, `stripe`, `bogus` (test), and any name matching card brands / "credit"/"card" (`/visa|master|amex|card|credit|stripe|shopify_payments|bogus/i`)
  - everything else (`gift_card`, `manual`, `cash on delivery (cod)`, `bank_deposit`, NULL) → **other**
- **Revenue:** sum `orders_attribution.total_cad` (already FX-converted to CAD; no FX work). % = orders in category ÷ total orders that month/scope.

## 5. Write paths
- **Go-forward (automatic):** add `payment_gateway_names` to the fetcher `fields`; map each order → `ShopifyOrderRow.paymentGateway` (primary rule). The crons that persist `orders_attribution` (`cronDaily.ts`, `cronLive.ts`) include `payment_gateway` in the upsert. New orders get classified automatically.
- **Backfill (history):** `scripts/backfillPaymentGateway.ts` (modeled on `scripts/backfillRecentAttribution.ts`) — re-fetch the historical orders already in `orders_attribution` from Shopify, set `payment_gateway`. Runs once after deploy (supervised — Shopify API load + prod-DB write). Depth = whatever order history Shopify returns (same depth we already have attribution for; `read_orders`, no `read_customers` needed).

## 6. Read path & API
- **Reader** (`src/lib/postgresReaders.ts`): `readPaymentMethodsByMonth()` → aggregates `orders_attribution` grouped by `month (date_trunc), store_id, category` → `{ month, store, credit:{orders,revenueCad}, paypal:{...}, other:{...} }`, plus a business-wide rollup. Categorization applied in code from the raw `payment_gateway`. Respects the campaign↔store mapping is N/A here (orders are already per-store via `store_id`).
- **Route** `src/app/api/payment-methods/route.ts` (GET, behind the dashboard auth gate — NOT externally called, so no allowlist entry). `revalidate` aligned with other order reads (~60s).

## 7. UI
- **New tab** `payments` — add to `Sidebar.tsx` `NAV` (`{ key:'payments', label:'תשלומים', icon:<CreditCard/>, slot }`), extend the `TabKey` type, render `<PaymentMethodsTab>` in `Dashboard.tsx` when `activeTab==='payments'`.
- **`PaymentMethodsTab.tsx`** — the dedicated panel from the mockup: header + scope toggle (business / per-store + store picker, self-contained) + summary strip (per-period totals + share bar + 3 gateway cards) + the two-tier per-month table (credit/paypal/other × orders·CAD·% + total + per-row share bar) + a "מספרים מ-Shopify" note. Built from existing primitives (`Card`, `Heading`, `TableBase`, `Badge`, `<Money>` for all CAD, `Sparkline`/bar). Tokens-only, RTL logical, light+dark, AA, numbers via `<Money>` (never clip). Share-bar colors via chart-palette/semantic tokens (credit=accent, paypal=a defined blue token, other=ink-subtle) with AA-safe usage.
- **Empty/partial state:** before backfill, months with NULL gateway show under "אחר/לא ידוע" or a "ממתין ל-backfill" hint — must degrade gracefully (no crash, honest labeling).

## 8. Out of scope (now)
- Real per-gateway processing fees (replacing the blended ~6.5% assumption) — a strong follow-up the raw gateway data unlocks, but separate.
- Sub-gateway detail (card brands), refunds-by-gateway.

## 9. Guards / constraints
Existing tokens only; RTL logical classes; `<Money>` for CAD; light+dark AA; pass contrast/overflow/design-color guards; preserve all existing behavior; migration applied to prod via the documented Supabase procedure; deploy via one `git push`; backfill is a supervised post-deploy step.
