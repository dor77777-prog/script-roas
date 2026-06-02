# Plan B — New-vs-returning → NC-ROAS / nCAC (Phase 3)

## Goal
Add a **first-order-EVER** new-vs-returning classification to `orders_attribution` and surface two new decision metrics — **NC-ROAS** (new-customer revenue ÷ MER spend) and **nCAC** (MER spend ÷ new-customer orders) — business-wide in `CommandCenterHero` as a SUBORDINATE banded tile (its own band, "different question" Hebrew label, NOT the hero band gradient) and per-store in `StoreDetailModal`. All sourcing is pure-Shopify (one extra field on the daily attribution fetch + a one-time Bulk-Operations backfill). Per-store Home cards + gradients stay UNTOUCHED.

## Architecture
- **Forward path:** the attribution fetch (`fetchShopifyOrdersAttribution`, `shopify.ts:1011`) already pulls every order daily; we add `customer` + `created_at` to its field allowlist (`shopify.ts:1019`, NOT the revenue/refund allowlist at `:404`) and carry `customerId` + `createdAt` on `ShopifyOrderRow`/`ShopifyOrderPayload`.
- **Storage:** additive migration on `orders_attribution` adds `customer_id TEXT`, `order_created_at TIMESTAMPTZ`, `is_first_order BOOLEAN` (all nullable) + index `(store_id, customer_id)`. Both cron upsert maps (`cronDaily.ts:1419`, `cronLive.ts:682`) write `customer_id` + `order_created_at`.
- **Flagging:** idempotent SQL RPC `recompute_first_order_flags(p_store_id)` sets `is_first_order = (order_created_at == MIN(order_created_at) per (store_id, customer_id))` over the FULL per-store history (unfiltered), NULL where `customer_id` is NULL, deterministic `order_id` tiebreak. Called at the end of `runDailyForStore` and the cron-live persist step.
- **Backfill:** one-time Shopify Bulk Operations GraphQL helper exporting `{order.id, createdAt, customer.id}` per store → NDJSON → MIN(createdAt) per customer → set `is_first_order` in bulk.
- **Read path:** `postgresReaders.ts:1051` SELECT + row map read the 3 new columns into `OrderAttributionRow` (`ordersAttribution.ts:31`).
- **Compute + surface:** a pure adapter computes NC-ROAS / nCAC + unclassifiable share from `OrderAttributionRow[]` + the mapping-aware MER spend (`agg.spend`); the hero renders a subordinate tile; `StoreDetailModal` renders a per-store row.

## Tech Stack
- Next.js 15 / React 19 / TypeScript, Inngest cron functions, Supabase (Postgres + RPC), `@supabase/supabase-js`.
- Tests: **Node (pure)** `npx vitest run <path>` (config `vitest.config.ts`, env node); **DOM** `npx vitest run --config vitest.config.dom.ts <path>` (jsdom + `@testing-library/jest-dom`). Type-check `npx tsc --noEmit`. Test files import `{ describe, it, expect, vi }` from `'vitest'` (globals:false). **cwd for all commands = `/Users/dorperetz/script-roas/dashboard-web`.**
- UI: `<Money>` / `<Metric>` primitives, on-band/scrim tokens (2026-06-01 readability standard), `lucide-react`, `useRoasBandGradient`.
- Migrations live at **repo root** `/Users/dorperetz/script-roas/supabase/migrations/` (timestamp `YYYYMMDDHHMMSS_*.sql`; latest is `20260601120000_realtime_activity_feed.sql`).

**For agentic workers:** Execute via `superpowers:subagent-driven-development`. Work the tasks **in order**; each is a closed red→green→commit loop. Use REAL test code and REAL impl from this doc — do not abbreviate or cross-reference between tasks. Check off each box as you complete it.

### LOCKED CONSTRAINTS (must hold in EVERY task)
- **READ-ONLY toward ad platforms.** Zero `fbq`/`gtag`/`ttq`/`_fbq`/`snaptr`. New paths write only to our Supabase (or Shopify cart attributes read back from `note_attributes` — not used in this plan). Never touch CAPI/`event_id` dedup.
- **Per-store Home cards + ROAS-band gradients UNTOUCHED.** ROAS bands locked `<2x` red / `2–2.7x` orange / `3x` green target. VAT=0. No break-even/CM metric.
- **PRESERVE the campaign↔store↔product mapping** incl. the TikTok shared-account per-campaign override. Per-store numbers consume mapping-aware aggregates (`agg.spend`), never raw account totals. These suites MUST stay green: `campaignStoreMap*.test`, `tiktokFetcherStoreMapping.test`, `productCentricViewSumConservation.test`, `cannibalizationDetection.test`, `campaignProductMap.test`, `campaignsAggregator.test`.
- **Privacy:** store only Shopify `customer_id` (opaque numeric) — never name/email/phone. `maskCustomerLabel` (`lib/webhooks/normalizeShopifyEvent.ts`) stays.
- **One source of truth (MER)** + at most one added lens. No model-zoo selector.

---

## Files touched

| Path | Create/Modify | Purpose |
|---|---|---|
| `src/lib/fetchers/shopify.ts` | Modify (`:209` type, `:793` type, `:1019` allowlist, `:1060` push loop) | Add `customer`+`created_at` to attribution fetch; carry `customerId`+`createdAt` on row/payload |
| `src/lib/__tests__/shopifyOrdersAttributionCustomer.test.ts` | Create | TDD for the fetcher change |
| `/Users/dorperetz/script-roas/supabase/migrations/20260602120000_orders_attribution_first_order.sql` | Create | Additive cols + index |
| `/Users/dorperetz/script-roas/supabase/migrations/20260602130000_recompute_first_order_flags.sql` | Create | Idempotent RPC |
| `src/inngest/functions/cronDaily.ts` | Modify (`:1419` upsert map, end of `runDailyForStore`) | Dual-write `customer_id`+`order_created_at`; call RPC |
| `src/inngest/functions/cronLive.ts` | Modify (`:682` upsert map, `:707` after upsert) | Dual-write `customer_id`+`order_created_at`; call RPC |
| `src/inngest/functions/__tests__/cronDailyFirstOrder.test.ts` | Create | Dual-write key-set + RPC-call guard |
| `src/lib/ordersAttribution.ts` | Modify (`:31` type) | Add `customerId`/`orderCreatedAt`/`isFirstOrder` to `OrderAttributionRow` |
| `src/lib/postgresReaders.ts` | Modify (`:1051` SELECT, `:1074` row map) | Read 3 new columns |
| `src/lib/__tests__/postgresReadersFirstOrder.test.ts` | Create | Reader SELECT-string + row-map TDD |
| `src/lib/fetchers/shopifyBulkFirstOrder.ts` | Create | Bulk-Operations backfill helper (GraphQL + poll + parse) |
| `src/lib/fetchers/__tests__/shopifyBulkFirstOrder.test.ts` | Create | Backfill helper TDD |
| `src/lib/home/newCustomerMetrics.ts` | Create | Pure NC-ROAS / nCAC / unclassifiable adapter |
| `src/lib/home/__tests__/newCustomerMetrics.test.ts` | Create | Adapter TDD |
| `src/components/home/CommandCenterHero.tsx` | Modify (props + new subordinate tile JSX) | Render the NC-ROAS / nCAC subordinate tile |
| `src/components/home/__tests__/CommandCenterHero.dom.test.tsx` | Modify (append) | DOM TDD for the subordinate tile |
| `src/lib/home/storeDetail.ts` | Modify (`StoreDetailData` + `toStoreDetail`) | Carry per-store NC-ROAS / nCAC |
| `src/lib/home/__tests__/storeDetail.test.ts` | Modify (append) or Create | Adapter TDD for the per-store fields |
| `src/components/home/StoreDetailModal.tsx` | Modify (new per-store row) | Render per-store NC-ROAS / nCAC |
| `src/components/home/__tests__/StoreDetailModal.dom.test.tsx` | Modify (append) | DOM TDD |

---

## Task 1 — Attribution fetch carries `customerId` + `createdAt`

**Files**
- Modify: `src/lib/fetchers/shopify.ts:209` (`ShopifyOrderRow`), `:793` (`ShopifyOrderPayload`), `:1019` (field allowlist), `:1060` (push loop).
- Test: `src/lib/__tests__/shopifyOrdersAttributionCustomer.test.ts` (Create).

### Step 1.1 — Write the failing test
Create `src/lib/__tests__/shopifyOrdersAttributionCustomer.test.ts`:

```ts
/**
 * Phase 3 — fetchShopifyOrdersAttribution must carry customer + created_at.
 *
 * The ATTRIBUTION fetch (shopify.ts:1011) already pulls every order daily;
 * Phase 3 adds `customer` (read o.customer?.id → customerId) and `created_at`
 * (read o.created_at → createdAt) to the field allowlist (shopify.ts:1019,
 * NOT the revenue/refund allowlist at :404). Guest checkouts have no
 * customer object → customerId must be null (NOT '').
 *
 * Privacy: only the opaque numeric customer.id is read — never name/email.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchShopifyOrdersAttribution } from '@/lib/fetchers/shopify';

vi.mock('@/lib/fetchers/shopifyAuth', () => ({
  getShopifyAccessToken: vi.fn().mockResolvedValue('shpat_TESTTOKEN'),
}));

const originalFetch = global.fetch;

beforeEach(() => {
  vi.resetModules();
  process.env.UZOSHOP_SHOPIFY_DOMAIN = 'test.myshopify.com';
});

afterEach(() => {
  global.fetch = originalFetch;
  delete process.env.UZOSHOP_SHOPIFY_DOMAIN;
});

function mockOrdersResponse(orders: unknown[]): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ orders }),
    headers: { get: (_: string) => null },
  } as unknown as Response;
}

const ORDER_WITH_CUSTOMER = {
  id: 'order-100',
  total_price: '80.00',
  current_total_price: '80.00',
  financial_status: 'paid',
  test: false,
  created_at: '2026-05-01T09:30:00-04:00',
  customer: { id: 778899 },
  note_attributes: [],
  source_name: 'web',
  line_items: [{ product_id: 'p-1', quantity: 1, price: '80.00' }],
};

const GUEST_ORDER = {
  id: 'order-200',
  total_price: '40.00',
  current_total_price: '40.00',
  financial_status: 'paid',
  test: false,
  created_at: '2026-05-01T11:00:00-04:00',
  // no `customer` key — guest checkout
  note_attributes: [],
  source_name: 'web',
  line_items: [{ product_id: 'p-2', quantity: 1, price: '40.00' }],
};

describe('fetchShopifyOrdersAttribution — customer + created_at', () => {
  it('requests customer,created_at in the field allowlist', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(mockOrdersResponse([ORDER_WITH_CUSTOMER]));
    global.fetch = fetchSpy as unknown as typeof fetch;

    await fetchShopifyOrdersAttribution('uzoshop', '2026-05-01');

    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toContain('customer');
    expect(url).toContain('created_at');
  });

  it('maps o.customer.id → customerId and o.created_at → createdAt', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(mockOrdersResponse([ORDER_WITH_CUSTOMER])) as unknown as typeof fetch;

    const rows = await fetchShopifyOrdersAttribution('uzoshop', '2026-05-01');

    expect(rows).toHaveLength(1);
    expect(rows[0].customerId).toBe('778899');
    expect(rows[0].createdAt).toBe('2026-05-01T09:30:00-04:00');
  });

  it('guest checkout (no customer object) → customerId null, createdAt preserved', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(mockOrdersResponse([GUEST_ORDER])) as unknown as typeof fetch;

    const rows = await fetchShopifyOrdersAttribution('uzoshop', '2026-05-01');

    expect(rows).toHaveLength(1);
    expect(rows[0].customerId).toBeNull();
    expect(rows[0].createdAt).toBe('2026-05-01T11:00:00-04:00');
  });
});
```

