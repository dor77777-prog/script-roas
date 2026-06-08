/**
 * Phase 2, Task 2.1 — client-reported add-to-cart ingest.
 *
 * Two callers, both BROWSER and CROSS-ORIGIN:
 *   (a) a Shopify Custom Pixel (`analytics.subscribe('product_added_to_cart', …)`)
 *       on the standard stores (uzoshop, Zol Plus), and
 *   (b) a fetch beacon from the headless usmile Lovable frontend.
 *
 * Because it is called from a browser on a different origin than the dashboard,
 * CORS is REQUIRED (unlike the server webhook at /api/webhooks/shopify, which
 * Shopify calls server-to-server). EVERY response — success AND every drop /
 * error path — carries the CORS headers; otherwise the browser discards the
 * response and the storefront console fills with CORS errors.
 *
 * Trust model (LOW by design — this is DISPLAY-ONLY data, never billing /
 * aggregates):
 *   - Primary auth is the per-store secret `cart_public_token` (looked up in
 *     `store_webhooks`). A signing-secret HMAC can't be used here because any
 *     secret shipped in browser JS would leak.
 *   - Origin check is BEST-EFFORT only. A Shopify Custom Pixel runs in a
 *     sandboxed iframe whose `Origin` header is unreliable (often opaque/`null`
 *     or the sandbox origin, not the storefront). So: we reject ONLY when there
 *     IS an Origin header AND `allowed_origins` is non-empty AND the origin is
 *     not in it. An absent/opaque Origin, or an empty `allowed_origins`, is
 *     allowed — the token carries the auth.
 *   - Abuse: we rely on token secrecy + the `dedupe_key` UNIQUE constraint (a
 *     replayed `event_id` is a DB no-op). A heavy per-request DB count guard is
 *     deliberately AVOIDED — it would add latency to the storefront's add-to-cart
 *     path. Serverless has no shared memory so a robust in-memory rate-limit
 *     isn't possible anyway; any per-instance cap would be best-effort. Given the
 *     display-only nature, token + dedupe is the right ceiling. Rate-limiting is
 *     therefore documented as best-effort and NOT implemented here.
 *
 * Failure modes all return 204 (ack + drop, never reveal WHY, never 5xx → never
 * block the storefront's add-to-cart UX):
 *   - missing store_token / event_id → 204
 *   - unparseable JSON                → 204
 *   - unknown / disabled token        → 204 (no insert)
 *   - origin rejected (best-effort)   → 204 (no insert)
 *   - insert throws (DB blip)         → 204 (logged)
 *   - valid                           → 204 + idempotent insert (dedupe cart:<event_id>)
 */

import { NextResponse } from 'next/server';
import { lookupStoreByCartToken, insertStoreEvent } from '@/lib/webhooks/store';
import { classifyOrderAttribution } from '@/lib/attribution/classifyOrderSource';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PRODUCT_TITLE_MAX = 200;

/**
 * CORS headers for every response. Echoes the request Origin (so credentialed-
 * style cross-origin fetches are accepted) or `*` when none is present
 * (Custom-Pixel sandbox can omit it). We never set `Allow-Credentials` — the
 * cart beacon sends no cookies (the token lives in the body).
 */
function corsHeaders(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/** 204 No Content with the CORS headers attached (the universal ack). */
function ack(origin: string | null): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

/**
 * Coerce an incoming `occurred_at` to a valid ISO string. Mirrors the
 * normalizeShopifyEvent `safeIso` pattern: a client can send anything, and
 * `occurred_at` feeds a NOT NULL timestamptz column — a garbage value would make
 * the insert throw. Valid ISO passes through; anything else falls back to now.
 */
function safeIso(value: unknown): string {
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return value;
  return new Date().toISOString();
}

/** Trim + length-cap a product title to a non-PII display string, or null. */
function safeProductTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, PRODUCT_TITLE_MAX);
}

