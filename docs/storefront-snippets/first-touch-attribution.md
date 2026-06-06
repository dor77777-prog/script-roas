# First-Touch Attribution Capture — Storefront Snippets

These snippets are **operator-deployed to storefronts only** — they do not live in this repo and are not run by CI. Copy-paste them as described below. Once deployed, add-to-cart events sent to `/api/events/cart` will carry a `landing_site` query-string that the API uses to classify the ad-platform source badge shown in the activity feed.

---

## Section 1 — Shopify Custom Pixel (uzoshop, Zol Plus)

**Where to paste:** Shopify Admin → Settings → Customer events → Add custom pixel.

> ⚠️ **Shopify Custom Pixels run in a sandboxed iframe** — the native `localStorage`, `window`, and `document` are NOT accessible there. Touching `localStorage` **throws and silently kills the whole handler** (no beacon fires → no events). So do NOT use `localStorage` here. Instead we read the entry UTM/click-id straight from the **pixel event's own context URL** (`event.context.document.location`) at add-to-cart time — no storage needed. `fetch` IS available in the sandbox; `keepalive: true` + `.catch(()=>{})` keep it fire-and-forget so it **never blocks add-to-cart**.

This captures the UTM when the shopper adds to cart on the same URL they landed on (the dominant *ad → product page → add* flow). True cross-page first-touch (land on page A with a UTM, then add to cart on page B) would require Shopify's **async `browser.localStorage`** Standard API; it's intentionally omitted here to keep the pixel robust and synchronous.

Replace `<STORE_CART_TOKEN>` with each store's `cart_public_token` (uzoshop and Zol Plus each have their own).

```js
analytics.subscribe("product_added_to_cart", (event) => {
  try {
    var loc = (event.context && event.context.document && event.context.document.location) || {};
    var landing = loc.search || loc.href || "/";   // entry UTM/click-id from the current URL
    var d = event.data || {};
    var line = d.cartLine || {};
    var title =
      (line.merchandise && line.merchandise.product && line.merchandise.product.title) ||
      (d.productVariant && d.productVariant.product && d.productVariant.product.title) ||
      null;
    var qty = line.quantity || 1;
    fetch("https://roas-dashboard-smoky.vercel.app/api/events/cart", {
      method: "POST",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        store_token: "<STORE_CART_TOKEN>",
        event_id: event.id || String(event.timestamp || Date.now()),
        product_title: title,
        quantity: qty,
        occurred_at: event.timestamp || new Date().toISOString(),
        landing_site: landing
      })
    }).catch(function () {});
  } catch (e) {}
});
```

> **If you already pasted the earlier `localStorage` version into uzoshop / Zol Plus, REPLACE it with the snippet above** — the old one throws in the sandbox and stops all cart events from those stores.

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
//   landing_site: localStorage.getItem("_ft_attr") || "/"
```

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
  landing_site: payload.landing_site || "/",        // forwarded first-touch from client
})
```

Adapt the surrounding code to your edge function's actual runtime and SDK (the example uses Deno env). The critical invariants are: forward `landing_site`; read the token from a server-side env var only.

---

## Section 3 — Deploy and verify

### Before deploying

1. **uzoshop / Zol Plus:** replace `<STORE_CART_TOKEN>` in the Custom Pixel with each store's `cart_public_token` (from the `store_webhooks` row for that store).
2. **usmile360:** confirm that `ROAS_STORE_TOKEN` is set in the Lovable edge function's environment variables and reflects the rotated token (rotated 2026-06-06).

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
