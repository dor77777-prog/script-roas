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
import type { NormalizedStoreEvent, StoreEventType } from './normalizeShopifyEvent';

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

/**
 * A `store_events` row as read back for the feed. The display columns the
 * UI renders (type/amount/product/store/time) plus the `received_at` that
 * drives the LIVE-badge freshness. `raw`/`dedupe_key` are deliberately NOT
 * selected — the feed never needs them and the audit blob can carry bulk.
 */
export interface StoreEventRow {
  id: string;
  store_id: string;
  type: StoreEventType;
  amount_cad: number | null;
  currency: string | null;
  amount_original: number | null;
  product_title: string | null;
  quantity: number | null;
  customer_label: string | null;
  occurred_at: string;
  received_at: string;
}

/**
 * Columns selected for the feed read. Excludes `raw` (bulky audit JSON) and
 * `dedupe_key` (internal). Kept as a constant so the SELECT and the row type
 * can't silently drift.
 */
const STORE_EVENT_FEED_COLUMNS =
  'id, store_id, type, amount_cad, currency, amount_original, product_title, quantity, customer_label, occurred_at, received_at';

/**
 * Read the most-recent store events, newest-first (received_at DESC), capped at
 * `limit`. Optional `storeId` filters to a single store. Service-role: the
 * `store_events` table has NO anon grant by design, so the read route reaches it
 * through the admin client (same posture as the rest of the dashboard's reads).
 *
 * Soft-fails to `[]` on a query error so the read route returns a calm empty feed
 * (the LIVE badge then shows its idle/disconnected state) instead of throwing.
 */
export async function readRecentStoreEvents(opts: {
  limit: number;
  storeId?: string;
}): Promise<StoreEventRow[]> {
  let query = getSupabaseAdmin().from('store_events').select(STORE_EVENT_FEED_COLUMNS);

  // The store filter goes BEFORE order/limit so we cap AFTER filtering (the
  // newest `limit` rows FOR that store, not the newest `limit` rows globally
  // then filtered down).
  if (opts.storeId) {
    query = query.eq('store_id', opts.storeId);
  }

  const { data, error } = await query
    .order('received_at', { ascending: false })
    .limit(opts.limit);

  if (error || !data) return [];
  return data as unknown as StoreEventRow[];
}
