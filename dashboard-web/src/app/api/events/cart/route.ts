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
    quantity?: unknown;
    event_id?: unknown;
    occurred_at?: unknown;
    landing_site?: unknown;
    referring_site?: unknown;
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
  // Classify source from the first-touch landing_site the storefront snippet
  // sends. landing_site is NOT stored in raw (keep raw PII-free as-is).
  // Defensive wrapper: a future change to the classifier must never 500 the
  // storefront — any throw falls back to 'direct'.
  const landingStr = typeof body.landing_site === 'string' ? body.landing_site : '';
  const referrerStr = typeof body.referring_site === 'string' ? body.referring_site : '';
  let source = 'direct';
  // TEMP DIAGNOSTIC (2026-06-06 — REMOVE after the "why are ATC 'direct'"
  // investigation). PII-FREE: utm_source/utm_medium are marketing labels
  // (length-capped), fbclid/gclid are presence booleans, landingLen is a
  // number. Lets us see, for 'direct' ATC, whether the beacon carried NO tag
  // (genuinely direct) vs an unmapped utm_source (extend the classifier).
  let diag: Record<string, unknown> = { landingLen: landingStr.length };
  try {
    const attr = classifyOrderAttribution({
      landing_site: landingStr || undefined,
      referring_site: referrerStr || undefined,
    });
    source = attr.source;
    diag = {
      utmSource: (attr.utmSource || '').slice(0, 64) || null,
      utmMedium: (attr.utmMedium || '').slice(0, 64) || null,
      fbclid: attr.fbclidPresent,
      gclid: attr.gclidPresent,
      landingLen: landingStr.length,
    };
  } catch {
    // never let attribution classification block the storefront's add-to-cart
    source = 'direct';
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
      raw: { product_title: productTitle, quantity, event_id: eventId, diag },
    });
  } catch (err) {
    console.error('[events/cart] ingest failed (acking 204 to not block storefront):', err);
  }

  // 5. Ack 204 (with CORS).
  return ack(origin);
}