### Step 1.2 — Run (expect FAIL)
```
npx vitest run src/lib/__tests__/shopifyOrdersAttributionCustomer.test.ts
```
Expect FAIL: `rows[0].customerId` / `createdAt` are `undefined`; the URL has no `customer`/`created_at`.

### Step 1.3 — Minimal impl
In `src/lib/fetchers/shopify.ts`, extend `ShopifyOrderRow` (`:209`) — add two fields after `lineItems`:

```ts
  lineItems: Array<{ p: string; u: number; r: number }> | null;
  /** Phase 3 — Shopify opaque numeric customer id (string), null on guest
   *  checkout. Privacy: ONLY the id is captured — never name/email/phone. */
  customerId: string | null;
  /** Phase 3 — order creation timestamp (Shopify `created_at`, ISO-8601 with
   *  offset). Drives the first-order-EVER MIN() in recompute_first_order_flags. */
  createdAt: string | null;
};
```

Extend `ShopifyOrderPayload` (`:793`) — add inside the type literal (after `source_name`):

```ts
  created_at?: string;
  customer?: { id?: number | string | null } | null;
```

Extend the attribution field allowlist (`:1019`) — add `customer,created_at`:

```ts
  const fields =
    'id,total_price,financial_status,test,landing_site,referring_site,' +
    'note_attributes,source_name,line_items,customer,created_at';
```

Extend the push loop (`:1060`, inside `out.push({ ... })`) — add after `lineItems`:

```ts
        lineItems: computeLineItemsCad(o, totalCad),
        customerId:
          o.customer?.id != null ? String(o.customer.id) : null,
        createdAt: o.created_at ? String(o.created_at) : null,
      });
```

### Step 1.4 — Run (expect PASS)
```
npx vitest run src/lib/__tests__/shopifyOrdersAttributionCustomer.test.ts
npx vitest run src/lib/__tests__/shopifyOrdersAttributionTotalPrice.test.ts
npx tsc --noEmit
```
All PASS (the existing total-price test must still pass — its fixtures simply leave the new fields null/undefined-safe).

### Step 1.5 — Commit
```
git add src/lib/fetchers/shopify.ts src/lib/__tests__/shopifyOrdersAttributionCustomer.test.ts
git commit -m "feat(attribution): carry customerId + createdAt on ShopifyOrderRow

Add customer,created_at to the attribution fetch allowlist (NOT the
revenue/refund allowlist). Read-only; only the opaque numeric customer.id
is captured (privacy). Guest checkout → customerId null.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2 — Additive migration: 3 columns + index

**Files**
- Create: `/Users/dorperetz/script-roas/supabase/migrations/20260602120000_orders_attribution_first_order.sql`
- Test: none (DDL; verified by the dual-write key-set test in Task 4 + manual `supabase db push`).

### Step 2.1 — Write the migration
Create the file with EXACTLY:

```sql
-- Phase 3 (2026-06-02) — new-vs-returning support on orders_attribution.
--
-- Additive + idempotent. Three nullable columns + one index. No backfill
-- here (the one-time Bulk-Operations job + the recompute RPC own the
-- is_first_order values). Existing rows get NULLs until the next cron tick
-- writes customer_id / order_created_at and the RPC sets is_first_order.
--
--   customer_id       — Shopify opaque numeric id as TEXT (privacy: no PII).
--                       NULL on guest checkout → unclassifiable share.
--   order_created_at  — Shopify created_at (immutable), used by the
--                       first-order-EVER MIN() window.
--   is_first_order    — set by recompute_first_order_flags(); NULL where
--                       customer_id is NULL (unclassifiable).
--
-- Index (store_id, customer_id) backs the per-(store,customer) MIN() window
-- and per-store reader scans. Per-store identity only — no cross-store key.

ALTER TABLE orders_attribution
  ADD COLUMN IF NOT EXISTS customer_id      TEXT,
  ADD COLUMN IF NOT EXISTS order_created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_first_order   BOOLEAN;

CREATE INDEX IF NOT EXISTS idx_orders_attribution_store_customer
  ON orders_attribution (store_id, customer_id);

COMMENT ON COLUMN orders_attribution.customer_id IS
  'Phase 3 — Shopify opaque numeric customer id (TEXT). NULL on guest checkout. Privacy: no PII.';
COMMENT ON COLUMN orders_attribution.order_created_at IS
  'Phase 3 — Shopify created_at (immutable); drives first-order-EVER MIN() window.';
COMMENT ON COLUMN orders_attribution.is_first_order IS
  'Phase 3 — TRUE when this is the customer''s first order EVER for the store; NULL when customer_id NULL. Set by recompute_first_order_flags().';
```

### Step 2.2 — Verify SQL parses (lint-only, no live DB write in this task)
```
npx tsc --noEmit
```
(No TS change; this confirms the repo still type-checks. The migration is applied to prod by the operator in the manual-verification step, NOT by an agent.)

### Step 2.3 — Commit
```
git add /Users/dorperetz/script-roas/supabase/migrations/20260602120000_orders_attribution_first_order.sql
git commit -m "feat(db): additive orders_attribution first-order columns + index

customer_id TEXT, order_created_at TIMESTAMPTZ, is_first_order BOOLEAN
(all nullable) + index (store_id, customer_id). Idempotent (IF NOT EXISTS).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3 — Idempotent RPC `recompute_first_order_flags(p_store_id)`

