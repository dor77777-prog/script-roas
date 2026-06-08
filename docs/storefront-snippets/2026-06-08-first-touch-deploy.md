# First-Touch Attribution — Operator Deploy Guide (2026-06-08)

This guide explains exactly what to paste in each store so that first-touch UTM data flows into orders. After deploying you should see per-campaign attribution certainty rise and `first_utm_id` coverage increase (especially for usmile360, which starts at 0% until this is deployed).

> **DO NOT paste any real tokens into this file.** Every occurrence of `<STORE_CART_TOKEN>` is a placeholder — replace it with the store's actual `cart_public_token` only in the Shopify Admin UI, never in a committed file.

---

## Themed stores: uzoshop and Zol Plus

Each themed store needs two pieces deployed: the Custom Pixel (primary — already existed; re-paste for latest version) and the new theme snippet (secondary — new as of 2026-06-08).

### Step 1 — Custom Pixel (primary, updated)

**What it does:** fires a `first_touch` bag to `/api/events/cart` on every add-to-cart. Powers the `first_touch_source` label shown in the activity feed and feeds `firstUtmSource` on the `store_events` row.

**Where to paste:** Shopify Admin → Settings → Customer events → (edit or replace the existing custom pixel).

Full, up-to-date snippet: see `docs/storefront-snippets/first-touch-attribution.md`, **Section 1**. Remember to replace `<STORE_CART_TOKEN>` at the top of the snippet with the store's actual `cart_public_token`.

> uzoshop and Zol Plus each have a different `cart_public_token`. Do not mix them.

### Step 2 — Theme snippet: `_ft_*` cart attributes (new — Section 1b)

**What it does:** writes the first-touch UTM as `_ft_*` Shopify cart attributes via `/cart/update.js` so the attributes ride into the order's `note_attributes`. The nightly Shopify fetcher reads `_ft_*` and populates `first_utm_*` on `orders_attribution`, enabling per-campaign/ad first-touch matching in the analyzer.

**Why a theme snippet and not the Custom Pixel:** Shopify Custom Pixels run in a sandboxed iframe and cannot call the Cart AJAX API (`/cart/update.js`). The theme snippet runs in the real page context and can write cart attributes. The two snippets share the same `localStorage._ft_attr` key — the Custom Pixel writes the key, the theme snippet reads it.

**Where to paste:** Shopify theme editor → `theme.liquid`, immediately **before** `</body>`.

Full, up-to-date snippet: see `docs/storefront-snippets/first-touch-attribution.md`, **Section 1b**.

The snippet contains no `<STORE_CART_TOKEN>` — it talks only to `/cart/update.js` (same-origin) and does not need the store token.

**Canonical cart attribute keys written:**

| Cart attribute key | Order writer field |
|---|---|
| `_ft_utm_id` | `firstUtmId` |
| `_ft_utm_campaign` | `firstUtmCampaign` |
| `_ft_utm_source` | `firstUtmSource` |
| `_ft_utm_medium` | `firstUtmMedium` |
| `_ft_utm_content` | `firstUtmContent` |
| `_ft_utm_term` | `firstUtmTerm` |
| `_ft_fbclid` | `firstFbclid` |
| `_ft_gclid` | `firstGclid` |
| `_ft_ttclid` | `firstTtclid` |
| `_ft_set_at` | (freshness timestamp, not stored in DB) |

---

## Headless store: usmile360 (Lovable + Storefront API)

usmile360 has no `theme.liquid`. First-touch `_ft_*` cart attributes are written at cart-creation / checkout via the Storefront API `cartCreate(input: { attributes })` or `cartAttributesUpdate(cartId, attributes)`.

Full code: see `docs/storefront-snippets/first-touch-attribution.md`, **Section 2**.

### What to deploy

**Part A — Lovable client (first-touch capture):** add the first-touch capture block on app load (before any router logic). It writes `localStorage._ft_attr` from the landing-page query string (guarded — first visit only, never overwritten in the same browser session). When creating or updating the cart, build the `_ft_*` attribute array from the stored bag and pass it to the Storefront API. See Section 2 for the exact code block.

**Part B — Edge function `roas-cart-event`:** forward `landing_site`, `first_touch`, and `product_id` from the client payload to `/api/events/cart`. The `ROAS_STORE_TOKEN` (`<STORE_CART_TOKEN>`) must stay in the edge function's **server-side** env var (`ROAS_STORE_TOKEN`) — never send it to or from the client. See Section 2, Part B for the exact forwarding shape.

---

## Smoke test (all stores)

After deploying to a store, run this test on that store to confirm the full chain works:

1. Open the store URL with an explicit UTM in the query string, for example:
   ```
   https://<store-domain>/products/<any-handle>?utm_id=123&utm_campaign=Test&utm_source=test&utm_medium=test
   ```
2. Add any product to the cart.
3. Complete a **test order** (use Shopify's test payment gateway or Bogus Gateway).
4. Open the Shopify Admin for that order → scroll to "Additional details" / "Note" / "Attributes".
   - Confirm that `_ft_utm_id`, `_ft_utm_campaign`, `_ft_utm_source` etc. are listed under the order's note attributes.
5. After the next nightly cron run (or trigger a manual `cron-daily` sync from `/operator`), open the dashboard's **"לקוחות"** tab → per-order attribution. The test order should show a `first_utm_id = 123` value and be attributed to the "Test" campaign at first-touch.

> **Coverage check:** open `/operator` → "אבחון ייחוס" panel. Filter to the store you just deployed. The `first_utm_id` coverage % should rise (usmile360 starts near 0% — any improvement confirms the Storefront API write is working).

---

## Phase 2 (optional): Shopify customer-journey gap-fill

If you want Shopify's own first/last-visit data to fill in any remaining UTM gaps (orders that have no `_ft_*` attributes AND no last-click UTM), you can enable the `customerJourneySummary` GraphQL reader:

1. **Request Protected Customer Data access** in each store's Shopify custom app:
   - Shopify Partner Dashboard → Apps → select the custom app → "App setup" → "Protected Customer Data access" → request access.
   - You need this approved for all three stores (uzoshop, Zol Plus, usmile360).
2. Once approved, add the Vercel environment variable:
   ```
   ENABLE_SHOPIFY_CUSTOMER_JOURNEY=1
   ```
   (set this in Vercel → Project Settings → Environment Variables for the Production environment).
3. Redeploy or trigger a re-fetch — the reader will activate automatically.

**Safety invariants (won't change existing data):**
- The reader only fills fields that are `null` on the `orders_attribution` row — it **never overwrites** a value that was already populated via `note_attributes` / `_ft_*` cart attributes.
- The `source` field (the deterministic platform classification) is **never touched** by this reader.
- If Protected Customer Data access is not yet approved, the reader detects the `UNAUTHORIZED` response, returns an empty map, and logs a single warning — no error, no regression.
- When the flag is absent/off, **zero network requests** are made and all `orders_attribution` rows are produced identically to before.
