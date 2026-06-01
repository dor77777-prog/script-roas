# Real-Time Shopify Activity Feed — Design Spec

**Date:** 2026-06-01
**Status:** Approved design (mockup approved) → ready for implementation plan
**Mockup:** `docs/superpowers/mockups/2026-06-01-activity-feed/activity-feed-mockup.html`

---

## 1. Goal

Replace the Home **"פעילות אחרונה"** card with a **real-time activity feed** fed by **Shopify webhooks** across all 3 stores. v1 surfaces three event types — **Sale** (`orders/create`), **Refund** (`refunds/create`), and **Add-to-cart** — newest-first, each row showing *type · amount · product · store · time*. A **LIVE badge** reflects the **webhook stream's actual listening state** (pulse-on-event + last-event time), making it visibly real-time, distinct from the rest of the dashboard's ~10-min cadence.

The whole thing must be **flexible**: connect / disconnect / change / **add stores with no redeploy**.

## 2. Scope

**In (v1):**
- Sale + Refund via server webhooks (all 3 stores).
- Add-to-cart via **Web Pixel** (standard stores: uzoshop, Zol Plus) + **client beacon** (headless usmile, frontend in Lovable).
- `store_webhooks` config table (no-redeploy connect/disconnect/add).
- `store_events` storage + a polled read API + the feed UI with the LIVE badge.

**Out (v1 — deferred / explicitly excluded):**
- Shipped (`fulfillments/create`) + New-customer (`customers/create`) — operator deferred (easy to add later: same webhook path + a new `type`).
- Supabase Realtime / WebSockets (we poll an ISR route — matches the existing trust model).
- A custom Shopify App / OAuth / mandatory GDPR webhooks (admin-UI webhooks need none of that).

## 3. Architecture

```
                        ┌─────────────────── Shopify (×3 stores) ───────────────────┐
                        │  Admin webhooks: orders/create, refunds/create  (server)  │
                        │  Custom Pixel: product_added_to_cart            (browser)  │  ← standard stores
                        └───────────────┬───────────────────────┬───────────────────┘
   Lovable frontend (usmile, headless) ─┘ (add-to-cart beacon)   │
                                        ▼                         ▼
                        POST /api/events/cart            POST /api/webhooks/shopify
                        (public token + origin           (HMAC-SHA256 over RAW body,
                         allowlist + rate-limit)          per-store signing secret,
                                        │                  X-Shopify-Shop-Domain route,
                                        │                  X-Shopify-Webhook-Id dedup)
                                        └─────────┬─────────┘
                                                  ▼
                                        store_events  (Supabase)
                                                  ▼
                                   GET /api/store-events  (ISR/edge, ~10s revalidate)
                                                  ▼
                                   <ActivityFeed>  SWR poll ~10–15s + LIVE badge
```

Two ingest paths because server webhooks can be HMAC-signed but **client-reported** add-to-cart cannot (a signing secret in browser JS would leak): cart events get a **lighter auth** (per-store public token + `Origin`/`Referer` allowlist + rate-limit). That is acceptable for a *feed* (display only, never billing).

## 4. Components

### 4.1 `store_webhooks` (config — no-redeploy)
One row per **(store, channel)**. Holds the routing + secrets so connecting/disconnecting a store is a row edit, never a deploy.

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `store_id` | text → `stores.id` | which store |
| `shop_domain` | text unique | `xxx.myshopify.com` — matched against `X-Shopify-Shop-Domain` |
| `signing_secret` | text | webhook HMAC secret (server webhooks) |
| `cart_public_token` | text | public token for the cart beacon/pixel (client) |
| `allowed_origins` | text[] | origin allowlist for the cart endpoint |
| `enabled` | boolean default true | disconnect = flip to false |
| `created_at` / `updated_at` | timestamptz | |

> Routing: webhook → look up by `shop_domain`; cart → look up by `store_id` + verify `cart_public_token` + `Origin ∈ allowed_origins`. A disabled row → `200` ack + drop (so Shopify stops retrying) but no insert.