**Files**
- Create: `/Users/dorperetz/script-roas/supabase/migrations/20260602130000_recompute_first_order_flags.sql`
- Test: none (DDL; behavior is asserted indirectly by Task 4's RPC-call guard and exercised live in manual verification).

### Step 3.1 — Write the migration
Create the file with EXACTLY:

```sql
-- Phase 3 (2026-06-02) — first-order-EVER flagging RPC.
--
-- Idempotent. For ONE store, recompute is_first_order over the FULL per-store
-- history (UNFILTERED by date — "first ever" is a lifetime property, so a
-- new order can demote a previously-flagged later order). Definition:
--
--   is_first_order = (order_created_at = MIN(order_created_at)
--                       OVER (PARTITION BY store_id, customer_id))
--
-- Deterministic order_id tiebreak: when two orders share the exact MIN
-- timestamp for a customer, the lexicographically-smallest order_id wins —
-- so exactly ONE row per (store, customer) is TRUE regardless of tie order.
--
-- NULL where customer_id IS NULL (guest checkout → unclassifiable; never
-- silently "returning").
--
-- Called from:
--   • cronDaily.ts runDailyForStore (after orders_attribution UPSERT)
--   • cronLive.ts persist step (after today's orders_attribution UPSERT)
-- Safe to run repeatedly — it fully recomputes the boolean each call.

CREATE OR REPLACE FUNCTION public.recompute_first_order_flags(p_store_id text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  WITH ranked AS (
    SELECT
      store_id,
      order_id,
      ROW_NUMBER() OVER (
        PARTITION BY store_id, customer_id
        ORDER BY order_created_at ASC NULLS LAST, order_id ASC
      ) AS rn
    FROM orders_attribution
    WHERE store_id = p_store_id
      AND customer_id IS NOT NULL
  )
  UPDATE orders_attribution oa
     SET is_first_order = (r.rn = 1)
    FROM ranked r
   WHERE oa.store_id = r.store_id
     AND oa.order_id = r.order_id;

  -- Guest checkouts (customer_id NULL) stay unclassifiable.
  UPDATE orders_attribution
     SET is_first_order = NULL
   WHERE store_id = p_store_id
     AND customer_id IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recompute_first_order_flags(text)
  TO anon, service_role;
```

### Step 3.2 — Verify repo still type-checks
```
npx tsc --noEmit
```
(No TS change; confirms green. Live RPC run happens in manual verification.)

### Step 3.3 — Commit
```
git add /Users/dorperetz/script-roas/supabase/migrations/20260602130000_recompute_first_order_flags.sql
git commit -m "feat(db): recompute_first_order_flags(p_store_id) RPC

Idempotent per-store first-order-EVER flagging over full unfiltered history.
is_first_order = (order_created_at == MIN per (store_id, customer_id)) with
deterministic order_id tiebreak; NULL where customer_id NULL.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4 — Dual-write `customer_id` + `order_created_at` in both crons + call the RPC

**Files**
- Modify: `src/inngest/functions/cronDaily.ts:1419` (upsert map), end of `runDailyForStore` (after the `product_catalog` upsert, before `return`, ~`:1474`).
- Modify: `src/inngest/functions/cronLive.ts:682` (upsert map), after the orders upsert (~`:707`).
- Test: `src/inngest/functions/__tests__/cronDailyFirstOrder.test.ts` (Create).

### Step 4.1 — Write the failing test
Create `src/inngest/functions/__tests__/cronDailyFirstOrder.test.ts`:

```ts
/**
 * Phase 3 — cron-daily dual-write guard for the first-order columns.
 *
 * Pins:
 *   1. The orders_attribution upsert map includes customer_id + order_created_at
 *      (sourced from the fetched ShopifyOrderRow.customerId / .createdAt).
 *   2. runDailyForStore calls the recompute_first_order_flags RPC with the
 *      store id (so is_first_order is refreshed every nightly tick).
 *
 * Mock strategy mirrors cronDaily.test.ts: getSupabaseAdmin returns a chainable
 * stub recording upsert(table,rows,opts) + rpc(name,args); all fetchers mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type UpsertCall = { table: string; rows: unknown };
type RpcCall = { name: string; args: unknown };

const mockState = vi.hoisted(() => {
  return {
    upserts: [] as UpsertCall[],
    rpcs: [] as RpcCall[],
  };
});

vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => ({
      upsert: (rows: unknown) => {
        mockState.upserts.push({ table, rows });
        return Promise.resolve({ error: null });
      },
      delete: () => ({ in: () => Promise.resolve({ error: null }), not: () => Promise.resolve({ error: null }) }),
      select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
    }),
    rpc: (name: string, args: unknown) => {
      mockState.rpcs.push({ name, args });
      return Promise.resolve({ error: null });
    },
  }),
}));

vi.mock('@/lib/fetchers/shopify', () => ({
  fetchShopifyOrdersAttribution: vi.fn().mockResolvedValue([
    {
      storeId: 'uzoshop',
      orderId: 'o-1',
      date: '2026-05-20',
      totalCad: 80,
      source: 'meta-paid',
      utmSource: null, utmMedium: null, utmCampaign: null, utmContent: null,
      fbclidPresent: false, gclidPresent: false, referrer: null,
      utmId: null, utmTerm: null, lineItems: null,
      customerId: '778899',
      createdAt: '2026-05-20T09:30:00-04:00',
    },
  ]),
  fetchShopifyRevenueAndRefunds: vi.fn().mockResolvedValue({
    storeId: 'uzoshop', date: '2026-05-20', storeName: 'uzoshop',
    revenueCad: 80, productRows: [], customItemRefundCad: 0,
  }),
  fetchShopifyProductCatalog: vi.fn().mockResolvedValue([]),
}));

// All remaining platform fetchers stubbed empty so runDailyForStore reaches
// the orders_attribution upsert + RPC without network.
vi.mock('@/lib/fetchers/meta', () => ({
  fetchMeta: vi.fn().mockResolvedValue({ adsetRows: [], adRows: [], totalSpendCad: 0, budgets: {} }),
}));
vi.mock('@/lib/fetchers/googleAds', () => ({
  fetchGoogleAds: vi.fn().mockResolvedValue({ adGroupRows: [], adRows: [], totalSpendCad: 0 }),
}));
vi.mock('@/lib/fetchers/tiktok', () => ({
  fetchTikTok: vi.fn().mockResolvedValue({ campaignRows: [], adRows: [], totalSpendCad: 0 }),
}));

import { runDailyForStore } from '@/inngest/functions/cronDaily';

function makeStep() {
  return { run: async (_id: string, cb: () => unknown) => cb() };
}

beforeEach(() => {
  mockState.upserts.length = 0;
  mockState.rpcs.length = 0;
});

describe('cron-daily — first-order dual-write + RPC', () => {
  it('orders_attribution upsert rows include customer_id + order_created_at', async () => {
    await runDailyForStore('uzoshop', '2026-05-20', { step: makeStep() } as never);

    const ordersUpsert = mockState.upserts.find((u) => u.table === 'orders_attribution');
    expect(ordersUpsert).toBeTruthy();
    const rows = ordersUpsert!.rows as Array<Record<string, unknown>>;
    expect(rows[0].customer_id).toBe('778899');
    expect(rows[0].order_created_at).toBe('2026-05-20T09:30:00-04:00');
  });

  it('calls recompute_first_order_flags with the store id', async () => {
    await runDailyForStore('uzoshop', '2026-05-20', { step: makeStep() } as never);

    const rpc = mockState.rpcs.find((r) => r.name === 'recompute_first_order_flags');
    expect(rpc).toBeTruthy();
    expect(rpc!.args).toEqual({ p_store_id: 'uzoshop' });
  });
});
```

> Worker note: the exact set of `vi.mock` fetcher names/return shapes may need to mirror `cronDaily.test.ts` if `runDailyForStore`'s import surface differs — copy that file's hoisted-mock block verbatim and ADD the `customerId`/`createdAt`/`order_created_at` assertions + the `rpc` recorder. Keep the two assertions above unchanged.

### Step 4.2 — Run (expect FAIL)
```
npx vitest run src/inngest/functions/__tests__/cronDailyFirstOrder.test.ts
```
Expect FAIL: `customer_id`/`order_created_at` absent from the upsert rows; no `recompute_first_order_flags` RPC recorded.

### Step 4.3 — Minimal impl
In `src/inngest/functions/cronDaily.ts`, extend the `orders_attribution` upsert map (`:1419`) — add two keys to the mapped object:

```ts
      const orderRows = shopify.orders.map((o) => ({
        store_id: o.storeId,
        order_id: o.orderId,
        date: o.date,
        total_cad: o.totalCad,
        source: o.source,
        utm_source: o.utmSource,
        utm_medium: o.utmMedium,
        utm_campaign: o.utmCampaign,
        utm_content: o.utmContent,
        fbclid_present: o.fbclidPresent,
        gclid_present: o.gclidPresent,
        referrer: o.referrer,
        utm_id: o.utmId,
        utm_term: o.utmTerm,
        line_items: o.lineItems,
        customer_id: o.customerId,
        order_created_at: o.createdAt,
      }));
```

Then, AFTER the `product_catalog` upsert block closes (i.e. immediately before the `});` that ends the `persist-...` step callback at ~`:1475`), add the RPC call. Find the closing of the product_catalog `if` block and add:

```ts
    // Phase 3 — refresh first-order-EVER flags for this store over its FULL
    // history (the RPC is unfiltered; a newly-arrived earlier order can demote
    // a later one). Soft-fail: the orders_attribution rows are correct on their
    // own; only is_first_order is stale on failure (next tick re-runs it).
    const { error: foErr } = await admin.rpc('recompute_first_order_flags', {
      p_store_id: storeId,
    });
    if (foErr) {
      console.warn(
        `cron-daily ${storeId} ${dateStr}: recompute_first_order_flags failed: ${foErr.message}`,
      );
    }
  });
```

(Place this so it runs unconditionally inside the persist step, not gated by `shopify.orders.length`.)

### Step 4.4 — Run (expect PASS)
```
npx vitest run src/inngest/functions/__tests__/cronDailyFirstOrder.test.ts
npx vitest run src/inngest/functions/__tests__/cronDaily.test.ts
npx tsc --noEmit
```
All PASS. The existing `cronDaily.test.ts` Test 5 (onConflict strings) still passes — we only added keys to the rows, not the conflict target.

### Step 4.5 — cron-live parity (same dual-write + RPC)
In `src/inngest/functions/cronLive.ts`, extend the orders upsert map (`:682`) — add the two keys:

```ts
      const orderRows = todayOrders.map((o) => ({
        store_id: o.storeId,
        order_id: o.orderId,
        date: o.date,
        total_cad: o.totalCad,
        source: o.source,
        utm_source: o.utmSource,
        utm_medium: o.utmMedium,
        utm_campaign: o.utmCampaign,
        utm_content: o.utmContent,
        fbclid_present: o.fbclidPresent,
        gclid_present: o.gclidPresent,
        referrer: o.referrer,
        utm_id: o.utmId,
        utm_term: o.utmTerm,
        line_items: o.lineItems,
        customer_id: o.customerId,
        order_created_at: o.createdAt,
      }));
```

Then, immediately after the `orders_attribution` upsert error check closes (after the `}` that follows the `if (ordErr) { throw ... }` block at ~`:706`, still inside the `if (todayOrders.length > 0)` body), add the RPC:

```ts
      // Phase 3 — refresh first-order-EVER flags for this store (full history,
      // unfiltered). Soft-fail so a flag-recompute error never reverts the
      // spend + orders persist above.
      const { error: foErr } = await admin.rpc('recompute_first_order_flags', {
        p_store_id: storeId,
      });
      if (foErr) {
        console.warn(
          `cron-live ${storeId} ${today}: recompute_first_order_flags failed: ${foErr.message}`,
        );
      }
    }
```

(`admin` is already in scope from the `getSupabaseAdmin()` call at `:681`.)

### Step 4.6 — Run (expect PASS)
```
npx vitest run src/inngest/functions/__tests__/cronLiveLiveTickAt.test.ts
npx tsc --noEmit
```
PASS.

### Step 4.7 — Commit
```
git add src/inngest/functions/cronDaily.ts src/inngest/functions/cronLive.ts src/inngest/functions/__tests__/cronDailyFirstOrder.test.ts
git commit -m "feat(crons): dual-write customer_id + order_created_at; call first-order RPC

Both cron upsert maps now write customer_id + order_created_at; both call
recompute_first_order_flags(p_store_id) (soft-fail) so is_first_order is
refreshed over full per-store history each tick. onConflict unchanged.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5 — Read the new columns back into `OrderAttributionRow`

**Files**
- Modify: `src/lib/ordersAttribution.ts:31` (`OrderAttributionRow` type).
- Modify: `src/lib/postgresReaders.ts:1051` (SELECT string) + `:1074` (row map).
- Test: `src/lib/__tests__/postgresReadersFirstOrder.test.ts` (Create).

### Step 5.1 — Write the failing test
Create `src/lib/__tests__/postgresReadersFirstOrder.test.ts`:

```ts
/**
 * Phase 3 — postgresReaders.fetchOrdersAttribution must read the 3 new
 * first-order columns into OrderAttributionRow.
 *
 * Pins:
 *   1. The SELECT string includes customer_id, order_created_at, is_first_order.
 *   2. The row map projects them: customerId (string|null),
 *      orderCreatedAt (string|null), isFirstOrder (boolean|null — NULL stays
 *      null, never coerced to false → guest/unflagged rows are honestly
 *      "unknown", not "returning").
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const selectSpy = vi.hoisted(() => vi.fn());
const rowData = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    from: () => ({
      select: (cols: string) => {
        selectSpy(cols);
        const q = {
          gte: () => q,
          lte: () => q,
          range: () => Promise.resolve({ data: rowData.rows, error: null }),
          then: (res: (v: { data: unknown; error: null }) => void) =>
            res({ data: rowData.rows, error: null }),
        };
        return q;
      },
    }),
  }),
}));

import { fetchOrdersAttributionFromPostgres } from '@/lib/postgresReaders';

beforeEach(() => {
  selectSpy.mockClear();
  rowData.rows = [
    {
      date: '2026-05-01', store_id: 'uzoshop', order_id: 'o-1', total_cad: 80,
      source: 'meta-paid', utm_source: null, utm_medium: null, utm_campaign: null,
      utm_content: null, fbclid_present: false, gclid_present: false, referrer: null,
      utm_id: null, utm_term: null, line_items: null,
      customer_id: '778899', order_created_at: '2026-05-01T09:30:00-04:00', is_first_order: true,
    },
    {
      date: '2026-05-01', store_id: 'uzoshop', order_id: 'o-2', total_cad: 40,
      source: 'direct', utm_source: null, utm_medium: null, utm_campaign: null,
      utm_content: null, fbclid_present: false, gclid_present: false, referrer: null,
      utm_id: null, utm_term: null, line_items: null,
      customer_id: null, order_created_at: '2026-05-01T11:00:00-04:00', is_first_order: null,
    },
  ];
});

afterEach(() => vi.clearAllMocks());

describe('fetchOrdersAttributionFromPostgres — first-order columns', () => {
  it('SELECT string requests the 3 new columns', async () => {
    await fetchOrdersAttributionFromPostgres();
    const cols = String(selectSpy.mock.calls[0][0]);
    expect(cols).toContain('customer_id');
    expect(cols).toContain('order_created_at');
    expect(cols).toContain('is_first_order');
  });

  it('maps customerId / orderCreatedAt / isFirstOrder; NULL stays null', async () => {
    const rows = await fetchOrdersAttributionFromPostgres();
    expect(rows).toHaveLength(2);

    expect(rows[0].customerId).toBe('778899');
    expect(rows[0].orderCreatedAt).toBe('2026-05-01T09:30:00-04:00');
    expect(rows[0].isFirstOrder).toBe(true);

    expect(rows[1].customerId).toBeNull();
    expect(rows[1].isFirstOrder).toBeNull(); // NOT false — unclassifiable
  });
});
```

> Worker note: if the real `paginate` helper does not resolve via the `.range()`/`then` shape above, mirror the exact chain mock used in `src/lib/__tests__/postgresReaders.test.ts` for `fetchOrdersAttribution` and append the same two assertions. The two `expect` blocks above are the contract.

### Step 5.2 — Run (expect FAIL)
```
npx vitest run src/lib/__tests__/postgresReadersFirstOrder.test.ts
```
Expect FAIL: SELECT lacks the new columns; `customerId`/`orderCreatedAt`/`isFirstOrder` are `undefined`.

### Step 5.3 — Minimal impl
In `src/lib/ordersAttribution.ts`, extend `OrderAttributionRow` (`:31`) — add three fields after `lineItems`:

```ts
  lineItems: OrderLineItem[];
  /** Phase 3 — Shopify opaque numeric customer id (string), null on guest
   *  checkout. Privacy: id only — never name/email/phone. */
  customerId: string | null;
  /** Phase 3 — Shopify created_at (ISO-8601 with offset), null when missing. */
  orderCreatedAt: string | null;
  /** Phase 3 — TRUE when this is the customer's first order EVER for the store;
   *  null when unclassifiable (guest checkout or not-yet-flagged). NEVER coerce
   *  null→false — that would silently re-bucket unknowns as "returning". */
  isFirstOrder: boolean | null;
};
```

In `src/lib/postgresReaders.ts`, extend the SELECT (`:1051`) — append the 3 columns:

```ts
        .select(
          'date, store_id, order_id, total_cad, source, utm_source, utm_medium, ' +
            'utm_campaign, utm_content, fbclid_present, gclid_present, referrer, ' +
            'utm_id, utm_term, line_items, customer_id, order_created_at, is_first_order',
        );
