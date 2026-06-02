# First-click capture — operator install guide (Plan C)

The dashboard code for the **first-click lens** is live. It reads `ft_*` keys from each order's `note_attributes`. Nothing populates those yet — this guide is the **store-side capture** that does. Until it's installed, the first-click columns + coverage chip stay at **0%** (the last-click "ROAS Shopify" numbers are unaffected).

**CAPI-safety (non-negotiable):** these snippets only (1) read URL params on landing and (2) write Shopify **cart attributes**. They send **zero** events to Meta/Google/TikTok — no `fbq` / `gtag` / `ttq` / pixel calls. They cannot double-count or break your CAPI apps.

## What gets captured
First-touch (write-once) of: `fbclid, gclid, ttclid, utm_source, utm_medium, utm_campaign, utm_content, utm_id, utm_term` + a timestamp. Stored in a first-party cookie on the **first** ad-tagged landing, then copied to the cart as `_ft_*` attributes (single underscore = Shopify "private" attribute; it arrives in the order's `note_attributes` with the same name; the classifier normalizes `_ft_` → `ft_`).

---

## uzoshop + zolplus (themed Shopify) — do these first

### Step 1 — first-touch cookie (capture on landing)
Add to the theme: **Online Store → Themes → Edit code → `layout/theme.liquid`**, paste just before `</head>`:

```html
<script>
(function () {
  try {
    var COOKIE = '_ft';
    function get(n){var m=document.cookie.match('(?:^|; )'+n+'=([^;]*)');return m?decodeURIComponent(m[1]):null;}
    function set(n,v){var d=new Date();d.setTime(d.getTime()+365*864e5);
      document.cookie=n+'='+encodeURIComponent(v)+';expires='+d.toUTCString()+';path=/;SameSite=Lax';}
    if (!get(COOKIE)) {                                  // write-ONCE = true first touch
      var p = new URLSearchParams(location.search), ft = {}, any = false;
      ['fbclid','gclid','ttclid','utm_source','utm_medium','utm_campaign','utm_content','utm_id','utm_term']
        .forEach(function(k){ var v=p.get(k); if(v){ ft[k]=v; any=true; } });
      if (any) { ft.set_at = new Date().toISOString(); set(COOKIE, JSON.stringify(ft)); }
    }
  } catch (e) {}
})();
</script>
```

### Step 2 — copy the first-touch onto the cart
Same file, also before `</head>` (runs on every page; `/cart/update.js` is idempotent so re-writing the same attributes is harmless — this guarantees the attributes are on the cart by the time checkout is reached):

```html
<script>
(function () {
  try {
    var m = document.cookie.match('(?:^|; )_ft=([^;]*)'); if (!m) return;
    var ft = JSON.parse(decodeURIComponent(m[1])), attrs = {};
    Object.keys(ft).forEach(function (k) { attrs['_ft_' + k] = ft[k]; });   // _ft_* private attrs
    fetch('/cart/update.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attributes: attrs }),
      keepalive: true,
    }).catch(function(){});
  } catch (e) {}
})();
</script>
```

> Prefer a **Custom Pixel** instead of theme code? Settings → Customer events → Add custom pixel, paste both blocks. Either works — the cookie + cart-attribute write are the same.

### Verify (after install + at least one ad-clicked sale)
- A new order's `note_attributes` should contain `_ft_utm_source` etc.
- In the dashboard, the **first-click coverage chip** rises above 0% and the **first-click ROAS** column fills beside "ROAS Shopify" in Campaigns / Ads.
- I can confirm from prod once a tagged sale lands (`first_utm_*` populated on `orders_attribution`).

---

## usmile360 (Lovable headless, Shopify Storefront API cart) — DONE via cart attributes
usmile's Lovable frontend builds the cart through the **Shopify Storefront API** (GraphQL `cartCreate`/`cartLinesAdd`). So the first-touch attaches as **cart attributes** via the `cartAttributesUpdate` mutation — which carry onto the order's `note_attributes` → the **same deployed classifier** reads them. **No dashboard code needed.**

**Step 1** — add the first-touch cookie snippet (identical to the themed stores) to the Lovable site `<head>`/global script.

**Step 2** — call this after the cart has an ID (post `cartCreate`/`cartLinesAdd`), ideally right before checkout, reusing the **same Storefront token** the Lovable site already uses:

```js
// canonical Storefront domain for usmile (verified same store as the dashboard's 360usmile Admin fetch)
async function attachFirstTouchToCart(cartId, storefrontToken) {
  try {
    var m = document.cookie.match('(?:^|; )_ft=([^;]*)');
    if (!m || !cartId) return;
    var ft = JSON.parse(decodeURIComponent(m[1]));
    var attributes = Object.keys(ft).map(function (k) { return { key: '_ft_' + k, value: String(ft[k]) }; });
    await fetch('https://lovable-project-lv0v0.myshopify.com/api/2026-04/graphql.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Storefront-Access-Token': storefrontToken },
      body: JSON.stringify({
        query: 'mutation($cartId:ID!,$attributes:[AttributeInput!]!){cartAttributesUpdate(cartId:$cartId,attributes:$attributes){userErrors{message}}}',
        variables: { cartId: cartId, attributes: attributes },
      }),
    });
  } catch (e) {}
}
// call right before checkout: attachFirstTouchToCart(cartId, '<your storefront token>')
```

Domain note: usmile's canonical myshopify domain is `lovable-project-lv0v0.myshopify.com` (what Lovable's Storefront API uses); the dashboard fetches its orders via the alias `360usmile.myshopify.com` — verified to be the **same store**, so the cart attributes reach the dashboard. Storefront cart attributes carry onto the order's `note_attributes` → classifier normalizes `_ft_` → `ft_` → `first_*`. CAPI-safe (one Storefront cart mutation; zero pixel/CAPI events).

---

## Notes
- **Google is campaign-grain** for first-click too (no Google ad-level data) — and needs your Google Ads URL tagging to carry the campaign id (already set up).
- First-click coverage is a **directional floor** (≤ last-click): cookie/cart capture is lossier than a platform click-id (ITP, ad-blockers, cross-device). That's expected — it's a *lens*, not ground truth.
- Reversible: removing the snippets stops new capture; existing data stays. Zero pipeline/CAPI risk.
