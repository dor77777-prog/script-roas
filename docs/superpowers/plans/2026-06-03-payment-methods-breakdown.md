# Payment-Method Breakdown — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`). Implement task-by-task with spec-review + quality-review after each.

**Goal:** A dedicated **"תשלומים"** tab — per-month split of sales by gateway (credit / PayPal / other) as orders · CAD · %, business-wide + per-store. See spec `docs/superpowers/specs/2026-06-03-payment-methods-breakdown.md` + approved mockup `docs/superpowers/mockups/2026-06-03-payment-methods/payment-methods-mockup.html`.

**Architecture:** Store the raw primary gateway on `orders_attribution` (new column); classify (credit/paypal/other) in code; aggregate per month×store×category; render a dedicated panel matching the mockup. Go-forward write via the existing crons; history via a one-shot backfill.

**Tech:** Next.js+TS, Supabase, Vitest (node+dom), Shopify Orders API (`read_orders`). Existing tokens, RTL, `<Money>`, light+dark, AA.

**Hard rules:** existing tokens/primitives only (no new CSS vars / hardcoded colors); RTL logical classes; `<Money>` for every CAD; pass contrast/overflow/design-color guards; CAPI-safe (read-only); commit per task; NO push (controller pushes once at the end); migration applied to prod by the controller (not the agent).

---

## Task 1: Gateway helpers (`src/lib/payments.ts`)

**Files:** Create `src/lib/payments.ts`; Test `src/lib/__tests__/payments.test.ts`.

- [ ] **Step 1: Failing tests**
```ts
import { categorizePaymentGateway, primaryGateway } from '@/lib/payments';
describe('categorizePaymentGateway', () => {
  it('paypal variants → paypal', () => {
    for (const g of ['paypal','paypal_express','PayPal Express Checkout']) expect(categorizePaymentGateway(g)).toBe('paypal');
  });
  it('card gateways → credit', () => {
    for (const g of ['shopify_payments','stripe','bogus','Visa','mastercard']) expect(categorizePaymentGateway(g)).toBe('credit');
  });
  it('gift_card/manual/cod/null → other', () => {
    for (const g of ['gift_card','manual','Cash on Delivery (COD)',null,'']) expect(categorizePaymentGateway(g as any)).toBe('other');
  });
});
describe('primaryGateway', () => {
  it('prefers the non-gift_card/manual name', () => {
    expect(primaryGateway(['gift_card','shopify_payments'])).toBe('shopify_payments');
  });
  it('falls back to first when all are secondary', () => {
    expect(primaryGateway(['gift_card'])).toBe('gift_card');
  });
  it('empty/undefined → null', () => { expect(primaryGateway([])).toBeNull(); expect(primaryGateway(undefined)).toBeNull(); });
});
```
- [ ] **Step 2:** Run — verify fail.
- [ ] **Step 3: Implement**
```ts
export type PaymentCategory = 'credit' | 'paypal' | 'other';
const SECONDARY = /gift[_ ]?card|manual|store credit/i;
export function primaryGateway(names: string[] | undefined | null): string | null {
  if (!names || names.length === 0) return null;
  return names.find(n => !SECONDARY.test(n)) ?? names[0];
}
export function categorizePaymentGateway(raw: string | null | undefined): PaymentCategory {
  if (!raw) return 'other';
  if (/paypal/i.test(raw)) return 'paypal';
  if (/visa|master|amex|discover|card|credit|stripe|shopify_payments|bogus/i.test(raw)) return 'credit';
  return 'other';
}
```
- [ ] **Step 4:** Run — pass. **Step 5:** `git commit -m "feat(payments): gateway category + primary-gateway helpers"`

## Task 2: Migration — add the column

**Files:** Create `supabase/migrations/20260603<HHMMSS>_orders_attribution_payment_gateway.sql`.

- [ ] **Step 1:** Write:
```sql
ALTER TABLE orders_attribution ADD COLUMN IF NOT EXISTS payment_gateway TEXT;
COMMENT ON COLUMN orders_attribution.payment_gateway IS 'Raw primary Shopify payment gateway name (shopify_payments/paypal/gift_card/manual/…); categorized to credit/paypal/other in code. NULL = not yet backfilled.';
```
- [ ] **Step 2:** Confirm it parses (no apply — controller applies to prod via the documented Supabase procedure). **Step 3:** `git commit -m "migration: orders_attribution.payment_gateway column"`