```

Extend the row map (`:1074`, inside `rows.push({ ... })`) — add after `lineItems`:

```ts
      lineItems: includeLI ? parseLineItems(r.line_items) : [],
      customerId:
        r.customer_id == null ? null : String(r.customer_id).trim() || null,
      orderCreatedAt:
        r.order_created_at == null ? null : String(r.order_created_at),
      isFirstOrder:
        r.is_first_order === true ? true : r.is_first_order === false ? false : null,
    });
```

### Step 5.4 — Run (expect PASS)
```
npx vitest run src/lib/__tests__/postgresReadersFirstOrder.test.ts
npx vitest run src/lib/__tests__/postgresReaders.test.ts
npx vitest run src/lib/__tests__/orderSourceContract.test.ts
npx tsc --noEmit
```
All PASS.

### Step 5.5 — Commit
```
git add src/lib/ordersAttribution.ts src/lib/postgresReaders.ts src/lib/__tests__/postgresReadersFirstOrder.test.ts
git commit -m "feat(readers): read first-order columns into OrderAttributionRow

SELECT + row map carry customerId, orderCreatedAt, isFirstOrder. NULL
is_first_order stays null (never coerced to false → unknowns are not
silently classified as returning).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6 — One-time Shopify Bulk-Operations backfill helper

**Files**
- Create: `src/lib/fetchers/shopifyBulkFirstOrder.ts`
- Test: `src/lib/fetchers/__tests__/shopifyBulkFirstOrder.test.ts`

This is a one-time historical backfill: run a Bulk Operations GraphQL query exporting `{order.id, createdAt, customer.id}` per store, download the NDJSON, compute MIN(createdAt) per `(customer)`, and return the `order_id`s to flag `is_first_order=true` (and the full per-order set). The operator invokes it via a throwaway script (manual verification); the helper itself is pure + unit-tested.

### Step 6.1 — Write the failing test
Create `src/lib/fetchers/__tests__/shopifyBulkFirstOrder.test.ts`:

```ts
/**
 * Phase 3 — Shopify Bulk-Operations first-order backfill helper.
 *
 * Unit-tests the PURE NDJSON→first-order resolver (no network): given the
 * Bulk export lines {id, createdAt, customer:{id}}, compute exactly one
 * first-order order_id per customer (MIN createdAt, deterministic id
 * tiebreak) and classify every order. Guest lines (no customer) are
 * unclassifiable (firstOrder = null).
 */
import { describe, it, expect } from 'vitest';
import {
  resolveFirstOrdersFromBulkLines,
  type BulkOrderLine,
} from '@/lib/fetchers/shopifyBulkFirstOrder';

describe('resolveFirstOrdersFromBulkLines', () => {
  it('flags the earliest order per customer as first, later orders as not-first', () => {
    const lines: BulkOrderLine[] = [
      { id: 'gid://shopify/Order/3', createdAt: '2026-03-10T00:00:00Z', customer: { id: 'gid://shopify/Customer/1' } },
      { id: 'gid://shopify/Order/1', createdAt: '2026-01-01T00:00:00Z', customer: { id: 'gid://shopify/Customer/1' } },
      { id: 'gid://shopify/Order/2', createdAt: '2026-02-05T00:00:00Z', customer: { id: 'gid://shopify/Customer/1' } },
    ];
    const out = resolveFirstOrdersFromBulkLines(lines);
    expect(out.get('1')).toBe(true);   // earliest (2026-01-01) → first
    expect(out.get('2')).toBe(false);
    expect(out.get('3')).toBe(false);
  });

  it('deterministic order_id tiebreak when timestamps are equal (smallest id wins)', () => {
    const lines: BulkOrderLine[] = [
      { id: 'gid://shopify/Order/20', createdAt: '2026-01-01T00:00:00Z', customer: { id: 'gid://shopify/Customer/9' } },
      { id: 'gid://shopify/Order/10', createdAt: '2026-01-01T00:00:00Z', customer: { id: 'gid://shopify/Customer/9' } },
    ];
    const out = resolveFirstOrdersFromBulkLines(lines);
    expect(out.get('10')).toBe(true);  // '10' < '20' lexicographically
    expect(out.get('20')).toBe(false);
  });

  it('guest line (no customer) → null (unclassifiable, never false)', () => {
    const lines: BulkOrderLine[] = [
      { id: 'gid://shopify/Order/50', createdAt: '2026-01-01T00:00:00Z', customer: null },
    ];
    const out = resolveFirstOrdersFromBulkLines(lines);
    expect(out.get('50')).toBeNull();
  });

  it('parses raw NDJSON text into BulkOrderLine[] (skips blank lines + malformed JSON)', () => {
    const ndjson =
      '{"id":"gid://shopify/Order/1","createdAt":"2026-01-01T00:00:00Z","customer":{"id":"gid://shopify/Customer/1"}}\n' +
      '\n' +
      'not-json\n' +
      '{"id":"gid://shopify/Order/2","createdAt":"2026-02-01T00:00:00Z","customer":null}\n';
    const lines = parseBulkNdjson(ndjson);
    expect(lines).toHaveLength(2);
    expect(lines[0].id).toBe('gid://shopify/Order/1');
    expect(lines[1].customer).toBeNull();
  });
});

import { parseBulkNdjson } from '@/lib/fetchers/shopifyBulkFirstOrder';
```

### Step 6.2 — Run (expect FAIL)
```
npx vitest run src/lib/fetchers/__tests__/shopifyBulkFirstOrder.test.ts
```
Expect FAIL: module `@/lib/fetchers/shopifyBulkFirstOrder` does not exist.

### Step 6.3 — Minimal impl
Create `src/lib/fetchers/shopifyBulkFirstOrder.ts`:

