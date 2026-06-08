/**
 * Self-serve stores Phase 6a, Task 2 — pure store-snippet generator.
 *
 * Given a newly-added store's identity, its minted `cartPublicToken`, allowed
 * origins, and whether it's headless, this returns the operator-facing
 * storefront snippet(s) to paste. It feeds the AddStoreWizard's final step (T5).
 *
 * PURITY CONTRACT — this module performs NO DB access, NO fetch, NO randomness,
 * NO env reads, and has NO side effects. Output is a deterministic function of
 * the inputs. The token is RECEIVED here (minted upstream in the add route via
 * `randomBytes(24).toString('base64url')`); this module never mints it.
 *
 * The snippet TEXT is copied VERBATIM from
 * `docs/storefront-snippets/first-touch-attribution.md` (the source of truth for
 * both blocks + the production cart endpoint + the exact placeholder token). The
 * ONLY transformation applied:
 *   - themed: substitute the `<STORE_CART_TOKEN>` placeholder with the real
 *     `cartPublicToken` (kept in the `CART_TOKEN` const, referenced in the POST
 *     body — never inlined as a literal in `store_token`).
 *   - headless: NO token in the client JS at all; the token lives ONLY in the
 *     edge-function env var `ROAS_STORE_TOKEN`, surfaced via the `note`.
 *
 * If the doc's snippets change, update the template literals below to match.
 */

/** The placeholder string the doc uses for the per-store cart token. */
const TOKEN_PLACEHOLDER = '<STORE_CART_TOKEN>';

export type StoreSnippet = {
  kind: 'themed' | 'headless';
  primary: string;
  secondary?: string;
  note?: string;
};

export type GenerateStoreSnippetArgs = {
  storeId: string;
  cartPublicToken: string;
  allowedOrigins: string[];
  isHeadless: boolean;
};

/**
 * Themed Shopify Custom Pixel — VERBATIM from
 * docs/storefront-snippets/first-touch-attribution.md (Section 1, the fenced
 * `js` block), with the `<STORE_CART_TOKEN>` placeholder still present so the
 * single substitution below is the only mutation. Captures first-touch on
 * `page_viewed` into `browser.localStorage._ft_attr` and, on
 * `product_added_to_cart`, POSTs to the production cart endpoint with body
 * { store_token, event_id, product_title, quantity, occurred_at, landing_site }.
 */
const THEMED_PIXEL_TEMPLATE = `const CART_TOKEN = "${TOKEN_PLACEHOLDER}";

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
});`;

/**
 * Themed THEME snippet (NOT the Custom Pixel — that's sandboxed and can't touch
 * the cart). Persists first-touch UTM to localStorage and writes it as `_ft_*`
 * Shopify cart attributes via the Cart AJAX API, so the order's note_attributes
 * carry the first-click campaign/ad-set/ad ids (the dashboard reads `_ft_*`).
 * Idempotent per session. CAPI-safe: NO pixel/track/CAPI calls — only
 * localStorage + /cart/update.js. Paste in the theme (theme.liquid), NOT the
 * Custom Pixel.
 */
const THEMED_CART_ATTR_TEMPLATE = `<script>
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
</script>`;

/**
 * Headless Lovable CLIENT first-touch IIFE — VERBATIM from
 * docs/storefront-snippets/first-touch-attribution.md (Section 2, Part A). This
 * is TOKEN-FREE by design: it only captures first-touch UTM/click-id into
 * `localStorage._ft_attr`. The store token must NEVER appear in the client
 * bundle (it lives only in the edge-function env — see `secondary` + `note`).
 */
const HEADLESS_CLIENT_TEMPLATE = `// on app load (first-touch capture)
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
//   product_id:   cartLine.productId || undefined                // numeric Shopify product id (best-effort; omit if absent) — enables per-product join by id`;

/**
 * Headless edge-function forwarder — VERBATIM from
 * docs/storefront-snippets/first-touch-attribution.md (Section 2, Part B). The
 * `roas-cart-event` edge function reads the store token from a SERVER-SIDE env
 * var (`ROAS_STORE_TOKEN`) and forwards `landing_site` to /api/events/cart. The
 * token is NEVER passed from / returned to the client.
 */
const HEADLESS_EDGE_TEMPLATE = `// inside roas-cart-event, when forwarding to /api/events/cart:
body: JSON.stringify({
  store_token: Deno.env.get("ROAS_STORE_TOKEN"),   // server-side only — never the client
  event_id: payload.event_id,
  product_title: payload.product_title,
  quantity: payload.quantity,
  occurred_at: payload.occurred_at,
  landing_site: payload.landing_site || "/",        // forwarded last-touch landing from client
  first_touch: payload.first_touch || undefined,    // forwarded first-click bag (best-effort; omit if absent)
  product_id: payload.product_id || undefined,      // forwarded numeric Shopify product id (best-effort) — per-product join by id
})`;

/**
 * Produce the storefront snippet(s) for a store. Pure + deterministic.
 *
 * @param args.storeId          the store's id (display/context only — not embedded in the snippet)
 * @param args.cartPublicToken  the minted per-store cart token (substituted into the themed pixel; surfaced only via the headless `note`)
 * @param args.allowedOrigins   the store's allowed origins (accepted for symmetry with the add route; not embedded in the snippet text)
 * @param args.isHeadless       true → headless (Lovable + edge fn); false → themed (Shopify Custom Pixel)
 */
export function generateStoreSnippet(args: GenerateStoreSnippetArgs): StoreSnippet {
  const { cartPublicToken, isHeadless } = args;

  if (isHeadless) {
    return {
      kind: 'headless',
      // Client JS is token-free — the token must NEVER appear in the bundle.
      primary: HEADLESS_CLIENT_TEMPLATE,
      secondary: HEADLESS_EDGE_TEMPLATE,
      note:
        `Set the edge-function env var ROAS_STORE_TOKEN = ${cartPublicToken} in the ` +
        `roas-cart-event edge function (Lovable). The token lives ONLY in the ` +
        `edge-function environment — never in client JS.`,
    };
  }

  return {
    kind: 'themed',
    // The single transformation: substitute the placeholder with the real token.
    primary: THEMED_PIXEL_TEMPLATE.split(TOKEN_PLACEHOLDER).join(cartPublicToken),
    secondary: THEMED_CART_ATTR_TEMPLATE,
    note:
      'primary → Shopify admin → Settings → Customer events → Add custom pixel. ' +
      'secondary → paste in the THEME (theme.liquid, before </body>) — it writes _ft_* cart ' +
      'attributes so orders carry the first-click campaign/ad ids. Do NOT put the secondary in the Custom Pixel (sandboxed).',
  };
}
