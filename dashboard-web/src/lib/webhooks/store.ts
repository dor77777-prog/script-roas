/**
 * Task 1.3 — `store_webhooks` reader + `store_events` writer.
 *
 * Server-only. Uses the service-role client (getSupabaseAdmin) because the
 * webhook/cart ingest paths run with no user session and need INSERT coverage
 * that anon lacks (see src/lib/supabaseAdmin.ts).
 *
 * Lookups soft-fail to null on a query error so the route can ack+drop fast
 * (Shopify stops retrying) rather than 500ing. The insert is idempotent on
 * `dedupe_key` via an ignore-duplicates upsert.
 */

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import type { NormalizedStoreEvent } from './normalizeShopifyEvent';

export interface ShopDomainRoute {
  store_id: string;
  signing_secret: string | null;
  enabled: boolean;
}

export interface CartTokenRoute {
  store_id: string;
  allowed_origins: string[];
  enabled: boolean;
}

/**
 * Resolve a Shopify shop domain (X-Shopify-Shop-Domain) to its routing row.
 * Returns null when unknown or on a query error.
 */
export async function lookupStoreByShopDomain(
  shopDomain: string,
): Promise<ShopDomainRoute | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('store_webhooks')
    .select('store_id, signing_secret, enabled')
    .eq('shop_domain', shopDomain)
    .maybeSingle();

  if (error || !data) return null;
  return data as ShopDomainRoute;
}

/**
 * Resolve a client cart token to its routing row (used by Phase 2's
 * /api/events/cart). Returns null when unknown or on a query error.
 */
export async function lookupStoreByCartToken(
  token: string,
): Promise<CartTokenRoute | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('store_webhooks')
    .select('store_id, allowed_origins, enabled')
    .eq('cart_public_token', token)
    .maybeSingle();

  if (error || !data) return null;
  return data as CartTokenRoute;
}

/**
 * Insert a normalized event. Idempotent on `dedupe_key`: a duplicate is a
 * no-op (ignoreDuplicates), so Shopify retries / double-delivery never produce
 * a second row.
 */
export async function insertStoreEvent(event: NormalizedStoreEvent): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from('store_events')
    .upsert(event, { onConflict: 'dedupe_key', ignoreDuplicates: true });

  if (error) {
    throw new Error(`insertStoreEvent failed: ${error.message ?? String(error)}`);
  }
}