```ts
/**
 * Phase 3 — one-time Shopify Bulk-Operations backfill for is_first_order.
 *
 * READ-ONLY toward Shopify; ZERO writes to ad platforms. Exports per store:
 *   { order.id, createdAt, customer.id }
 * via bulkOperationRunQuery → poll currentBulkOperation → download NDJSON →
 * resolveFirstOrdersFromBulkLines → caller UPSERTs is_first_order into
 * orders_attribution (keyed by the numeric order id tail).
 *
 * Privacy: only customer.id (opaque) is requested — never name/email/phone.
 *
 * The network functions are thin; the resolver + parser are pure and unit-
 * tested. A throwaway operator script wires `runBulkFirstOrderBackfill` to a
 * Supabase admin client per store (see manual-verification checklist).
 */
import { getShopifyAccessToken } from '@/lib/fetchers/shopifyAuth';
import { fetchWithBackoff } from './withBackoff';

const SHOPIFY_API_VERSION = '2026-04';

/** One exported order line from the Bulk NDJSON. */
export type BulkOrderLine = {
  id: string;
  createdAt: string;
  customer: { id?: string | null } | null;
};

/** GraphQL document exporting {id, createdAt, customer{id}} for ALL orders. */
export const BULK_FIRST_ORDER_QUERY = `
mutation {
  bulkOperationRunQuery(
    query: """
    {
      orders {
        edges {
          node {
            id
            createdAt
            customer { id }
          }
        }
      }
    }
    """
  ) {
    bulkOperation { id status }
    userErrors { field message }
  }
}`.trim();

/** Strip "gid://shopify/Order/123" → "123" (matches REST order_id tails). */
function gidTail(gid: string): string {
  const i = gid.lastIndexOf('/');
  return i >= 0 ? gid.slice(i + 1) : gid;
}

/** Parse Bulk NDJSON text → BulkOrderLine[] (skips blanks + malformed lines). */
export function parseBulkNdjson(ndjson: string): BulkOrderLine[] {
  const out: BulkOrderLine[] = [];
  for (const raw of ndjson.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const obj = JSON.parse(line) as Partial<BulkOrderLine>;
      if (typeof obj.id !== 'string' || typeof obj.createdAt !== 'string') continue;
      out.push({
        id: obj.id,
        createdAt: obj.createdAt,
        customer:
          obj.customer && typeof obj.customer === 'object'
            ? { id: obj.customer.id ?? null }
            : null,
      });
    } catch {
      // malformed line — skip (one bad row must not abort the batch)
    }
  }
  return out;
}

/**
 * Pure resolver: numeric-order-id → first-order classification.
 *   true  = earliest (MIN createdAt; smallest id tiebreak) order for the customer
 *   false = a later order for the same customer
 *   null  = guest line (no customer id) → unclassifiable
 */
export function resolveFirstOrdersFromBulkLines(
  lines: BulkOrderLine[],
): Map<string, boolean | null> {
  const result = new Map<string, boolean | null>();
  // earliest line per customer: { orderTail, createdAt }
  const best = new Map<string, { tail: string; createdAt: string }>();
  const customerByTail = new Map<string, string>();

  for (const l of lines) {
    const tail = gidTail(l.id);
    const custId = l.customer?.id ? gidTail(l.customer.id) : null;
    if (!custId) {
      result.set(tail, null); // guest → unclassifiable
      continue;
    }
    customerByTail.set(tail, custId);
    const cur = best.get(custId);
    const isEarlier =
      !cur ||
      l.createdAt < cur.createdAt ||
      (l.createdAt === cur.createdAt && tail < cur.tail);
    if (isEarlier) best.set(custId, { tail, createdAt: l.createdAt });
  }

  for (const [tail, custId] of customerByTail) {
    const winner = best.get(custId);
    result.set(tail, winner != null && winner.tail === tail);
  }
  return result;
}

/** Kick off the Bulk export; returns the bulk operation gid. Throws on userErrors. */
export async function startBulkFirstOrderExport(storeId: string): Promise<string> {
  const domain = requireDomain(storeId);
  const token = await getShopifyAccessToken(storeId);
  const res = await fetchWithBackoff(
    `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query: BULK_FIRST_ORDER_QUERY }),
    },
    { provider: 'shopify' },
  );
  if (!res.ok) {
    throw new Error(`bulk start ${storeId} failed (${res.status})`);
  }
  const body = (await res.json()) as {
    data?: { bulkOperationRunQuery?: { bulkOperation?: { id?: string }; userErrors?: Array<{ message?: string }> } };
  };
  const errs = body.data?.bulkOperationRunQuery?.userErrors ?? [];
  if (errs.length > 0) {
    throw new Error(`bulk start ${storeId} userErrors: ${errs.map((e) => e.message).join('; ')}`);
  }
  const id = body.data?.bulkOperationRunQuery?.bulkOperation?.id;
  if (!id) throw new Error(`bulk start ${storeId}: no operation id returned`);
  return id;
}

/** Poll currentBulkOperation until COMPLETED; returns the NDJSON download URL. */
export async function pollBulkFirstOrderUrl(
  storeId: string,
  opts: { intervalMs?: number; maxAttempts?: number } = {},
): Promise<string> {
  const domain = requireDomain(storeId);
  const token = await getShopifyAccessToken(storeId);
  const intervalMs = opts.intervalMs ?? 5000;
  const maxAttempts = opts.maxAttempts ?? 120;
  const POLL = `query { currentBulkOperation { id status errorCode url } }`;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetchWithBackoff(
      `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': token,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ query: POLL }),
      },
      { provider: 'shopify' },
    );
    const body = (await res.json()) as {
      data?: { currentBulkOperation?: { status?: string; errorCode?: string | null; url?: string | null } };
    };
    const op = body.data?.currentBulkOperation;
    if (op?.status === 'COMPLETED') {
      if (!op.url) return ''; // COMPLETED with 0 rows → no file
      return op.url;
    }
    if (op?.status === 'FAILED') {
      throw new Error(`bulk ${storeId} FAILED: ${op.errorCode ?? 'unknown'}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`bulk ${storeId}: poll timed out after ${maxAttempts} attempts`);
}

/** Download + parse + resolve. Empty url → empty map (store had 0 orders). */
export async function runBulkFirstOrderBackfill(
  storeId: string,
  opts: { intervalMs?: number; maxAttempts?: number } = {},
): Promise<Map<string, boolean | null>> {
  await startBulkFirstOrderExport(storeId);
  const url = await pollBulkFirstOrderUrl(storeId, opts);
  if (!url) return new Map();
  const res = await fetchWithBackoff(url, { method: 'GET' }, { provider: 'shopify' });
  if (!res.ok) throw new Error(`bulk ${storeId} download failed (${res.status})`);
  const ndjson = await res.text();
  return resolveFirstOrdersFromBulkLines(parseBulkNdjson(ndjson));
}

function requireDomain(storeId: string): string {
  const key = `${storeId.toUpperCase()}_SHOPIFY_DOMAIN`;
  const domain = process.env[key];
  if (!domain) throw new Error(`shopifyBulkFirstOrder: missing env ${key}`);
  return domain;
}
```

### Step 6.4 — Run (expect PASS)
```
npx vitest run src/lib/fetchers/__tests__/shopifyBulkFirstOrder.test.ts
npx tsc --noEmit
```
PASS.

### Step 6.5 — Commit
```
git add src/lib/fetchers/shopifyBulkFirstOrder.ts src/lib/fetchers/__tests__/shopifyBulkFirstOrder.test.ts
git commit -m "feat(backfill): Shopify Bulk-Operations first-order helper

bulkOperationRunQuery exporting {order.id, createdAt, customer.id} + poll +
NDJSON parse + pure MIN-per-customer resolver (deterministic id tiebreak,
guest → null). Read-only; customer.id only (privacy). One-time backfill.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7 — Pure NC-ROAS / nCAC / unclassifiable adapter

**Files**
- Create: `src/lib/home/newCustomerMetrics.ts`
- Test: `src/lib/home/__tests__/newCustomerMetrics.test.ts`

NC-ROAS = new-customer revenue ÷ MER spend (mapping-aware `agg.spend`, passed in by the caller — NEVER recomputed from raw account totals). nCAC = MER spend ÷ new-customer orders. Unclassifiable share = orders with `isFirstOrder == null` ÷ total orders.

### Step 7.1 — Write the failing test
Create `src/lib/home/__tests__/newCustomerMetrics.test.ts`:

```ts
/**
 * Phase 3 — pure NC-ROAS / nCAC adapter over OrderAttributionRow[] + mapping-
 * aware MER spend (agg.spend passed in; NEVER recomputed from raw totals).
 *
 *   ncRevenue   = Σ totalCad where isFirstOrder === true
 *   ncOrders    = count where isFirstOrder === true
 *   ncRoas      = ncRevenue / merSpend          (null when merSpend <= 0)
 *   nCac        = merSpend / ncOrders           (null when ncOrders === 0)
 *   unclassifiableShare = (#isFirstOrder==null) / total   (0 when total 0)
 */
import { describe, it, expect } from 'vitest';
import {
  computeNewCustomerMetrics,
  type FirstOrderInput,
} from '@/lib/home/newCustomerMetrics';

function row(over: Partial<FirstOrderInput>): FirstOrderInput {
  return { storeName: 'uzoshop', totalCad: 0, isFirstOrder: null, ...over };
}

describe('computeNewCustomerMetrics', () => {
  it('computes ncRoas / nCac / unclassifiableShare from first-order rows', () => {
    const rows: FirstOrderInput[] = [
      row({ totalCad: 100, isFirstOrder: true }),
      row({ totalCad: 60, isFirstOrder: true }),
      row({ totalCad: 200, isFirstOrder: false }), // returning
      row({ totalCad: 40, isFirstOrder: null }),   // guest / unclassifiable
    ];
    const m = computeNewCustomerMetrics(rows, 80); // merSpend = 80

    expect(m.ncRevenue).toBe(160);
    expect(m.ncOrders).toBe(2);
    expect(m.ncRoas).toBeCloseTo(2.0, 5);   // 160 / 80
    expect(m.nCac).toBeCloseTo(40, 5);      // 80 / 2
    expect(m.unclassifiableShare).toBeCloseTo(0.25, 5); // 1 of 4
  });

  it('null merSpend / 0 spend → ncRoas null; 0 new orders → nCac null', () => {
    const rows: FirstOrderInput[] = [row({ totalCad: 50, isFirstOrder: false })];
    const m = computeNewCustomerMetrics(rows, 0);
    expect(m.ncRoas).toBeNull();
    expect(m.nCac).toBeNull();
    expect(m.ncOrders).toBe(0);
  });

  it('empty rows → zero revenue/orders, null ratios, 0 unclassifiable share', () => {
    const m = computeNewCustomerMetrics([], 100);
    expect(m.ncRevenue).toBe(0);
    expect(m.ncOrders).toBe(0);
    expect(m.ncRoas).toBeNull(); // 0 / 100 is a meaningless ratio here → null
    expect(m.nCac).toBeNull();
    expect(m.unclassifiableShare).toBe(0);
  });

  it('storeName filter scopes the computation when provided', () => {
    const rows: FirstOrderInput[] = [
      row({ storeName: 'uzoshop', totalCad: 100, isFirstOrder: true }),
      row({ storeName: 'zolplus', totalCad: 999, isFirstOrder: true }),
    ];
    const m = computeNewCustomerMetrics(rows, 50, 'uzoshop');
    expect(m.ncRevenue).toBe(100);
    expect(m.ncOrders).toBe(1);
  });
});
```