## Task 3: Fetcher — request + map the gateway

**Files:** Modify `src/lib/fetchers/shopify.ts` (`fetchShopifyOrdersAttribution` ~1112 + the `ShopifyOrderRow` type + the per-order row mapping); Test `src/lib/fetchers/__tests__/shopify*.test.ts` (extend existing or add).

- [ ] **Step 1: Failing test** — given a mocked Shopify order with `payment_gateway_names: ['gift_card','paypal']`, the returned row has `paymentGateway === 'paypal'`; an order with `['shopify_payments']` → `'shopify_payments'`; missing → `null`.
- [ ] **Step 2:** Run — fail.
- [ ] **Step 3:** Add `payment_gateway_names` to the `fields` string (line ~1126). Add `paymentGateway: string | null` to `ShopifyOrderRow`. In the per-order mapping, set `paymentGateway: primaryGateway(order.payment_gateway_names)` (import from `@/lib/payments`). Keep the type for `order.payment_gateway_names?: string[]`.
- [ ] **Step 4:** Run — pass. tsc+lint. **Step 5:** `git commit -m "feat(shopify): fetch payment_gateway_names → row.paymentGateway"`

## Task 4: Persist — crons write the column

**Files:** Modify `src/inngest/functions/cronDaily.ts` + `src/inngest/functions/cronLive.ts` (the `orders_attribution` upsert); extend the existing cron tests (`cronDaily.test.ts`, `ordersAttributionDualWriteKeys.test.ts`).

- [ ] **Step 1: Failing test** — assert the upsert payload for orders_attribution includes `payment_gateway` from the row.
- [ ] **Step 2:** Run — fail.
- [ ] **Step 3:** Add `payment_gateway: row.paymentGateway ?? null` to the orders_attribution upsert object in BOTH crons. (Find the upsert by grepping `orders_attribution` in each file; match the existing column mapping shape.) Keep dual-write key parity (the `ordersAttributionDualWriteKeys` guard).
- [ ] **Step 4:** Run — pass. tsc+lint. **Step 5:** `git commit -m "feat(cron): persist payment_gateway on orders_attribution (go-forward)"`

## Task 5: Reader — aggregate per month × store × category

**Files:** Modify `src/lib/postgresReaders.ts`; Test `src/lib/__tests__/postgresReaders*.test.ts`.

