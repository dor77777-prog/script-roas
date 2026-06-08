# First-Touch Attribution Capture — Storefront Snippets

These snippets are **operator-deployed to storefronts only** — they do not live in this repo and are not run by CI. Copy-paste them as described below. Once deployed, add-to-cart events sent to `/api/events/cart` will carry a `landing_site` query-string that the API uses to classify the ad-platform source badge shown in the activity feed.

---

## Section 1 — Shopify Custom Pixel (uzoshop, Zol Plus)

**Where to paste:** Shopify Admin → Settings → Customer events → Add custom pixel.

> ⚠️ **Shopify Custom Pixels run in a sandboxed iframe** — the native `localStorage`, `window`, and `document` are NOT accessible there. Touching `localStorage` **throws and silently kills the whole handler** (no beacon fires → no events). So do NOT use `localStorage` here. Instead we read the entry UTM/click-id straight from the **pixel event's own context URL** (`event.context.document.location`) at add-to-cart time — no storage needed. `fetch` IS available in the sandbox; `keepalive: true` + `.catch(()=>{})` keep it fire-and-forget so it **never blocks add-to-cart**.

We capture **first-touch**: on `page_viewed` we persist the entry UTM/click-id via Shopify's **async `browser.localStorage`** Standard API (the only storage that works in the sandbox; it survives navigation). On `product_added_to_cart` we prefer the current URL's UTM and fall back to the persisted first-touch — this is required because some themes redirect to `/cart` on add (non-AJAX), so the add-to-cart event's URL no longer carries the UTM (observed: uzoshop = AJAX, keeps the UTM in-URL → works on current-URL alone; Zol Plus = redirect → needs the first-touch fallback).

Set `CART_TOKEN` at the top to each store's `cart_public_token` (uzoshop and Zol Plus each have their own) — and **use the `CART_TOKEN` const in the body** (a common mistake is leaving the literal `"<STORE_CART_TOKEN>"` placeholder in `store_token`, which makes every event drop).

```js
const CART_TOKEN = "<STORE_CART_TOKEN>";

// First-touch capture — persist the entry UTM/click-id (survives navigation to /cart).
analytics.subscribe("page_viewed", async (event) => {
  try {
    var loc = (event.context && event.context.document && event.context.document.location) || {};
    var search = loc.search || "";
    if (/(utm_|fbclid|gclid|ttclid)/i.test(search)) {
      var existing = await browser.localStorage.getItem("_ft_attr");
      if (!existing) await browser.localStorage.setItem("_ft_attr", search);
    }
  } catch (e) {}
});

analytics.subscribe("product_added_to_cart", async (event) => {
  try {
    var loc = (event.context && event.context.document && event.context.document.location) || {};
    var landing = loc.search || "";
    // First-touch bag (entry UTM/click-id persisted on page_viewed). Best-effort:
    // a missing/invalid _ft_attr is simply omitted — never blocks add-to-cart.
    var firstTouch = null;
    try { firstTouch = await browser.localStorage.getItem("_ft_attr"); } catch (_) {}
    if (!/(utm_|fbclid|gclid|ttclid)/i.test(landing)) {
      if (firstTouch) landing = firstTouch;
    }
    if (!landing) landing = "/";
    var d = event.data || {};
    var line = d.cartLine || {};
    var title =
      (line.merchandise && line.merchandise.product && line.merchandise.product.title) ||
      (d.productVariant && d.productVariant.product && d.productVariant.product.title) ||
      null;
    // Product id (the Product GID, e.g. gid://shopify/Product/7654321). Best-effort:
    // missing → omitted. The dashboard normalizes the GID to the numeric Shopify
    // Product id so per-product ATC↔purchase joins match by id (not by title).
    var productId =
      (line.merchandise && line.merchandise.product && line.merchandise.product.id) ||
      (d.productVariant && d.productVariant.product && d.productVariant.product.id) ||
      null;
    var qty = line.quantity || 1;
    var payload = {
      store_token: CART_TOKEN,
      event_id: event.id || String(event.timestamp || Date.now()),
      product_title: title,
      quantity: qty,
      occurred_at: event.timestamp || new Date().toISOString(),
      landing_site: landing
    };
    // Send the stored first-touch bag so the dashboard can compute first-click
    // attribution (boosts first-touch coverage). Omitted when absent.
    if (firstTouch) payload.first_touch = firstTouch;
    // Send the product id (GID) so the dashboard can join ATC↔purchases by id.
    // Omitted when absent — never blocks add-to-cart.
    if (productId) payload.product_id = productId;
    fetch("https://roas-dashboard-smoky.vercel.app/api/events/cart", {
      method: "POST",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }).catch(function () {});
  } catch (e) {}
});
```