### Step 7.2 — Run (expect FAIL)
```
npx vitest run src/lib/home/__tests__/newCustomerMetrics.test.ts
```
Expect FAIL: module does not exist.

### Step 7.3 — Minimal impl
Create `src/lib/home/newCustomerMetrics.ts`:

```ts
/**
 * Phase 3 — pure NC-ROAS / nCAC adapter.
 *
 * NC-ROAS = new-customer revenue ÷ MER spend; nCAC = MER spend ÷ new-customer
 * orders. The MER spend (`merSpend`) is the MAPPING-AWARE aggregate spend
 * (agg.spend) passed in by the caller — this adapter NEVER recomputes spend
 * from raw account totals (preserves the campaign↔store↔product mapping).
 *
 * "new customer" = isFirstOrder === true (first-order-EVER). Guest checkouts
 * (isFirstOrder === null) are surfaced as `unclassifiableShare`, NEVER folded
 * into new or returning. ncRoas is null when merSpend <= 0 (no meaningful
 * ratio) OR ncRevenue === 0 with no orders; nCac is null when ncOrders === 0.
 */

export interface FirstOrderInput {
  /** Store display name — used by the optional `storeName` scope filter. */
  storeName: string;
  /** Immutable CAD order total (orders_attribution.total_cad). */
  totalCad: number;
  /** true = first-order-EVER; false = returning; null = unclassifiable. */
  isFirstOrder: boolean | null;
}

export interface NewCustomerMetrics {
  /** Σ totalCad where isFirstOrder === true. */
  ncRevenue: number;
  /** Count where isFirstOrder === true. */
  ncOrders: number;
  /** ncRevenue / merSpend; null when merSpend <= 0 or ncRevenue === 0. */
  ncRoas: number | null;
  /** merSpend / ncOrders; null when ncOrders === 0. */
  nCac: number | null;
  /** (#isFirstOrder===null) / total; 0 when there are no rows. */
  unclassifiableShare: number;
}

export function computeNewCustomerMetrics(
  rows: FirstOrderInput[],
  merSpend: number | null,
  storeName?: string,
): NewCustomerMetrics {
  const scoped = storeName ? rows.filter((r) => r.storeName === storeName) : rows;

  let ncRevenue = 0;
  let ncOrders = 0;
  let unclassifiable = 0;
  for (const r of scoped) {
    if (r.isFirstOrder === true) {
      ncRevenue += Number.isFinite(r.totalCad) ? r.totalCad : 0;
      ncOrders += 1;
    } else if (r.isFirstOrder === null) {
      unclassifiable += 1;
    }
  }

  const spend = merSpend != null && Number.isFinite(merSpend) ? merSpend : 0;
  const ncRoas = spend > 0 && ncRevenue > 0 ? ncRevenue / spend : null;
  const nCac = ncOrders > 0 ? spend / ncOrders : null;
  const unclassifiableShare = scoped.length > 0 ? unclassifiable / scoped.length : 0;

  return { ncRevenue, ncOrders, ncRoas, nCac, unclassifiableShare };
}
```

### Step 7.4 — Run (expect PASS)
```
npx vitest run src/lib/home/__tests__/newCustomerMetrics.test.ts
npx tsc --noEmit
```
PASS.

### Step 7.5 — Commit
```
git add src/lib/home/newCustomerMetrics.ts src/lib/home/__tests__/newCustomerMetrics.test.ts
git commit -m "feat(home): pure NC-ROAS / nCAC / unclassifiable adapter

computeNewCustomerMetrics(rows, merSpend, storeName?) — new-customer revenue
÷ MER spend (mapping-aware spend passed in, never recomputed) + MER spend ÷
new orders + unclassifiable (guest) share. Guests never folded into new/return.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8 — CommandCenterHero subordinate NC-ROAS / nCAC tile

**Files**
- Modify: `src/components/home/CommandCenterHero.tsx` (props + new subordinate tile JSX in row 2 area).
- Test: `src/components/home/__tests__/CommandCenterHero.dom.test.tsx` (append).

The tile is SUBORDINATE: its OWN band via `useRoasBandGradient(ncRoas)`, a "different question" Hebrew label, and it must NOT alter the hero's main band gradient (driven by `current.roas`). It renders nothing when `newCustomer` is undefined (keeps existing 7-card tests green).

### Step 8.1 — Write the failing test (append)
Append to `src/components/home/__tests__/CommandCenterHero.dom.test.tsx`:

```ts
describe('<CommandCenterHero> — NC-ROAS / nCAC subordinate tile', () => {
  const NC = { ncRoas: 2.1, nCac: 38, ncOrders: 12, unclassifiableShare: 0.18 };

  it('renders the subordinate tile when newCustomer is provided', () => {
    const { getByTestId } = render(
      <CommandCenterHero current={PERIOD_GREEN} rangeLabel="היום" newCustomer={NC} />,
    );
    const tile = getByTestId('hero-nc-roas');
    expect(tile).toBeTruthy();
    // "different question" label — distinct from the main "ROAS" tile.
    expect(tile.textContent).toContain('שאלה אחרת');
    expect(tile.textContent).toContain('2.10'); // NC-ROAS value
    expect(tile.textContent).toContain('$38');  // nCAC value
  });

  it('subordinate tile carries its OWN band (ncRoas=2.1 → orange), not the hero band (roas=2.8 → green)', () => {
    const { getByTestId } = render(
      <CommandCenterHero current={PERIOD_GREEN} rangeLabel="היום" newCustomer={NC} />,
    );
    // hero featured stays green (driven by current.roas = 2.8)
    expect(getByTestId('hero-net-profit').getAttribute('data-band')).toBe('green');
    // subordinate tile is orange (driven by its own ncRoas = 2.1)
    expect(getByTestId('hero-nc-roas').getAttribute('data-band')).toBe('orange');
  });

  it('does NOT render the subordinate tile when newCustomer is omitted (back-compat)', () => {
    const { queryByTestId } = render(
      <CommandCenterHero current={PERIOD_GREEN} rangeLabel="היום" />,
    );
    expect(queryByTestId('hero-nc-roas')).toBeNull();
  });

  it('surfaces the unclassifiable share', () => {
    const { getByTestId } = render(
      <CommandCenterHero current={PERIOD_GREEN} rangeLabel="היום" newCustomer={NC} />,
    );
    expect(getByTestId('hero-nc-roas').textContent).toContain('18%');
  });
});
```

### Step 8.2 — Run (expect FAIL)
```
npx vitest run --config vitest.config.dom.ts src/components/home/__tests__/CommandCenterHero.dom.test.tsx
```
Expect FAIL: `hero-nc-roas` not found; `newCustomer` prop unknown.

### Step 8.3 — Minimal impl
In `src/components/home/CommandCenterHero.tsx`:

Add a props interface above `CommandCenterHeroProps` (after `CommandCenterSecondarySparklines`, ~`:164`):

```ts
/**
 * NC-ROAS / nCAC — a SUBORDINATE "different question" lens. Rendered as its
 * OWN-band tile; never changes the hero's main band gradient (which stays
 * driven by current.roas / MER). Omit to hide the tile entirely (back-compat).
 */
export interface CommandCenterNewCustomer {
  /** New-customer ROAS (new-customer revenue ÷ MER spend). null → "—". */
  ncRoas: number | null;
  /** New-customer acquisition cost (MER spend ÷ new orders), CAD. null → "—". */
  nCac: number | null;
  /** New-customer order count. */
  ncOrders: number;
  /** Fraction of orders with unknown customer (guest checkout). */
  unclassifiableShare: number;
}
```

Add the prop to `CommandCenterHeroProps` (after `updatedAt?`):

```ts
  /** Optional NC-ROAS / nCAC subordinate-tile data. Omit to hide. */
  newCustomer?: CommandCenterNewCustomer;
```

Add `newCustomer` to the destructured params (in `export function CommandCenterHero({ ... })`, after `updatedAt`):

```ts
  updatedAt,
  newCustomer,
  className,
```

Inside the component body, after `const freshnessStage = ...` (~`:521`), derive the tile's own band:

```ts
  // Subordinate NC-ROAS tile — its OWN band (different question), independent
  // of the hero's MER band (netBand). Hidden entirely when newCustomer omitted.
  const ncBand = useRoasBandGradient(newCustomer?.ncRoas ?? null);
