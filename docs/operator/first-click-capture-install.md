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

## usmile360 (Lovable headless) — second, more involved
usmile's frontend is Lovable (Shopify is checkout/infra only), so `/cart/update.js` cart attributes aren't the path. Instead:
1. In the **Lovable** site, add the **Step 1 cookie snippet** (capture first-touch from the landing URL).
2. At cart/checkout creation, send the first-touch to the dashboard's existing **`/api/events/cart`** beacon, keyed by the cart/checkout **token**; the dashboard JOINs it to the order by token at read time.

This needs the Lovable snippet + the cart/checkout token passthrough. Flag me when you want to do usmile and I'll provide the exact Lovable beacon snippet + confirm the read-time JOIN.

---

## Notes
- **Google is campaign-grain** for first-click too (no Google ad-level data) — and needs your Google Ads URL tagging to carry the campaign id (already set up).
- First-click coverage is a **directional floor** (≤ last-click): cookie/cart capture is lossier than a platform click-id (ITP, ad-blockers, cross-device). That's expected — it's a *lens*, not ground truth.
- Reversible: removing the snippets stops new capture; existing data stays. Zero pipeline/CAPI risk.