> **First-touch (2026-06-07):** the beacon now ALSO sends the stored `_ft_attr`
> bag as a `first_touch` field. The cart route folds it into the attribution
> classifier and records a `firstTouchSource` label on the event (powers the
> first-click lens). **Existing stores must RE-PASTE this updated Custom Pixel**
> for the first-touch field to start flowing — newly-added stores get it
> automatically from the wizard's generated snippet.

> **Product id (2026-06-08, PPJ-T1):** the beacon now ALSO sends the cart line's
> product id (the Product **GID**, e.g. `gid://shopify/Product/7654321`) as a
> `product_id` field. The cart route NORMALIZES it to the bare numeric Shopify
> Product id (`7654321`) and stores it in `raw.product_id`, so the per-product
> table can join add-to-cart events to purchases EXACTLY by id (matching
> `orders_attribution.line_items` productId and `products_daily.product_id`)
> instead of by fragile title-matching (which split Hebrew/variant names into two
> rows). Best-effort: a missing/unparseable id is omitted, never blocking
> add-to-cart. **Existing stores must RE-PASTE this updated Custom Pixel** for the
> product_id field to start flowing — newly-added stores get it automatically.

> **If you already pasted the earlier `localStorage` version into uzoshop / Zol Plus, REPLACE it with the snippet above** — the old one throws in the sandbox and stops all cart events from those stores.

---

## Section 1b — Theme snippet: `_ft_*` cart attributes

**Where to paste:** Shopify theme editor → `theme.liquid`, immediately before `</body>`. **Do NOT paste this in the Custom Pixel** — Custom Pixels run in a sandboxed iframe and cannot write Shopify cart attributes.

The Shopify Custom Pixel (Section 1) captures first-touch UTM/click-ids but cannot update the cart because of sandbox restrictions. This theme snippet fills that gap: it runs in the real page context, reads the same `localStorage._ft_attr` key the Custom Pixel writes, and syncs the first-touch data as `_ft_*` cart attributes via the Shopify Cart AJAX API (`/cart/update.js`). Those attributes flow into the order's `note_attributes`, which the dashboard's order writer (`classifyOrderSource`) already reads (it strips the leading `_` → `ft_*` keys) to populate `firstUtm*` fields for first-click campaign/ad attribution. The snippet is **idempotent per session** (guarded by `sessionStorage._ft_cart_written`). **CAPI-safe:** contains no pixel/track/CAPI calls — only `localStorage`, `sessionStorage`, and `/cart/update.js`.

```html
<script>
(function () {
  try {
    // Writes canonical cart attributes: _ft_utm_source, _ft_utm_medium, _ft_utm_campaign,
    // _ft_utm_content, _ft_utm_id, _ft_utm_term, _ft_fbclid, _ft_gclid, _ft_ttclid, _ft_set_at
    var KEEP = ["utm_source","utm_medium","utm_campaign","utm_content","utm_id","utm_term","fbclid","gclid","ttclid"];
    var sp = new URLSearchParams(location.search);
    var got = {};
    KEEP.forEach(function (k) { var v = sp.get(k); if (v) got[k] = v; });
    var stored = localStorage.getItem("_ft_attr");
    if (Object.keys(got).length && !stored) {
      stored = "?" + Object.keys(got).map(function (k) { return k + "=" + encodeURIComponent(got[k]); }).join("&");
      localStorage.setItem("_ft_attr", stored);
    }
    if (!stored) return;
    if (sessionStorage.getItem("_ft_cart_written")) return;
    var bag = new URLSearchParams(stored);
    var attrs = {};
    KEEP.forEach(function (k) { var v = bag.get(k); if (v) attrs["_ft_" + k] = v; });
    if (!Object.keys(attrs).length) return;
    attrs["_ft_set_at"] = new Date().toISOString();
    fetch("/cart/update.js", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attributes: attrs })
    }).then(function () { sessionStorage.setItem("_ft_cart_written", "1"); }).catch(function () {});
  } catch (e) {}
})();
</script>
```