### 4.2 `store_events` (storage)
Normalized events, dedup pattern mirrors `campaign_status_events`.

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `store_id` | text → `stores.id` | |
| `type` | text | `sale` \| `refund` \| `add_to_cart` |
| `amount_cad` | numeric null | sale/refund only (CAD — §7) |
| `currency` | text null | original presentment currency |
| `amount_original` | numeric null | original amount (title/sr-only) |
| `product_title` | text null | first line item (+ `qty`) |
| `quantity` | int null | |
| `customer_label` | text null | **masked** (§7) — e.g. "א׳ כ׳" or city, never raw PII |
| `occurred_at` | timestamptz | Shopify event time (sale: `created_at`) |
| `received_at` | timestamptz default now() | when we ingested (drives LIVE freshness) |
| `dedupe_key` | text unique | `${channel}:${external_id}` (webhook-id / order-id / pixel event id) |
| `raw` | jsonb | trimmed payload for audit |

Unique `dedupe_key` → idempotent inserts (Shopify retries + double pixel fires are no-ops).

### 4.3 `POST /api/webhooks/shopify` (server webhooks)
- **Runtime: `nodejs`** (needs the raw body + `crypto.timingSafeEqual`).
- Read the **raw** body (no JSON pre-parse — HMAC is over exact bytes).
- `shop = X-Shopify-Shop-Domain` → look up `store_webhooks` (enabled). Unknown/disabled → `200` (ack, drop).
- Verify `X-Shopify-Hmac-Sha256` = base64(HMAC-SHA256(raw, signing_secret)), **constant-time**. Mismatch → `401`.
- `topic = X-Shopify-Topic` → map `orders/create`→sale, `refunds/create`→refund.
- Dedup on `X-Shopify-Webhook-Id`. Insert `store_events`. **Ack `200` in <5s** (Shopify retries 8×/4h otherwise — keep work minimal, defer nothing heavy).

### 4.4 `POST /api/events/cart` (client beacon / Web Pixel)
- Body: `{ store_token, product_title, quantity, event_id, occurred_at }`.
- Auth: look up store by `cart_public_token == store_token` (enabled) + `Origin`/`Referer` ∈ `allowed_origins` + **rate-limit per store/IP**.
- Dedup on `event_id`. Insert `store_events` type `add_to_cart` (no amount). Ack `204`.
- **Trust note:** client-reported, spoofable → display-only, never feeds billing/aggregates. Documented in code + spec.

### 4.5 `GET /api/store-events` (read)
- ISR/edge, `revalidate ~10s`. Returns the latest N (≈50) events, optional `?store=` filter, newest-first. Includes a `serverNow` + `lastReceivedAt` so the client can compute the LIVE freshness without clock skew.
- Behind the password gate like every other read route.

### 4.6 `<ActivityFeed>` UI (replaces current card)
- SWR poll every **~10–15s** (`refreshInterval`), newest-first list. New rows get the slide-in animation (respects `prefers-reduced-motion`).
- **LIVE badge** states from `lastReceivedAt` vs `serverNow`:
  - 🟢 **listening** (pulsing) — default while the poll is succeeding.
  - ⚪ **connected, idle** — no events in the lookback window (still pulsing softly / "מאזין").
  - 🔴 **disconnected** — the read route itself is failing (SWR error) → "נותק".
  - Shows last-event relative time ("לפני 4ש").
- Rows: lucide icon in a token-tinted glyph (sale=green, refund=red, cart=blue) · type · `<Money>` amount (CAD, overflow-safe) · product (truncate) · store chip · relative time. Token-driven, AA both themes, `<bdi>` for numbers.
- Optional `store` filter follows the page scope (like the current feed).

