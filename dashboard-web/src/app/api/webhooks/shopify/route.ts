/**
 * Task 1.4 — Shopify server-webhook ingest (HMAC).
 *
 * Trust model: Shopify cannot present the dashboard cookie, so this path is
 * allowlisted in middleware (see isDashboardAuthAllowlisted) and authenticates
 * per-request via the X-Shopify-Hmac-Sha256 signature over the EXACT raw bytes.
 *
 * Failure modes (chosen so Shopify stops retrying on anything we can't act on):
 *   - malformed headers   → 200 ack+drop
 *   - unknown/disabled shop → 200 ack+drop (no insert)
 *   - bad signature       → 401 (Shopify will retry; the operator mis-keyed it)
 *   - non-surfaced topic  → 200 (no insert)
 *   - unparseable JSON     → 200 (no insert)
 *   - valid               → 200 + idempotent insert (dedupe on webhook id)
 *
 * Ack fast (<5s): the only work after the signature check is normalize + one
 * idempotent upsert.
 */

import { NextResponse } from 'next/server';
import { verifyShopifyHmac } from '@/lib/webhooks/shopifyHmac';
import { topicToType, normalizeOrderEvent } from '@/lib/webhooks/normalizeShopifyEvent';
import { lookupStoreByShopDomain, insertStoreEvent } from '@/lib/webhooks/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  // 1. RAW body FIRST (HMAC is over the exact bytes — never req.json() before this).
  const raw = await req.text();
  const shop = req.headers.get('x-shopify-shop-domain');
  const topic = req.headers.get('x-shopify-topic');
  const webhookId = req.headers.get('x-shopify-webhook-id');
  const sig = req.headers.get('x-shopify-hmac-sha256');

  // ack+drop malformed (no DB work)
  if (!shop || !topic || !webhookId) return NextResponse.json({ ok: true }, { status: 200 });

  const store = await lookupStoreByShopDomain(shop);
  // Unknown or disabled store → 200 ack + drop (so Shopify stops retrying).
  if (!store || !store.enabled) return NextResponse.json({ ok: true }, { status: 200 });

  if (!verifyShopifyHmac(raw, sig, store.signing_secret)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  const type = topicToType(topic);
  if (!type) return NextResponse.json({ ok: true }, { status: 200 }); // topic we don't surface

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // Post-verify work is wrapped so a transient DB error / FX hiccup / schema
  // drift CANNOT bubble to a 500 — that would make Shopify retry the SAME
  // (already-acked-intent) webhook for up to 48h, the exact retry-storm the
  // failure-mode contract above is designed to avoid. We log + ack 200 instead;
  // the insert is idempotent so a later manual replay is safe. (Review #1.)
  try {
    const event = await normalizeOrderEvent(type, payload, {
      storeId: store.store_id,
      webhookId,
    });
    if (event) await insertStoreEvent(event); // idempotent on dedupe_key
  } catch (err) {
    console.error('[webhooks/shopify] ingest failed (acking 200 to stop retries):', err);
  }

  // Ack fast (<5s). Keep all work above minimal.
  return NextResponse.json({ ok: true }, { status: 200 });
}