**Canonical cart attribute keys written by this snippet:**

| Cart attribute key | Maps to order writer field |
|---|---|
| `_ft_utm_source` | `firstUtmSource` |
| `_ft_utm_medium` | `firstUtmMedium` |
| `_ft_utm_campaign` | `firstUtmCampaign` |
| `_ft_utm_content` | `firstUtmContent` |
| `_ft_utm_id` | `firstUtmId` |
| `_ft_utm_term` | `firstUtmTerm` |
| `_ft_fbclid` | `firstFbclid` |
| `_ft_gclid` | `firstGclid` |
| `_ft_ttclid` | `firstTtclid` |
| `_ft_set_at` | (timestamp, for freshness audits) |

---

## Section 2 — usmile360 (headless Lovable + edge function)

usmile360 has a **headless Lovable frontend** — Shopify only handles checkout. Cart events are routed through the Lovable edge function `roas-cart-event`, which holds the store token server-side. **The token must never appear in the client bundle** (it was leaked and rotated 2026-06-06).

There are two parts to deploy:

### Part A — Lovable client (first-touch capture)

Add this block on app load (e.g. at the top of your root `main.ts` / `App.tsx` entry point, before any router logic). It captures the first-touch UTM/click-id and stores it in `localStorage`.

```js
// on app load (first-touch capture)
(function () {
  try {
    var keep = ["utm_source","utm_medium","utm_campaign","utm_content","utm_id","utm_term","fbclid","gclid","ttclid"];
    var p = new URLSearchParams(location.search);
    var got = keep.filter(function (k) { return p.get(k); });
    if (got.length && !localStorage.getItem("_ft_attr")) {
      localStorage.setItem("_ft_attr", "?" + got.map(function (k){ return k+"="+encodeURIComponent(p.get(k)); }).join("&"));
    }
  } catch (_) {}
})();

// when reporting an add-to-cart, include in the POST body sent to the edge function:
//   landing_site: localStorage.getItem("_ft_attr") || "/",
//   first_touch:  localStorage.getItem("_ft_attr") || undefined, // first-click bag (best-effort; omit if absent)
//   product_id:   cartLine.productId || undefined                // numeric Shopify product id (best-effort; omit if absent) — enables per-product join by id

// On checkout / cart creation, also persist the first-touch UTM as Shopify CART
// ATTRIBUTES so the order's note_attributes carry the first-click campaign/ad ids
// (the dashboard reads `_ft_*`). CAPI-safe: cart metadata only — NO pixel events.
// Build the attribute bag from the stored _ft_attr and set it via the Storefront API:
//
//   var ft = new URLSearchParams(localStorage.getItem("_ft_attr") || "");
//   var KEEP = ["utm_source","utm_medium","utm_campaign","utm_content","utm_id","utm_term","fbclid","gclid","ttclid"];
//   var attributes = [];
//   KEEP.forEach(function (k) { var v = ft.get(k); if (v) attributes.push({ key: "_ft_" + k, value: v }); });
//   if (attributes.length) attributes.push({ key: "_ft_set_at", value: new Date().toISOString() });
//   // Canonical keys written: _ft_utm_source, _ft_utm_medium, _ft_utm_campaign,
//   //   _ft_utm_content, _ft_utm_id, _ft_utm_term, _ft_fbclid, _ft_gclid, _ft_ttclid, _ft_set_at
//   // → pass `attributes` to your Storefront API cartCreate(input:{attributes})
//   //   or cartAttributesUpdate(cartId, attributes) call at checkout.
```

**Canonical cart attribute keys written by this block:**