```

Then, render the tile as a sibling of the two hero rows — add it AFTER the row-2 `</div>` (the `data-testid="hero-row-2"` block closes ~`:782`) and BEFORE the closing `</section>`:

```ts
      {newCustomer && (
        <div className="grid gap-3 grid-cols-1" data-testid="hero-nc-row">
          <Card
            band={ncBand.band}
            bandStrength="muted"
            freshness={freshnessStage}
            className="hero-card px-3.5 py-4 sm:px-5 sm:py-5"
            data-testid="hero-nc-roas"
            title="לקוחות חדשים (הזמנה ראשונה אי-פעם). שאלה אחרת מ-MER: NC-ROAS = הכנסת לקוחות חדשים ÷ הוצאת פרסום; nCAC = הוצאת פרסום ÷ הזמנות חדשות."
          >
            <HeroCardHeader label="לקוחות חדשים · שאלה אחרת" />
            <div className="flex items-end gap-6 mt-2">
              <div>
                <div className="hero-eyebrow text-[10.5px] uppercase tracking-[0.08em] text-ink-muted font-semibold">
                  NC-ROAS
                </div>
                <bdi
                  dir="ltr"
                  className="v num neutral block font-extrabold tabular-nums tracking-tight leading-[1.05] text-[1.625rem] whitespace-nowrap"
                >
                  {newCustomer.ncRoas != null ? (
                    <CountUp value={newCustomer.ncRoas} format={fmtRoas} />
                  ) : (
                    '—'
                  )}
                </bdi>
              </div>
              <div>
                <div className="hero-eyebrow text-[10.5px] uppercase tracking-[0.08em] text-ink-muted font-semibold">
                  nCAC
                </div>
                <bdi
                  dir="ltr"
                  className="v num neutral block font-extrabold tabular-nums tracking-tight leading-[1.05] text-[1.625rem] whitespace-nowrap"
                >
                  <Money value={newCustomer.nCac} prefix="$" compactAbove={1_000_000} countUp />
                </bdi>
              </div>
            </div>
            <div
              className="text-xs mt-1.5 text-ink-muted tabular-nums"
              data-testid="hero-nc-unclassifiable"
            >
              <bdi dir="rtl">
                {newCustomer.ncOrders.toLocaleString('en-US')} הזמנות חדשות ·{' '}
                {(newCustomer.unclassifiableShare * 100).toFixed(0)}% לא מסווג
              </bdi>
            </div>
          </Card>
        </div>
      )}
    </section>
```

### Step 8.4 — Run (expect PASS)
```
npx vitest run --config vitest.config.dom.ts src/components/home/__tests__/CommandCenterHero.dom.test.tsx
npx tsc --noEmit
```
PASS. The original 7-card / `.v.banded` (==2) / `.v.neutral` (==5) tests still pass because the tile uses `.v.neutral` numbers and only renders when `newCustomer` is provided (those tests omit it).

### Step 8.5 — Commit
```
git add src/components/home/CommandCenterHero.tsx src/components/home/__tests__/CommandCenterHero.dom.test.tsx
git commit -m "feat(hero): subordinate NC-ROAS / nCAC tile (different question)

Own-band tile (useRoasBandGradient(ncRoas)) that never touches the hero's
MER band gradient. Hebrew 'שאלה אחרת' label + NC-ROAS + nCAC + unclassifiable
share. Hidden when newCustomer prop omitted (back-compat; 7-card tests green).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9 — StoreDetailModal per-store NC-ROAS / nCAC

**Files**
- Modify: `src/lib/home/storeDetail.ts` (`StoreDetailData` + `ToStoreDetailArgs` + `toStoreDetail`).
- Modify: `src/components/home/StoreDetailModal.tsx` (new per-store row).
- Test: `src/lib/home/__tests__/storeDetail.test.ts` (append or Create) + `src/components/home/__tests__/StoreDetailModal.dom.test.tsx` (append).

### Step 9.1 — Write the failing adapter test
Append to `src/lib/home/__tests__/storeDetail.test.ts` (Create the file with the standard header + a minimal `baseArgs` if it does not exist — mirror the existing per-store adapter tests):

```ts
import { describe, it, expect } from 'vitest';
import { toStoreDetail, type ToStoreDetailArgs } from '@/lib/home/storeDetail';
import type { FirstOrderInput } from '@/lib/home/newCustomerMetrics';

function baseArgs(over: Partial<ToStoreDetailArgs> = {}): ToStoreDetailArgs {
  return {
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    cur: { revenue: 1000, spend: 400, cogs: 250, roas: 2.5 } as never,
    prev: null,
    series: [],
    campaignRows: [],
    range: { from: '2026-05-01', to: '2026-05-01' },
    orders: 10,
    prevOrders: null,
    updatedAt: null,
    firstOrderRows: [],
    ...over,
  };
}

describe('toStoreDetail — per-store NC-ROAS / nCAC', () => {
  it('computes newCustomer from firstOrderRows scoped to the store + cur.spend (MER)', () => {
    const firstOrderRows: FirstOrderInput[] = [
      { storeName: 'uzoshop', totalCad: 120, isFirstOrder: true },
      { storeName: 'uzoshop', totalCad: 80, isFirstOrder: true },
      { storeName: 'uzoshop', totalCad: 200, isFirstOrder: false },
      { storeName: 'uzoshop', totalCad: 30, isFirstOrder: null },
      { storeName: 'zolplus', totalCad: 999, isFirstOrder: true }, // other store — excluded
    ];
    const d = toStoreDetail(baseArgs({ firstOrderRows }));
    expect(d.newCustomer.ncRevenue).toBe(200);     // 120 + 80
    expect(d.newCustomer.ncOrders).toBe(2);
    expect(d.newCustomer.ncRoas).toBeCloseTo(0.5, 5); // 200 / 400 (cur.spend)
    expect(d.newCustomer.nCac).toBeCloseTo(200, 5);   // 400 / 2
    expect(d.newCustomer.unclassifiableShare).toBeCloseTo(0.25, 5); // 1 of 4 scoped
  });

  it('no firstOrderRows → zeroed newCustomer block', () => {
    const d = toStoreDetail(baseArgs({ firstOrderRows: [] }));
    expect(d.newCustomer.ncOrders).toBe(0);
    expect(d.newCustomer.ncRoas).toBeNull();
    expect(d.newCustomer.nCac).toBeNull();
  });
});
```

### Step 9.2 — Run (expect FAIL)
```
npx vitest run src/lib/home/__tests__/storeDetail.test.ts
```
Expect FAIL: `firstOrderRows` not on `ToStoreDetailArgs`; `d.newCustomer` undefined.

### Step 9.3 — Minimal impl (adapter)
In `src/lib/home/storeDetail.ts`:

Add the import (top, after the existing imports):

```ts
import { computeNewCustomerMetrics, type FirstOrderInput, type NewCustomerMetrics } from '@/lib/home/newCustomerMetrics';
```

Add to `StoreDetailData` (after `topCampaigns`):

```ts
  /** Per-store NC-ROAS / nCAC (new-customer lens). Scoped to this store; MER
   *  spend = cur.spend (mapping-aware). */
  newCustomer: NewCustomerMetrics;
```

Add to `ToStoreDetailArgs` (after `updatedAt`):

```ts
  /** Order rows carrying first-order classification (from /api/orders-attribution
   *  → OrderAttributionRow). Scoped per-store inside toStoreDetail. */
  firstOrderRows: FirstOrderInput[];
```

In `toStoreDetail`, destructure `firstOrderRows` (add to the existing destructure on `:138`):

```ts
  const { storeId, storeName, cur, prev, series, campaignRows, range, orders, prevOrders, updatedAt, firstOrderRows } = args;
```

Compute the block (just before the final `return {`):

```ts
  // Per-store NC-ROAS / nCAC — scoped to this store; MER spend = cur.spend
  // (the mapping-aware aggregate already in the StoreAgg, never raw totals).
  const newCustomer = computeNewCustomerMetrics(firstOrderRows, cur.spend, storeName);
```

Add `newCustomer` to the returned object (after `topCampaigns`):

```ts
    topCampaigns,
    newCustomer,
  };
```

### Step 9.4 — Run (expect PASS)
```
npx vitest run src/lib/home/__tests__/storeDetail.test.ts
npx tsc --noEmit
```
PASS.