- [ ] **Step 1: Failing test** — given fixture orders_attribution rows across 2 months/2 stores with mixed gateways, `readPaymentMethodsByMonth()` returns per-month per-store `{credit,paypal,other:{orders,revenueCad}}` + a business rollup; categorization matches `categorizePaymentGateway`; revenue sums `total_cad`.
- [ ] **Step 2:** Run — fail.
- [ ] **Step 3:** Implement `readPaymentMethodsByMonth(): Promise<PaymentMethodsByMonth>`. SELECT `store_id, date, total_cad, payment_gateway` from orders_attribution (or `to_char(date,'YYYY-MM')` grouping in SQL; categorization in code via the helper since it's regex-based). Build `{ months: [{ month, perStore: {storeId: {credit,paypal,other}}, business: {credit,paypal,other} }] }`. Add the result type. Follow the file's existing reader patterns + select-string test conventions (`postgresReadersSelectStrings.test.ts`).
- [ ] **Step 4:** Run — pass. **Step 5:** `git commit -m "feat(readers): readPaymentMethodsByMonth aggregation"`

## Task 6: API route

**Files:** Create `src/app/api/payment-methods/route.ts`; Test mirror an existing route test if present.

- [ ] **Step 1:** Implement a GET route returning `readPaymentMethodsByMonth()` as JSON; `export const revalidate = 60` (match orders-attribution). Behind the dashboard auth gate (no allowlist entry — internal GET).
- [ ] **Step 2:** tsc+lint; if a route-shape test pattern exists, add one. **Step 3:** `git commit -m "feat(api): /api/payment-methods route"`

## Task 7: UI — PaymentMethodsTab + new nav tab

**Files:** Create `src/components/PaymentMethodsTab.tsx`; Modify `src/components/Sidebar.tsx` (`NAV` + `TabKey`) + `src/components/Dashboard.tsx` (render on `activeTab==='payments'`); Test `src/components/__tests__/PaymentMethodsTab.dom.test.tsx`.

- [ ] **Step 1: Failing DOM test** — render `<PaymentMethodsTab>` with fixture data: asserts the scope toggle (business/per-store), the 3 gateway summary cards (credit/paypal/other with %), and a per-month row with credit/paypal/other orders+CAD; switching to per-store + picking a store changes the rendered totals; CAD rendered via `<Money>` (tabular, not clipped).
- [ ] **Step 2:** Run — fail.
- [ ] **Step 3: Implement** — `PaymentMethodsTab` per the approved mockup, built from existing primitives (`Card`, `Heading`, `TableBase` with `stickyHeader`, `Badge`, `<Money>` for all CAD, a share-bar). SWR from `/api/payment-methods`. Self-contained scope toggle (business default; per-store → store picker). Two-tier table header (credit/paypal/other × orders·CAD·% + total + per-row share bar). Colors: credit=accent token, paypal=a defined blue token (add to the chart-palette/semantic token layer if needed — token-driven, AA-safe), other=ink-subtle. Graceful state when `payment_gateway` is mostly NULL (pre-backfill): label as "אחר/לא ידוע" + a small "ממתין ל-backfill" hint. RTL logical, light+dark.
  Then: add `{ key:'payments', label:'תשלומים', icon:<CreditCard size={16}/>, slot:<after products> }` to `Sidebar.tsx` NAV; add `'payments'` to the `TabKey` union; in `Dashboard.tsx` render `<PaymentMethodsTab/>` when `activeTab==='payments'` (mirror how `customers`/`products` tabs render).
- [ ] **Step 4:** Run dom + tsc + lint. **Step 5:** `git commit -m "feat(payments): תשלומים tab + PaymentMethodsTab panel"`

## Task 8: Backfill runner

**Files:** Create `scripts/backfillPaymentGateway.ts` (model on `scripts/backfillRecentAttribution.ts`).

- [ ] **Step 1:** Implement: for each store, iterate the date range present in `orders_attribution` (or a `--from/--to` arg), call `fetchShopifyOrdersAttribution(store, date)` (now returns `paymentGateway`), and UPDATE `orders_attribution SET payment_gateway = … WHERE store_id, order_id` for rows still NULL (idempotent; skip already-set). Log progress + a per-store classified/credit/paypal/other tally. Dry-run flag. Do NOT auto-run.
- [ ] **Step 2:** tsc+lint. **Step 3:** `git commit -m "feat(scripts): backfillPaymentGateway runner (supervised)"`

## Task 9: Docs

**Files:** `docs/ROAS-Dashboard-User-Manual.md` (bump + new "תשלומים" section), `docs/ARCHITECTURE.md` (payment_gateway column + the tab + backfill).

- [ ] Bump UM (→ 2.27.0) + add a "מה התחדש" entry (new תשלומים tab: per-month credit/PayPal/other split, business+per-store). ARCHITECTURE: orders_attribution.payment_gateway, categorization helper, readPaymentMethodsByMonth, the backfill. Commit.

---

## Final (controller)
- [ ] Full gates: `cd dashboard-web && npx tsc --noEmit && npm test && npx vitest run --config vitest.config.dom.ts && npm run lint`.
- [ ] Visual self-check (chrome-devtools if local auth allows, else operator live-verify): the תשלומים tab, light+dark, business+per-store; numbers not clipped; AA.
- [ ] **Apply the migration to prod** via the documented Supabase procedure (hide root `.env`; move out the 2 gap files; `db push`; restore).
- [ ] **ONE** `git push origin main`. Verify deploy.
- [ ] **Backfill (supervised):** run `scripts/backfillPaymentGateway.ts` (dry-run first → then live), confirm tallies, confirm the תשלומים tab populates with real data on prod.

## Self-review
- Spec coverage: §4 model→T1/T2; §5 write→T3/T4/T8; §6 read→T5/T6; §7 UI→T7; §9 docs→T9. ✓
- Types: `PaymentCategory`, `paymentGateway` on row, `PaymentMethodsByMonth` consistent across T1/T3/T5/T6/T7. ✓
- No placeholders: each task has files, code/tests, commands, commit. ✓