| Cart attribute key | Maps to order writer field |
|---|---|
| `_ft_utm_source` | `firstUtmSource` |
| `_ft_utm_medium` | `firstUtmMedium` |
| `_ft_utm_campaign` | `firstUtmCampaign` |
| `_ft_utm_content` | `firstUtmContent` |
| `_ft_utm_id` | `firstUtmId` |
| `_ft_utm_term` | `firstUtmTerm` |
| `_ft_fbclid` | `firstFbclid` |
| `_ft_gclid` | `firstGclid` |
| `_ft_ttclid` | `firstTtclid` |
| `_ft_set_at` | (timestamp, for freshness audits) |

These are the same keys written by the themed store's `/cart/update.js` snippet (Section 1b), so the order writer (`classifyOrderSource`) reads them identically. The key difference is the mechanism: themed stores use the Shopify Cart AJAX API (`/cart/update.js`), while headless stores use the Storefront API (`cartCreate`/`cartAttributesUpdate`) since Lovable owns the cart.

### Part B — Edge function `roas-cart-event` (forward `landing_site`, keep token server-side)

Update the edge function so it reads `landing_site` from the client payload and forwards it to `/api/events/cart`. The `ROAS_STORE_TOKEN` **must remain server-side** — it must not be passed from or returned to the client.

```js
// inside roas-cart-event, when forwarding to /api/events/cart:
body: JSON.stringify({
  store_token: Deno.env.get("ROAS_STORE_TOKEN"),   // server-side only — never the client
  event_id: payload.event_id,
  product_title: payload.product_title,
  quantity: payload.quantity,
  occurred_at: payload.occurred_at,
  landing_site: payload.landing_site || "/",        // forwarded last-touch landing from client
  first_touch: payload.first_touch || undefined,    // forwarded first-click bag (best-effort; omit if absent)
  product_id: payload.product_id || undefined,      // forwarded numeric Shopify product id (best-effort) — per-product join by id
})
```

Adapt the surrounding code to your edge function's actual runtime and SDK (the example uses Deno env). The critical invariants are: forward `landing_site` AND `first_touch` AND `product_id`; read the token from a server-side env var only.

---

## Section 3 — Deploy and verify

### Before deploying

1. **uzoshop / Zol Plus:** replace `<STORE_CART_TOKEN>` in the Custom Pixel with each store's `cart_public_token` (from the `store_webhooks` row for that store).
2. **usmile360:** confirm that `ROAS_STORE_TOKEN` is set in the Lovable edge function's environment variables and reflects the rotated token (rotated 2026-06-06).
3. **First-touch re-paste (2026-06-07):** the beacon now sends a `first_touch` field (the stored `_ft_attr` bag) so the dashboard can compute first-click attribution. The **3 existing stores (uzoshop, Zol Plus, usmile360) must RE-PASTE the updated snippet** for the field to start flowing — the previous version sent only `landing_site`. New stores added via the wizard get the enriched snippet automatically.
4. **Product-id re-paste (2026-06-08, PPJ-T1):** the beacon now also sends a `product_id` field (the cart line's Product GID; the route normalizes it to the numeric Shopify Product id) so the per-product table can join ATC↔purchases by id. The **3 existing stores (uzoshop, Zol Plus, usmile360) must RE-PASTE the updated snippet** for the field to start flowing. New stores added via the wizard get it automatically.

### Smoke test after deploy

1. Open a store URL with a UTM or click-id in the query string, for example:
   `https://<store-domain>/products/<handle>?utm_source=facebook&utm_medium=paid`
2. Add any product to the cart.
3. Open the dashboard activity feed — the new cart event should display the correct platform badge (e.g. **Meta**).

### Honest caveats

- **Organic / direct landings** (no UTM or click-id in the URL) produce `landing_site: "/"` → the event is classified as **ישיר** (direct). This is expected and correct.
- **Google first-click** attribution is weaker than Meta and TikTok because `gclid` is only present on paid clicks that land directly; Google-organic and cross-domain flows will fall through to "direct".
- The capture is **best-effort and display-only** — it shows which ad platform likely drove the session; it is not a precise attribution model and should not be used for billing or budget decisions.
- **usmile360 only:** the `_ft_attr` `localStorage` key (Section 2, real browser context — not the Shopify sandbox) is written once (first-touch, guarded) and never overwritten in the session. The Shopify Custom Pixel (Section 1) does NOT use `localStorage` — it reads the UTM from the add-to-cart event's context URL instead.