/** Coerce a quantity to a finite integer, or null. */
function safeQuantity(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

/**
 * Normalize an incoming ATC product id (PPJ-T1) to the bare NUMERIC Shopify
 * Product id so it matches the join targets exactly:
 *   - `orders_attribution.line_items` productId = `String(li.product_id)` (the
 *     REST orders numeric product id — pure digits, e.g. `7654321`), and
 *   - `products_daily.product_id` = `String(p.id)` (the products numeric id —
 *     also pure digits).
 *
 * The Shopify Custom Pixel exposes the product id as a GID
 * (`gid://shopify/Product/7654321`); the headless cart may send the bare numeric
 * id (string or number). Either way we take the TRAILING run of digits — for a
 * GID that's the numeric Product id after the last slash; for a plain numeric id
 * it's the id itself. Anything with no trailing digits (junk / variant-only with
 * a non-numeric shape) → null (the field is then omitted; the event is still
 * recorded). Best-effort: never throws.
 */
function safeProductId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  // Trailing numeric run: for `gid://shopify/Product/7654321` → `7654321`; for a
  // bare `7654321` (string or number) → `7654321`. A GID with no numeric tail or
  // any non-numeric junk yields no match → null.
  const m = String(value).match(/(\d+)\s*$/);
  return m ? m[1] : null;
}

/**
 * Fold the beacon's best-effort first-touch bag (the storefront's `_ft_attr`
 * localStorage value, written by the page_view snippet) into `note_attributes`
 * named `_ft_<key>` — the exact namespace `classifyOrderAttribution`'s
 * first-click chain reads (it normalizes `_ft_x` → `ft_x`). Boosts first-touch
 * coverage so the first-click lens (T3) has data on add-to-cart events.
 *
 * `_ft_attr` is a UTM/click-id query string — either:
 *   - a raw string the snippet stored (e.g. `?utm_source=facebook&fbclid=abc`
 *     or `loc.search`), possibly double-encoded as a JSON string, OR
 *   - a parsed object the headless client forwarded ({ utm_source, fbclid, … }).
 *
 * Best-effort + defensive: any parse failure / unexpected shape → `[]` (the
 * event is still recorded with NO first-touch; never throws, never 5xxes). Only
 * the known first-touch keys are forwarded (utm_*, fbclid/gclid/ttclid, set_at),
 * each length-capped — no arbitrary attacker-controlled keys reach the classifier.
 */
const FIRST_TOUCH_KEYS: ReadonlySet<string> = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_id',
  'utm_term',
  'fbclid',
  'gclid',
  'ttclid',
  'set_at',
]);
const FT_VALUE_MAX = 512;

function parseFirstTouch(value: unknown): Array<{ name: string; value: string }> {
  try {
    // Normalize to a flat record of string→string.
    const record: Record<string, string> = Object.create(null);

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      // Already a parsed object (headless client forwarded the parsed bag).
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (v === null || v === undefined) continue;
        record[String(k).toLowerCase()] = String(v);
      }
    } else if (typeof value === 'string') {
      let str = value.trim();
      if (!str) return [];
      // A client may have JSON-stringified the bag — unwrap a JSON object/string.
      if (str.startsWith('{') || str.startsWith('"')) {
        try {
          const parsed = JSON.parse(str);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
              if (v === null || v === undefined) continue;
              record[String(k).toLowerCase()] = String(v);
            }
            str = '';
          } else if (typeof parsed === 'string') {
            str = parsed;
          } else {
            // JSON parsed but not a usable shape (number/array/null) → no first-touch.
            return [];
          }
        } catch {
          // Looked like JSON but wasn't → malformed; omit first-touch.
          return [];
        }
      }
      // Parse the (remaining) query-string form `?a=b&c=d` / `a=b&c=d`.
      if (str) {
        const qs = str.startsWith('?') ? str.slice(1) : str;
        for (const pair of qs.split('&')) {
          const eq = pair.indexOf('=');
          if (eq < 0) continue;
          const rawK = pair.slice(0, eq);
          const rawV = pair.slice(eq + 1);
          let k = rawK;
          let v = rawV;
          try { k = decodeURIComponent(rawK); } catch { /* keep raw */ }
          try { v = decodeURIComponent(rawV); } catch { /* keep raw */ }
          record[k.toLowerCase()] = v;
        }
      }
    } else {
      // Not a string or object (number/boolean/array) → no first-touch.
      return [];
    }

    // Emit ONLY the known first-touch keys as `_ft_<key>` note_attributes.
    const out: Array<{ name: string; value: string }> = [];
    for (const [k, v] of Object.entries(record)) {
      if (!FIRST_TOUCH_KEYS.has(k)) continue;
      if (!v) continue;
      out.push({ name: `_ft_${k}`, value: v.slice(0, FT_VALUE_MAX) });
    }
    return out;
  } catch {
    // Any unexpected error → omit first-touch (never block add-to-cart).
    return [];
  }
}