### Step 9.5 — Write the failing modal DOM test (append)
Append to `src/components/home/__tests__/StoreDetailModal.dom.test.tsx` (reuse that file's existing `makeData()`/fixture helper; extend the fixture with a `newCustomer` block):

```ts
describe('<StoreDetailModal> — per-store NC-ROAS / nCAC', () => {
  it('renders the new-customer row with NC-ROAS, nCAC and unclassifiable share', () => {
    const data = makeData({
      newCustomer: {
        ncRevenue: 300, ncOrders: 6, ncRoas: 1.5, nCac: 50, unclassifiableShare: 0.2,
      },
    });
    const { getByTestId } = render(
      <StoreDetailModal data={data} open onClose={() => {}} rangeLabel="היום" onOpenCampaigns={() => {}} />,
    );
    const nc = getByTestId('store-detail-nc');
    expect(nc.textContent).toContain('1.50'); // NC-ROAS
    expect(nc.textContent).toContain('$50');  // nCAC
    expect(nc.textContent).toContain('20%');  // unclassifiable
    expect(nc.textContent).toContain('שאלה אחרת');
  });
});
```

> Worker note: extend the existing `makeData()` helper in this file so its returned `StoreDetailData` includes a `newCustomer` block (default `{ ncRevenue: 0, ncOrders: 0, ncRoas: null, nCac: null, unclassifiableShare: 0 }`) and is overridable via the `over` arg — mirroring how the helper already spreads overrides.

### Step 9.6 — Run (expect FAIL)
```
npx vitest run --config vitest.config.dom.ts src/components/home/__tests__/StoreDetailModal.dom.test.tsx
```
Expect FAIL: `store-detail-nc` not found.

### Step 9.7 — Minimal impl (modal)
In `src/components/home/StoreDetailModal.tsx`, add a per-store NC row. Place it AFTER the KPI carousel section and BEFORE the chart section (`data-testid="store-detail-chart"`, ~`:317`). Reuse `useRoasBandGradient` (already imported) for the row's own band and `<Money>`/`<CountUp>` (already imported):

```tsx
          {/* Phase 3 — per-store NC-ROAS / nCAC (different question). Own band;
              never touches the header ROAS band gradient. */}
          <section data-testid="store-detail-nc">
            <Card
              band={useRoasBandGradient(data.newCustomer.ncRoas).band}
              bandStrength="muted"
              className="!p-3 sm:!p-4"
              title="לקוחות חדשים (הזמנה ראשונה אי-פעם). NC-ROAS = הכנסת לקוחות חדשים ÷ הוצאת פרסום; nCAC = הוצאת פרסום ÷ הזמנות חדשות."
            >
              <div className="text-[10.5px] uppercase tracking-[0.08em] text-ink-muted font-semibold">
                לקוחות חדשים · שאלה אחרת
              </div>
              <div className="flex items-end gap-6 mt-2">
                <div>
                  <div className="text-[10.5px] uppercase tracking-[0.08em] text-ink-muted font-semibold">
                    NC-ROAS
                  </div>
                  <bdi dir="ltr" className="block font-extrabold tabular-nums leading-[1.05] text-[1.5rem]">
                    {data.newCustomer.ncRoas != null ? (
                      <CountUp value={data.newCustomer.ncRoas} format={(n) => n.toFixed(2)} />
                    ) : (
                      '—'
                    )}
                  </bdi>
                </div>
                <div>
                  <div className="text-[10.5px] uppercase tracking-[0.08em] text-ink-muted font-semibold">
                    nCAC
                  </div>
                  <bdi dir="ltr" className="block font-extrabold tabular-nums leading-[1.05] text-[1.5rem]">
                    <Money value={data.newCustomer.nCac} prefix="$" compactAbove={1_000_000} />
                  </bdi>
                </div>
              </div>
              <div className="text-xs mt-1.5 text-ink-muted tabular-nums">
                <bdi dir="rtl">
                  {data.newCustomer.ncOrders.toLocaleString('en-US')} הזמנות חדשות ·{' '}
                  {(data.newCustomer.unclassifiableShare * 100).toFixed(0)}% לא מסווג
                </bdi>
              </div>
            </Card>
          </section>
```

### Step 9.8 — Run (expect PASS)
```
npx vitest run --config vitest.config.dom.ts src/components/home/__tests__/StoreDetailModal.dom.test.tsx
npx vitest run src/lib/home/__tests__/storeDetail.test.ts
npx tsc --noEmit
```
PASS.

### Step 9.9 — Commit
```
git add src/lib/home/storeDetail.ts src/lib/home/__tests__/storeDetail.test.ts src/components/home/StoreDetailModal.tsx src/components/home/__tests__/StoreDetailModal.dom.test.tsx
git commit -m "feat(store-modal): per-store NC-ROAS / nCAC row

toStoreDetail computes newCustomer from firstOrderRows scoped to the store +
cur.spend (mapping-aware MER); StoreDetailModal renders an own-band 'different
question' row (NC-ROAS + nCAC + unclassifiable share). Per-store cards untouched.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10 — Wire the hero + modal props in Dashboard.tsx

**Files**
- Modify: `src/components/Dashboard.tsx` (build `firstOrderRows` from `ordersData.rows`; pass `newCustomer` to `<CommandCenterHero>` `:997`; pass `firstOrderRows` into `toStoreDetail` `:809`).
- Test: none new (the adapters are unit-covered in Tasks 7 + 9; this is integration glue). Guard with `tsc` + the full suite.

### Step 10.1 — Impl
In `src/components/Dashboard.tsx`:

Add imports (top, alongside the existing `toStoreDetail` import at `:73`):

```ts
import { computeNewCustomerMetrics, type FirstOrderInput } from '@/lib/home/newCustomerMetrics';
```

Build a `firstOrderRows` memo near the `ordersByStore` memo (~`:299`). Each `OrderAttributionRow` already carries `storeName`, `totalCad`, `isFirstOrder` after Task 5:

```ts
  // Phase 3 — rows feeding the NC-ROAS / nCAC lens (hero + store modal).
  const firstOrderRows = useMemo<FirstOrderInput[]>(() => {
    const rows = ordersData?.rows ?? [];
    return rows.map((r) => ({
      storeName: r.storeName,
      totalCad: r.totalCad,
      isFirstOrder: r.isFirstOrder,
    }));
  }, [ordersData]);
```

Build the hero `newCustomer` value next to `heroPeriod` (~`:720`). MER spend = `filtered.curAgg.spend` (mapping-aware). Scope to the global store filter (undefined = all visible stores):

```ts
  const heroNewCustomer = useMemo(() => {
    const scope = filters.store === 'All' ? undefined : filters.store;
    return computeNewCustomerMetrics(firstOrderRows, filtered.curAgg.spend, scope);
  }, [firstOrderRows, filtered.curAgg.spend, filters.store]);
```

Pass it to the hero (at the `<CommandCenterHero ...>` render, ~`:997`) — add the prop:

```tsx
      <CommandCenterHero
        current={heroPeriod}
        delta={heroDelta}
        /* ...existing props... */
        newCustomer={heroNewCustomer}
      />
```

Pass `firstOrderRows` into the `toStoreDetail({ ... })` call (~`:809`) — add the field:

```ts
    return toStoreDetail({
      /* ...existing fields... */
      orders: ordersByStore[storeName] ?? 0,
      /* ... */
      firstOrderRows,
    });
```

> Worker note: locate the exact existing prop list at the `<CommandCenterHero>` JSX (it already passes `current`, `delta`, `rangeLabel`, `comparisonLabel`, `netSparkValues`, `secondarySparklines`, `updatedAt`) and the `toStoreDetail({...})` arg object; ADD the one new prop/field each without removing any existing one.

### Step 10.2 — Run (expect PASS)
```
npx tsc --noEmit
npx vitest run --config vitest.config.dom.ts src/components/home/__tests__/CommandCenterHero.dom.test.tsx src/components/home/__tests__/StoreDetailModal.dom.test.tsx
```
PASS.

### Step 10.3 — Full regression gate (mapping suites MUST stay green)
```
npx vitest run src/lib/fetchers/__tests__/tiktokFetcherStoreMapping.test.ts
npx vitest run src/lib/__tests__/campaignStoreMap.test.ts src/lib/__tests__/campaignProductMap.test.ts
npx vitest run src/lib/__tests__/productCentricViewSumConservation.test.ts src/lib/__tests__/cannibalizationDetection.test.ts
npx vitest run src/lib/__tests__/campaignsAggregator.test.ts
```
(If any path differs, locate via `find . -name '<name>.test.ts'` — all must PASS unchanged.)

Then the entire node + DOM suites:
```
npx vitest run
npx vitest run --config vitest.config.dom.ts
npx tsc --noEmit
```

### Step 10.4 — Commit
```
git add src/components/Dashboard.tsx
git commit -m "feat(home): wire NC-ROAS / nCAC into hero + store modal

Build firstOrderRows from ordersData; pass newCustomer to CommandCenterHero
(scoped to global store filter, MER spend = mapping-aware curAgg.spend) and
firstOrderRows into toStoreDetail. Per-store cards + gradients untouched.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Manual-verification checklist (operator, after merge — PRODUCTION only, no localhost)

1. **Apply migrations to prod** (operator):
   - `supabase db push` (or apply `20260602120000_orders_attribution_first_order.sql` + `20260602130000_recompute_first_order_flags.sql` via the Supabase SQL editor).
   - Confirm columns exist: `SELECT column_name FROM information_schema.columns WHERE table_name='orders_attribution' AND column_name IN ('customer_id','order_created_at','is_first_order');` → 3 rows.
   - Confirm index: `SELECT indexname FROM pg_indexes WHERE tablename='orders_attribution' AND indexname='idx_orders_attribution_store_customer';` → 1 row.
2. **Deploy** (push `main` per operator's git-push-only deploy trigger) and let the next `cron-daily` + `cron-live` ticks run.
3. **Forward-write check:** `SELECT count(*) FILTER (WHERE customer_id IS NOT NULL) AS with_cust, count(*) FILTER (WHERE customer_id IS NULL) AS guests FROM orders_attribution WHERE date >= current_date - 2;` → non-zero `with_cust`.
4. **Historical backfill (one-time):** run a throwaway script that, per store (`uzoshop`, `zolplus`, `usmile`), calls `runBulkFirstOrderBackfill(storeId)` and UPSERTs the resulting `Map<order_id, boolean|null>` into `orders_attribution.is_first_order` (keyed by `(store_id, order_id)`); then call `recompute_first_order_flags(store_id)` once per store to reconcile against forward-written rows. Confirm against production URLs only.
5. **Flag sanity:** for one store, `SELECT customer_id, count(*) AS orders, count(*) FILTER (WHERE is_first_order) AS firsts FROM orders_attribution WHERE store_id='uzoshop' AND customer_id IS NOT NULL GROUP BY customer_id HAVING count(*) > 1 LIMIT 5;` → each multi-order customer shows exactly `firsts = 1`.
6. **CAPI-safety grep:** `git grep -nE 'fbq|gtag|ttq|_fbq|snaptr' src/lib/fetchers/shopifyBulkFirstOrder.ts src/lib/home/newCustomerMetrics.ts` → ZERO matches. Confirm Meta/Google/TikTok Events Managers show NO new events post-deploy.
7. **UI check (prod dashboard):** Home hero shows the subordinate "לקוחות חדשים · שאלה אחרת" tile with NC-ROAS + nCAC + unclassifiable %, in its OWN band (may differ from the green/orange MER band) in BOTH light + dark. The main hero ROAS band gradient is UNCHANGED. Click a store card → the modal shows the per-store NC row. Per-store Home cards + gradients visually identical to before.
8. **Mapping regression (local, pre-push gate):** `npx vitest run` + `npx vitest run --config vitest.config.dom.ts` + `npx tsc --noEmit` all green, including every mapping suite listed in the locked constraints.
9. **Docs:** add the NC-ROAS / nCAC tile + per-store row + the first-order definition to the User Manual (UX change) and the new columns/RPC/Bulk-helper + dual-write to the Architecture Doc (pipeline change), per the two pre-push doc gates.
```

I've authored the complete plan. It is grounded in the actual current code: the attribution allowlist at `shopify.ts:1019` (vs the revenue/refund one at `:404`), the real `ShopifyOrderRow`/`ShopifyOrderPayload` shapes, both cron upsert maps (`cronDaily.ts:1419`, `cronLive.ts:682`) and their RPC-call patterns (`admin.rpc(...)`), the reader SELECT + row map (`postgresReaders.ts:1051`), the `OrderAttributionRow` type, the SQL function style from `agg_data_daily_for_date`, the next migration timestamps after `20260601120000`, and the house test patterns (mocked `global.fetch` + `mockOrdersResponse`, hoisted Supabase stubs, `@testing-library/react` DOM tests). The plan returned above is the verbatim markdown to save.