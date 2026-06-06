# First-Touch Attribution Capture — Storefront Snippets

These snippets are **operator-deployed to storefronts only** — they do not live in this repo and are not run by CI. Copy-paste them as described below. Once deployed, add-to-cart events sent to `/api/events/cart` will carry a `landing_site` query-string that the API uses to classify the ad-platform source badge shown in the activity feed.

---

## Section 1 — Shopify Custom Pixel (uzoshop, Zol Plus)

**Where to paste:** Shopify Admin → Settings → Customer events → Add custom pixel.

This pixel runs in a sandboxed worker (off-main-thread). The `fetch` call uses `keepalive: true` + `.catch(()=>{})` so it is fire-and-forget and **never blocks add-to-cart**.

Replace `<STORE_CART_TOKEN>` with each store's `cart_public_token` value from the `store_webhooks` table row for that store (uzoshop and Zol Plus each have their own token).

```js
analytics.subscribe("page_viewed", (e) => {
  try {
    const url = new URL(e.context.document.location.href);
    const keep = ["utm_source","utm_medium","utm_campaign","utm_content","utm_id","utm_term","fbclid","gclid","ttclid"];
    const got = keep.filter(k => url.searchParams.get(k));
    if (got.length && !localStorage.getItem("_ft_attr")) {
      const qs = got.map(k => k + "=" + encodeURIComponent(url.searchParams.get(k))).join("&");
      localStorage.setItem("_ft_attr", "?" + qs); // FIRST-touch only (guard above)
    }
  } catch (_) {}
});

analytics.subscribe("product_added_to_cart", (e) => {
  try {
    const title = e.data?.cartLine?.merchandise?.product?.title
      || e.data?.productVariant?.product?.title || null;
    const qty = e.data?.cartLine?.quantity || 1;
    fetch("https://roas-dashboard-smoky.vercel.app/api/events/cart", {
      method: "POST", keepalive: true, headers: { "content-type": "application/json" },
      body: JSON.stringify({
        store_token: "<STORE_CART_TOKEN>",
        event_id: (e.id || (Date.now() + "-" + Math.random())),
        product_title: title, quantity: qty,
        occurred_at: new Date().toISOString(),
        landing_site: localStorage.getItem("_ft_attr") || "/",
      }),
    }).catch(() => {});
  } catch (_) {}
});
```

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
- The `_ft_attr` key in `localStorage` is written once (first touch only, guarded by the `!localStorage.getItem` check) and is never overwritten by later page views in the same browser session.