/** CORS preflight. */
export async function OPTIONS(req: Request): Promise<NextResponse> {
  return ack(req.headers.get('origin'));
}

export async function POST(req: Request): Promise<NextResponse> {
  const origin = req.headers.get('origin');

  // 1. Parse JSON; missing token/event_id → ack+drop (never reveal).
  let body: {
    store_token?: unknown;
    product_title?: unknown;
    product_id?: unknown;
    quantity?: unknown;
    event_id?: unknown;
    occurred_at?: unknown;
    landing_site?: unknown;
    referring_site?: unknown;
    first_touch?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return ack(origin);
  }

  const storeToken = typeof body?.store_token === 'string' ? body.store_token : '';
  const eventId = typeof body?.event_id === 'string' ? body.event_id : '';
  if (!storeToken || !eventId) return ack(origin);

  // 2. Token → store (enabled). Unknown / disabled → ack+drop (no insert).
  const store = await lookupStoreByCartToken(storeToken);
  if (!store || !store.enabled) return ack(origin);

  // 3. Best-effort origin check (Custom-Pixel sandbox Origin is unreliable):
  //    A Shopify Web Pixel runs in a sandboxed iframe that sends the LITERAL
  //    string `Origin: null` (an opaque origin) — NOT an absent header. Treat
  //    both absent AND "null" as opaque → ALLOW (the per-store token is the
  //    primary auth; origin is best-effort). Otherwise reject only when
  //    allowed_origins is non-empty and the request origin (normalized to
  //    scheme+host+port, so a trailing-slash/path in config can't false-drop)
  //    isn't listed.
  const isOpaqueOrigin = !origin || origin === 'null';
  if (isOpaqueOrigin === false && Array.isArray(store.allowed_origins) && store.allowed_origins.length > 0) {
    const norm = (o: string): string => {
      try {
        return new URL(o).origin;
      } catch {
        return o;
      }
    };
    const reqOrigin = norm(origin);
    const allowed = store.allowed_origins.some((a) => norm(a) === reqOrigin || a === origin);
    if (!allowed) return ack(origin);
  }

  // 4. Insert add_to_cart. dedupe_key makes a replayed event_id a no-op.
  //    Wrapped so a transient DB error never 5xxes → never blocks the storefront.
  const productTitle = safeProductTitle(body.product_title);
  const quantity = safeQuantity(body.quantity);
  // PPJ-T1: normalize the ATC product id (GID or numeric) to the bare numeric
  // Shopify Product id so it matches orders_attribution.line_items productId and
  // products_daily.product_id, enabling an exact per-product ATC↔purchase join by
  // id. Best-effort — a missing/unparseable id is omitted from `raw` below.
  const productId = safeProductId(body.product_id);
  // Classify source from the first-touch landing_site the storefront snippet
  // sends. landing_site is NOT stored in raw (keep raw PII-free as-is).
  // Defensive wrapper: a future change to the classifier must never 500 the
  // storefront — any throw falls back to 'direct'.
  const landingStr = typeof body.landing_site === 'string' ? body.landing_site : '';
  const referrerStr = typeof body.referring_site === 'string' ? body.referring_site : '';
  let source = 'direct';
  // First-touch (classify-v2 T4b): fold the beacon's best-effort `_ft_attr` bag
  // into the classifier as `_ft_*` note_attributes so its first-click chain
  // computes firstTouchSource. Parsing is fully defensive — a missing/malformed
  // first_touch yields [] and the event is still recorded with NO first-touch.
  const firstTouchAttrs = parseFirstTouch(body.first_touch);
  // first_touch_source is a non-secret platform label (e.g. 'meta-paid') or null
  // ("no first-click signal"). Stored in raw so T3's first-click lens can read it
  // (NO new DB column). Default null = no first-touch signal — NOT 'direct'.
  let firstTouchSource: string | null = null;
  // Permanent attribution diag — PII-free probe kept so the operator can
  // re-examine ATC classification over time (genuinely-direct vs an unmapped
  // utm_source the classifier should learn). PII-FREE: utm_source/utm_medium are
  // marketing labels (length-capped), fbclid/gclid are presence booleans,
  // landingLen / firstTouch are numbers/labels. Do NOT remove.
  let diag: Record<string, unknown> = { landingLen: landingStr.length };
  try {
    const attr = classifyOrderAttribution({
      landing_site: landingStr || undefined,
      referring_site: referrerStr || undefined,
      // First-touch ft_* signals ride in as note_attributes — they DON'T affect
      // the last-touch `source` (that chain ignores _ft_*), only firstTouchSource.
      note_attributes: firstTouchAttrs.length > 0 ? firstTouchAttrs : undefined,
    });
    source = attr.source;
    firstTouchSource = attr.firstTouchSource;
    diag = {
      utmSource: (attr.utmSource || '').slice(0, 64) || null,
      utmMedium: (attr.utmMedium || '').slice(0, 64) || null,
      fbclid: attr.fbclidPresent,
      gclid: attr.gclidPresent,
      landingLen: landingStr.length,
      // First-touch probe (PII-free): the computed first-click label + presence
      // booleans for the click-ids, so the operator can see first-click coverage.
      firstTouch: firstTouchSource,
      firstFbclid: attr.firstFbclidPresent,
      firstGclid: attr.firstGclidPresent,
      firstTtclid: attr.firstTtclidPresent,
    };
  } catch {
    // never let attribution classification block the storefront's add-to-cart
    source = 'direct';
    firstTouchSource = null;
  }
  try {
    await insertStoreEvent({
      store_id: store.store_id,
      type: 'add_to_cart',
      amount_cad: null,
      currency: null,
      amount_original: null,
      product_title: productTitle,
      quantity,
      customer_label: null,
      source,
      occurred_at: safeIso(body.occurred_at),
      dedupe_key: `cart:${eventId}`,
      // raw carries NO PII — display-safe fields + the PII-free `diag` probe above.
      // first_touch_source is a non-secret platform label (null = no signal) that
      // T3's first-click lens reads back via /api/store-events (no new column).
      // product_id (PPJ-T1) is the bare numeric Shopify Product id (or null when
      // absent/unparseable) — matches line_items / products_daily for an exact
      // per-product ATC↔purchase join by id; stored in raw (no new column).
      raw: {
        product_title: productTitle,
        quantity,
        event_id: eventId,
        first_touch_source: firstTouchSource,
        product_id: productId,
        diag,
      },
    });
  } catch (err) {
    console.error('[events/cart] ingest failed (acking 204 to not block storefront):', err);
  }

  // 5. Ack 204 (with CORS).
  return ack(origin);
}
