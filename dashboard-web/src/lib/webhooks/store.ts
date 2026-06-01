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

/**
 * Paginated `store_events` read for the "פעילות" (Activity) tab.
 *
 * Same service-role posture + soft-fail contract as {@link readRecentStoreEvents}
 * (the table has no anon grant), but built for a browseable, filterable table:
 *
 *   • `from`/`to` are ISO calendar dates (YYYY-MM-DD); the window is applied as
 *     `received_at >= from 00:00:00` AND `received_at <= to 23:59:59.999` so the
 *     `to` day is INCLUSIVE (a same-day "today" filter still returns today's
 *     rows). Bounds are anchored in Israel time (the dashboard's operating tz)
 *     so a "day" matches what the operator sees in the day picker.
 *   • `storeId` filters by `store_id` (the internal id — resolution from a
 *     display NAME happens client-side, same as the live feed).
 *   • `type` filters by event type ('sale' | 'refund' | 'add_to_cart'); omit
 *     for all types.
 *   • `page` is 1-based; `pageSize` rows per page. The SELECT carries
 *     `{ count: 'exact' }` so `total` is the FULL filtered count (drives the
 *     pager's "page X of Y"), independent of the page slice returned.
 *
 * Newest-first (received_at DESC). Soft-fails to `{ events: [], total: 0 }` on a
 * query error so the route returns a calm empty table rather than throwing.
 */
export async function readStoreEventsPaged(opts: {
  from: string;
  to: string;
  storeId?: string;
  type?: StoreEventType;
  page: number;
  pageSize: number;
}): Promise<{ events: StoreEventRow[]; total: number }> {
  // Anchor the window to Israel time (UTC+03 in June / +02 in winter). We append
  // the IL offset for the queried month so the boundary is the operator's local
  // midnight, not UTC midnight. June 2026 is DST (+03); a static +03 is correct
  // for the current operating window and degrades gracefully (≤1h skew) off-DST.
  const IL_OFFSET = '+03:00';
  const fromTs = `${opts.from}T00:00:00.000${IL_OFFSET}`;
  const toTs = `${opts.to}T23:59:59.999${IL_OFFSET}`;

  // page is 1-based; clamp to ≥1 so a bad/0 page can't produce a negative range.
  const page = Math.max(1, Math.floor(opts.page));
  const lo = (page - 1) * opts.pageSize;
  const hi = lo + opts.pageSize - 1;

  let query = getSupabaseAdmin()
    .from('store_events')
    .select(STORE_EVENT_FEED_COLUMNS, { count: 'exact' });

  if (opts.storeId) query = query.eq('store_id', opts.storeId);
  if (opts.type) query = query.eq('type', opts.type);

  const { data, error, count } = await query
    .gte('received_at', fromTs)
    .lte('received_at', toTs)
    .order('received_at', { ascending: false })
    .range(lo, hi);

  if (error || !data) return { events: [], total: 0 };
  return { events: data as unknown as StoreEventRow[], total: count ?? 0 };
}