### 4.7 Middleware
Allowlist `/api/webhooks/shopify` and `/api/events/cart` in the password-gate middleware (Shopify/!browsers can't present the cookie). Everything else stays gated.

## 5. Security model
- **Server webhooks:** HMAC-SHA256 over raw body, per-store secret, constant-time compare. The signing secret never leaves the server.
- **Cart events:** per-store public token + origin allowlist + rate-limit. Low-trust by design → display-only.
- **Secrets at rest:** `store_webhooks.signing_secret` / `cart_public_token` in DB (service-role-only table; not exposed via any gated read route). No secret in client bundles or env (no-redeploy goal).
- **PII:** never store raw email/name/address. `customer_label` is masked (initials or city). `raw` is trimmed to non-PII fields needed for audit.

## 6. Data flow
- **Sale:** customer checks out (Shopify-hosted, incl. headless usmile) → `orders/create` → HMAC verify → insert `sale` (amount_cad, product, store, occurred_at) → poll surfaces it → LIVE pulses.
- **Refund:** merchant/customer refund → `refunds/create` → insert `refund` (−amount).
- **Add-to-cart:** standard stores fire the Custom Pixel `product_added_to_cart` → beacon to `/api/events/cart`; headless usmile's Lovable frontend calls the same endpoint → insert `add_to_cart`.

## 7. Currency & numbers
Per [[ad-account-currencies]] Shopify is **CAD** for these stores, and the dashboard displays everything in CAD. The feed shows **CAD** via the existing `cadConvert` (original currency + amount preserved in `title`/`sr-only`). All money renders through the shared `<Money>` primitive (tabular-nums, compact-floor, never clipped).

## 8. No information loss
The card currently shows **campaign-status events** (ENABLE/DISABLE/BACKFILL from the registries). Per [[no-info-loss-across-tabs]] that content is **relocated, not deleted** — it moves to the **/operator** page (a "סטטוס קמפיינים — פעילות" panel) where the operational audience already lives. The plan includes that move + a pointer so nothing is lost.

## 9. Phased delivery + STOP-for-keys checkpoints

| Phase | Work | Keys needed? |
|---|---|---|
| **0** | Migrations: `store_webhooks` + `store_events` (+ indexes, dedupe unique). | No |
| **1** | `/api/webhooks/shopify` (HMAC) + middleware allowlist + unit tests (synthetic HMAC, dedup, masking). | No |
| **🛑 STOP 1** | **Operator:** in each store's Shopify admin → Settings → Notifications → Webhooks, create `orders/create` + `refunds/create` pointing at the endpoint; copy the **signing secret** + **myshopify domain**. I provide exact click-path + the `store_webhooks` INSERT SQL. | **Yes — secrets + domains** |
| **2** | `/api/events/cart` + the Custom-Pixel snippet (standard stores) + the Lovable beacon snippet (usmile) + tests. | No (code) |
| **🛑 STOP 2** | **Operator:** paste the Custom Pixel in uzoshop + Zol Plus (Settings → Customer events); add the beacon to the Lovable frontend (I provide code); set per-store `cart_public_token` + `allowed_origins`. | **Yes — install + tokens** |
| **3** | `/api/store-events` read route + `<ActivityFeed>` rebuild + LIVE badge + relocate status feed to /operator. DOM tests (rows, LIVE states, RTL, AA). | No |
| **4** | Prod verify (place a $0.01 test order / trigger a refund / add-to-cart) → confirm the feed lights up → **deploy** (separate from Tasks 1/1.5). | Operator triggers a test event |

Phases 0–1 and 2 ship code behind dormant config (no live data until STOP 1/2 are done), so we can build + merge incrementally and the feed simply shows the "listening, no events" state until webhooks are connected.

## 10. Testing
- **Unit:** HMAC verify (valid/invalid/constant-time), dedup idempotency, topic→type mapping, PII masking, cart token + origin auth, rate-limit.
- **DOM:** feed renders sale/refund/cart rows; LIVE badge listening/idle/disconnected states; reduced-motion; RTL + `<bdi>` numbers; `<Money>` overflow-safety; AA contrast for the three glyph tones both themes.
- **Hermetic guards:** extend the contrast guard for the new glyph tones; a guard that the webhook + cart routes are `nodejs` runtime + middleware-allowlisted.
- **Live:** the Phase-4 prod test event(s); reconcile a sale event against `orders-attribution` for sanity.

## 11. Future (v1.1+)
Shipped + New-customer events (trivial add), per-store sound/desktop notification, a "today's events" mini-counter, optional Realtime upgrade if polling ever feels laggy.
