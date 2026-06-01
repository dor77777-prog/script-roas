# Real-Time Shopify Activity Feed — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.
> **Pause points:** 🛑 STOP 1 (after Phase 1) and 🛑 STOP 2 (after Phase 2) require operator-supplied
> Shopify secrets/setup — do NOT proceed past a STOP until the controller confirms the keys are in.

**Goal:** Replace the Home activity card with a real-time Shopify-webhook feed (sale + refund + add-to-cart) across 3 stores, with a LIVE badge wired to the webhook stream.

**Architecture:** Two ingest paths — `/api/webhooks/shopify` (HMAC server webhooks) + `/api/events/cart` (client beacon/pixel) → `store_events` (Supabase) → polled `/api/store-events` → `<ActivityFeed>`. Config in `store_webhooks` (no-redeploy). See `docs/superpowers/specs/2026-06-01-realtime-activity-feed-design.md`.

**Tech stack:** Next.js App Router (route handlers, `runtime='nodejs'`), `crypto` (HMAC), Supabase service-role (`getSupabaseAdmin()`), SWR, Tailwind tokens, vitest (+ jsdom config for DOM).

**Codebase anchors (don't re-discover):**
- Service-role client: `getSupabaseAdmin()` in `src/lib/supabaseAdmin.ts`.
- Middleware allowlist: `isDashboardAuthAllowlisted(pathname)` in `src/lib/middlewareHelpers.ts` (add the two ingest paths here).
- `stores` table: `id TEXT PK, name TEXT, …`.
- Money primitive: `src/components/ui/Money.tsx`; CAD convert: `cadConvert` (search `src/lib`).
- Current feed component: `ActivityFeed` (Home) — to be rebuilt; its campaign-status content relocates to `/operator`.
- DOM tests run via `vitest.config.dom.ts`; unit via default config.

---

## Phase 0 — Database

### Task 0.1: Migration — `store_webhooks` + `store_events`

**Files:**
- Create: `supabase/migrations/20260601120000_realtime_activity_feed.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Real-time Shopify activity feed (Task 2).
-- store_webhooks: per-store webhook routing + secrets (no-redeploy connect/disconnect).
CREATE TABLE IF NOT EXISTS store_webhooks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id          text NOT NULL REFERENCES stores(id),
  shop_domain       text NOT NULL UNIQUE,         -- xxx.myshopify.com (matches X-Shopify-Shop-Domain)
  signing_secret    text,                          -- server-webhook HMAC secret
  cart_public_token text,                          -- client cart beacon/pixel token
  allowed_origins   text[] NOT NULL DEFAULT '{}',  -- origin allowlist for the cart endpoint
  enabled           boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_store_webhooks_cart_token ON store_webhooks(cart_public_token);

-- store_events: normalized real-time events. dedupe_key makes inserts idempotent.
CREATE TABLE IF NOT EXISTS store_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        text NOT NULL REFERENCES stores(id),
  type            text NOT NULL CHECK (type IN ('sale','refund','add_to_cart')),
  amount_cad      numeric,
  currency        text,
  amount_original numeric,
  product_title   text,
  quantity        integer,
  customer_label  text,                           -- MASKED only (no raw PII)
  occurred_at     timestamptz NOT NULL,
  received_at     timestamptz NOT NULL DEFAULT now(),
  dedupe_key      text NOT NULL UNIQUE,
  raw             jsonb
);
CREATE INDEX IF NOT EXISTS idx_store_events_recent ON store_events(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_store_events_store_recent ON store_events(store_id, received_at DESC);

COMMENT ON TABLE store_webhooks IS 'Task 2 — per-store webhook routing + secrets (no-redeploy)';
COMMENT ON TABLE store_events IS 'Task 2 — real-time Shopify activity feed events (display-only)';
```

- [ ] **Step 2: Commit** (`feat(db): store_webhooks + store_events migration (Task 2)`).
  *(Application to prod happens at deploy/STOP-1 time — note in the controller's STOP-1 checklist.)*

---

## Phase 1 — Server webhook ingest (HMAC)

### Task 1.1: HMAC verify helper

**Files:**
- Create: `src/lib/webhooks/shopifyHmac.ts`
- Test: `src/lib/webhooks/__tests__/shopifyHmac.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyShopifyHmac } from '../shopifyHmac';

const secret = 'shpss_test_secret';
const body = '{"id":123,"total_price":"50.00"}';
const goodSig = createHmac('sha256', secret).update(body, 'utf8').digest('base64');

describe('verifyShopifyHmac', () => {
  it('accepts a correct signature', () => {
    expect(verifyShopifyHmac(body, goodSig, secret)).toBe(true);
  });
  it('rejects a wrong signature', () => {
    expect(verifyShopifyHmac(body, 'AAAA', secret)).toBe(false);
  });
  it('rejects when secret is empty/null', () => {
    expect(verifyShopifyHmac(body, goodSig, '')).toBe(false);
  });
  it('rejects a tampered body', () => {
    expect(verifyShopifyHmac(body + ' ', goodSig, secret)).toBe(false);
  });
});
```

- [ ] **Step 2: Implement**

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Constant-time verify of Shopify's X-Shopify-Hmac-Sha256 (base64) over the RAW body. */
export function verifyShopifyHmac(rawBody: string, headerSig: string | null, secret: string | null | undefined): boolean {
  if (!headerSig || !secret) return false;
  const digest = createHmac('sha256', secret).update(rawBody, 'utf8').digest(); // Buffer
  let provided: Buffer;
  try {
    provided = Buffer.from(headerSig, 'base64');
  } catch {
    return false;
  }
  if (provided.length !== digest.length) return false;
  return timingSafeEqual(digest, provided);
}
```

- [ ] **Step 3: Run tests → green. Commit.**

### Task 1.2: Event normalization (payload → store_events fields)

**Files:**
- Create: `src/lib/webhooks/normalizeShopifyEvent.ts`
- Test: `src/lib/webhooks/__tests__/normalizeShopifyEvent.test.ts`

Responsibilities (TDD each):
- `topicToType('orders/create') → 'sale'`, `'refunds/create' → 'refund'`, else `null` (ignore).
- Map order payload → `{ amount_original, currency, product_title, quantity, customer_label, occurred_at, dedupe_key }`.
- `amount_cad` via `cadConvert(amount_original, currency)` (reuse existing; if FX unavailable → null, keep original).
- `product_title` = first line item title (+ qty); refunds → the refunded line item / total.
- `customer_label` MASKED: initials from `customer.first_name`/`last_name` (e.g. "א׳ כ׳") or `null` — NEVER raw name/email/address.
- `dedupe_key` = `webhook:${X-Shopify-Webhook-Id}` (passed in).
- Trim `raw` to non-PII fields (id, total_price, currency, line_items[].{title,quantity}, created_at).

Write tests for: topic mapping, sale mapping, refund negative amount, PII masking (no raw email/name in output), missing-customer → null label.

- [ ] Steps: failing tests → implement → green → commit.

### Task 1.3: `store_webhooks` reader + `store_events` writer

**Files:**
- Create: `src/lib/webhooks/store.ts`
- Test: `src/lib/webhooks/__tests__/store.test.ts` (mock `getSupabaseAdmin`)

- `lookupStoreByShopDomain(shopDomain)` → `{ store_id, signing_secret, enabled } | null` (from `store_webhooks`).
- `lookupStoreByCartToken(token)` → `{ store_id, allowed_origins, enabled } | null`.
- `insertStoreEvent(event)` → upsert on `dedupe_key` (ignore conflict → idempotent). Returns inserted|deduped.

- [ ] Steps: failing tests (mocked client) → implement → green → commit.

### Task 1.4: The webhook route

**Files:**
- Create: `src/app/api/webhooks/shopify/route.ts`
- Test: `src/app/api/webhooks/shopify/__tests__/route.test.ts`

- [ ] **Step 1: Implement the route**

```ts
import { NextResponse } from 'next/server';
import { verifyShopifyHmac } from '@/lib/webhooks/shopifyHmac';
import { topicToType, normalizeOrderEvent } from '@/lib/webhooks/normalizeShopifyEvent';
import { lookupStoreByShopDomain, insertStoreEvent } from '@/lib/webhooks/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  // 1. RAW body FIRST (HMAC is over exact bytes — never req.json() before this).
  const raw = await req.text();
  const shop = req.headers.get('x-shopify-shop-domain');
  const topic = req.headers.get('x-shopify-topic');
  const webhookId = req.headers.get('x-shopify-webhook-id');
  const sig = req.headers.get('x-shopify-hmac-sha256');

  if (!shop || !topic || !webhookId) return NextResponse.json({ ok: true }, { status: 200 }); // ack+drop malformed

  const store = await lookupStoreByShopDomain(shop);
  // Unknown or disabled store → 200 ack + drop (so Shopify stops retrying).
  if (!store || !store.enabled) return NextResponse.json({ ok: true }, { status: 200 });

  if (!verifyShopifyHmac(raw, sig, store.signing_secret)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  const type = topicToType(topic);
  if (!type) return NextResponse.json({ ok: true }, { status: 200 }); // topic we don't surface

  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return NextResponse.json({ ok: true }, { status: 200 }); }

  const event = normalizeOrderEvent(type, payload, { storeId: store.store_id, webhookId });
  if (event) await insertStoreEvent(event); // idempotent on dedupe_key

  // Ack fast (<5s). Keep all work above minimal.
  return NextResponse.json({ ok: true }, { status: 200 });
}
```

- [ ] **Step 2: Tests** (construct a raw body + real HMAC with a mocked store secret; assert: valid → insert called; bad sig → 401; unknown shop → 200 no insert; non-surfaced topic → 200 no insert; dedup → single insert). Mock `lookupStoreByShopDomain` + `insertStoreEvent`.
- [ ] **Step 3: green → commit.**

### Task 1.5: Middleware allowlist

**Files:**
- Modify: `src/lib/middlewareHelpers.ts` (`isDashboardAuthAllowlisted`)
- Test: extend `src/lib/__tests__/middlewareHelpers*.test.ts`

- [ ] Add before the final `return false;`:

```ts
  // Task 2 — Shopify ingest endpoints. Shopify/browsers can't present the
  // dashboard cookie; these authenticate via HMAC (webhook) / per-store token
  // + origin (cart) at the route level instead.
  if (pathname === '/api/webhooks/shopify') return true;
  if (pathname === '/api/events/cart') return true;
```

- [ ] Add tests asserting both paths are allowlisted and a random `/api/x` is not. Run → green → commit.

### 🛑 STOP 1 — operator connects the webhooks
Controller hands the operator (generated at execution time): for **each** store, Shopify admin → **Settings → Notifications → Webhooks** → create `orders/create` + `refunds/create` (JSON) pointed at `https://<prod>/api/webhooks/shopify`; copy the **signing secret** (shown once at the bottom of the Webhooks section) + the **myshopify.com domain**. Then the controller runs the `store_webhooks` INSERT (one row per store with `shop_domain` + `signing_secret`) and applies the Phase-0 migration to prod. **Do not start Phase 2 until confirmed.**

---

## Phase 2 — Add-to-cart ingest (client)

### Task 2.1: Cart endpoint
**Files:** Create `src/app/api/events/cart/route.ts` (+ tests), reuse `lookupStoreByCartToken` + `insertStoreEvent`.
- `runtime='nodejs'`. Body `{ store_token, product_title, quantity, event_id, occurred_at }`.
- Auth: token → store (enabled); `Origin`/`Referer` ∈ `allowed_origins`; per-store+IP rate-limit (in-memory token bucket or a `store_events`-count guard). Fail → `204` (never reveal).
- Insert `add_to_cart` (dedupe_key `cart:${event_id}`). Ack `204`.
- Tests: valid → insert; bad token → no insert; bad origin → no insert; dedup; rate-limit.

### Task 2.2: Snippets (delivered to operator, not shipped code)
- **Custom Pixel** (uzoshop, Zol Plus): a `analytics.subscribe('product_added_to_cart', …)` snippet that `fetch`es the cart endpoint with the store token. Controller generates with each store's token.
- **Lovable beacon** (usmile): a small fetch on add-to-cart in the Lovable frontend. Controller provides exact code.

### 🛑 STOP 2 — operator installs pixel + beacon
Controller hands: paste the Custom Pixel in uzoshop + Zol Plus (Settings → **Customer events** → Add custom pixel); add the beacon to Lovable; controller sets `cart_public_token` + `allowed_origins` per store. **Do not start Phase 3's go-live until confirmed** (Phase 3 UI can be built in parallel).

---

## Phase 3 — Read API + Feed UI

### Task 3.1: `GET /api/store-events`
**Files:** Create `src/app/api/store-events/route.ts` (+ tests).
- ISR/edge `revalidate ~10`. Returns `{ events: [...latest 50], serverNow, lastReceivedAt }`, optional `?store=`. Gated (normal cookie). Newest-first.

### Task 3.2: `<ActivityFeed>` rebuild
**Files:** Modify the Home `ActivityFeed`; add `src/components/home/__tests__/ActivityFeed.dom.test.tsx`.
- SWR poll `refreshInterval: 12_000`. Rows = lucide glyph (sale=green/refund=red/cart=blue tokens) · type · `<Money>` (CAD) · product (truncate) · store chip · relative time. `<bdi>` numbers, AA both themes, reduced-motion slide-in.
- **LIVE badge** from `lastReceivedAt`/`serverNow` + SWR error: 🟢 listening · ⚪ idle · 🔴 disconnected (SWR error). Pulse + last-event time.
- DOM tests: renders 3 event types; LIVE states; reduced-motion; RTL; `<Money>` overflow; empty/listening state.

### Task 3.3: Relocate campaign-status feed (no info loss)
**Files:** Move the current status-event list into a `/operator` panel ("פעילות סטטוס קמפיינים"); add a pointer. Keep its tests.

### Task 3.4: Hermetic guards
- Extend contrast guard for the 3 glyph tones (both themes).
- Guard: webhook + cart routes export `runtime='nodejs'` and are in `isDashboardAuthAllowlisted`.

---

## Phase 4 — Go-live verify + deploy
- Apply migration to prod (if not at STOP 1). Confirm `store_webhooks` rows present + enabled.
- Operator triggers a **test event** per store (a $0.01 order / small refund / add-to-cart). Confirm the feed lights up + LIVE pulses (chrome-devtools, both themes).
- Run all gates (tsc, unit, DOM, build, lint, docs-currency). User Manual + ARCHITECTURE updates.
- **Deploy** (`git push origin main`) — SEPARATE from Tasks 1/1.5.

---

## Self-review notes
- Spec coverage: all spec §4 components map to tasks (4.1→0.1, 4.2→0.1, 4.3→1.x, 4.4→2.1, 4.5→3.1, 4.6→3.2, 4.7→1.5). ✓
- Type consistency: `store_events` columns ↔ `normalizeShopifyEvent` output ↔ `insertStoreEvent` arg — keep identical field names across Tasks 0.1/1.2/1.3. ✓
- No placeholders in Phase 0–1 (full code). Phases 2–4 are task-level with key code; they're post-STOP and finalize with operator-specific values at execution.
