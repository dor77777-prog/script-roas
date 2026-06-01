/**
 * Task 1.2 — normalize a raw Shopify webhook payload into a `store_events` row.
 *
 * PII is masked at this boundary and NEVER stored:
 *   - `customer_label` is at most a pair of initials ("A׳ C׳") or null. The raw
 *     customer name, email, phone, and addresses never leave this function.
 *   - `raw` is trimmed to a small non-PII allowlist (id, totals, currency,
 *     created_at, line_items[].{title,quantity}) so the JSONB column can never
 *     accidentally retain a name/email/address from a future payload shape.
 *
 * FX: `amount_cad` reuses the existing CAD-convert helper (makeCadConvert +
 * getFxRate from src/lib/fetchers/fx). On FX outage the helper returns null and
 * we KEEP `amount_original` + `currency` (the project-wide "stale > wrong"
 * money rule — see src/lib/inngest/cadConvert.ts). The fetcher is injectable so
 * tests stay hermetic (no Frankfurter calls).
 */

import { makeCadConvert } from '@/lib/inngest/cadConvert';
import { getFxRate } from '@/lib/fetchers/fx';

/**
 * FX rate fetcher signature — same shape as `getFxRate` (the production default).
 * Injectable so tests stay hermetic (no Frankfurter HTTP call). The value is fed
 * into `makeCadConvert`, which owns the "FX outage → null, preserve original"
 * contract (src/lib/inngest/cadConvert.ts).
 */
export type FxRateFetcher = (from: string, to: 'CAD', dateStr: string) => Promise<number>;

// Default production FX fetcher: getFxRate (Frankfurter), exactly like the
// workers do. makeCadConvert short-circuits CAD→CAD and amount===0 without a
// call, and returns null on any throw / non-finite / non-positive rate.
const defaultFxFetcher: FxRateFetcher = (from, to, dateStr) => getFxRate(from, to, dateStr);

export type StoreEventType = 'sale' | 'refund' | 'add_to_cart';

/** Normalized row shape — identical field names to `store_events` columns. */
export interface NormalizedStoreEvent {
  store_id: string;
  type: StoreEventType;
  amount_cad: number | null;
  currency: string | null;
  amount_original: number | null;
  product_title: string | null;
  quantity: number | null;
  customer_label: string | null;
  occurred_at: string;
  dedupe_key: string;
  raw: Record<string, unknown>;
}

export interface NormalizeOptions {
  storeId: string;
  webhookId: string;
  /**
   * Injectable FX rate fetcher (defaults to getFxRate / Frankfurter). Wrapped in
   * makeCadConvert internally, so the FX-outage-→-null contract is reused, not
   * re-implemented. Tests pass a deterministic fetcher.
   */
  cadConvert?: FxRateFetcher;
}

/** Map a Shopify webhook topic to the event type we surface, or null to ignore. */
export function topicToType(topic: string | null | undefined): StoreEventType | null {
  if (topic === 'orders/create') return 'sale';
  if (topic === 'refunds/create') return 'refund';
  return null;
}

/**
 * Mask a customer to initials only. Returns e.g. "A׳ C׳" or "א׳ כ׳", or a single
 * initial if only one name is present, or null if no name is available.
 *
 * The geresh (׳, U+05F3) is the Hebrew abbreviation mark — matches the dashboard's
 * Hebrew-first UI. We NEVER return the full given/family name.
 */
export function maskCustomerLabel(
  customer: { first_name?: string | null; last_name?: string | null } | null | undefined,
): string | null {
  if (!customer) return null;
  const parts: string[] = [];
  const first = (customer.first_name ?? '').trim();
  const last = (customer.last_name ?? '').trim();
  // Use the first code point (Array.from handles multi-byte/emoji safely).
  if (first) parts.push(`${Array.from(first)[0]}׳`);
  if (last) parts.push(`${Array.from(last)[0]}׳`);
  return parts.length > 0 ? parts.join(' ') : null;
}

function toFiniteNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

interface ShopifyLineItem {
  title?: string | null;
  quantity?: number | null;
}

interface OrderPayload {
  id?: number | string;
  total_price?: string | number;
  currency?: string;
  created_at?: string;
  customer?: { first_name?: string | null; last_name?: string | null } | null;
  line_items?: ShopifyLineItem[];
}

interface RefundLineItem {
  quantity?: number | null;
  subtotal?: string | number;
  line_item?: { title?: string | null } | null;
}

interface RefundPayload {
  id?: number | string;
  order_id?: number | string;
  created_at?: string;
  refund_line_items?: RefundLineItem[];
  transactions?: Array<{ amount?: string | number; currency?: string }>;
}

/** Trim line items to the non-PII allowlist (title + quantity only). */
function trimLineItems(items: ShopifyLineItem[] | undefined): Array<{ title: string | null; quantity: number | null }> {
  if (!Array.isArray(items)) return [];
  return items.map((li) => ({
    title: li?.title ?? null,
    quantity: toFiniteNumber(li?.quantity),
  }));
}

/**
 * Coerce a payload timestamp to a valid ISO string. `occurred_at` feeds a NOT
 * NULL timestamptz column AND the FX date slice, so a garbage/non-ISO value
 * (schema drift on a signature-valid webhook) could make the insert throw or
 * the FX date bogus. Fall back to "now" when it doesn't parse. (Review #6.)
 */
function safeIso(value: unknown): string {
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return value;
  return new Date().toISOString();
}

/**
 * Bound the CAD conversion so a hung FX service can't stall the webhook ack past
 * Shopify's ~5s window (Review #2). On timeout → null; the feed then shows
 * `amount_original` + `currency` (the project-wide "stale > wrong" money rule —
 * a CAD backfill is not worth blocking ingest + risking a retry storm). For the
 * common CAD-currency order makeCadConvert short-circuits with no fetch, so this
 * race only matters for the rare non-CAD payment.
 */
async function cadConvertBounded(
  convert: (amount: number, currency: string, dateStr: string) => Promise<number | null>,
  amount: number,
  currency: string,
  dateStr: string,
  ms = 1500,
): Promise<number | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([convert(amount, currency, dateStr), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Normalize an order (`sale`) or refund (`refund`) payload into a store event.
 * Async because CAD conversion may hit the FX service. Returns null when the
 * payload is unusable.
 */
export async function normalizeOrderEvent(
  type: StoreEventType,
  payload: unknown,
  opts: NormalizeOptions,
): Promise<NormalizedStoreEvent | null> {
  if (!payload || typeof payload !== 'object') return null;
  // Reuse the project's CAD-convert helper: makeCadConvert owns the
  // FX-outage→null + amount-0 short-circuit + CAD passthrough semantics.
  const cadConvert = makeCadConvert(opts.cadConvert ?? defaultFxFetcher);
  const dedupe_key = `webhook:${opts.webhookId}`;

  if (type === 'sale') {
    const order = payload as OrderPayload;
    const currency = order.currency ?? null;
    const amount_original = toFiniteNumber(order.total_price);
    const occurred_at = safeIso(order.created_at);
    const firstLine = Array.isArray(order.line_items) ? order.line_items[0] : undefined;

    const amount_cad =
      amount_original !== null && currency
        ? await cadConvertBounded(cadConvert, amount_original, currency, occurred_at.slice(0, 10))
        : null;

    return {
      store_id: opts.storeId,
      type: 'sale',
      amount_cad,
      currency,
      amount_original,
      product_title: firstLine?.title ?? null,
      quantity: toFiniteNumber(firstLine?.quantity),
      customer_label: maskCustomerLabel(order.customer),
      occurred_at,
      dedupe_key,
      raw: {
        id: order.id,
        total_price: order.total_price,
        currency: order.currency,
        created_at: order.created_at,
        line_items: trimLineItems(order.line_items),
      },
    };
  }

  // refund
  const refund = payload as RefundPayload;
  const occurred_at = safeIso(refund.created_at);
  const firstRefundLine = Array.isArray(refund.refund_line_items)
    ? refund.refund_line_items[0]
    : undefined;
  const firstTxn = Array.isArray(refund.transactions) ? refund.transactions[0] : undefined;

  // Refund total: prefer the transactions sum; fall back to the line-item subtotals.
  let gross: number | null = null;
  if (Array.isArray(refund.transactions) && refund.transactions.length > 0) {
    gross = refund.transactions.reduce((acc, t) => {
      const n = toFiniteNumber(t?.amount);
      return acc + (n ?? 0);
    }, 0);
  } else if (Array.isArray(refund.refund_line_items)) {
    gross = refund.refund_line_items.reduce((acc, li) => {
      const n = toFiniteNumber(li?.subtotal);
      return acc + (n ?? 0);
    }, 0);
  }

  const amount_original = gross === null ? null : -Math.abs(gross);
  const currency = firstTxn?.currency ?? null;

  const amount_cad =
    amount_original !== null && currency
      ? await cadConvertBounded(cadConvert, amount_original, currency, occurred_at.slice(0, 10))
      : null;

  return {
    store_id: opts.storeId,
    type: 'refund',
    amount_cad,
    currency,
    amount_original,
    product_title: firstRefundLine?.line_item?.title ?? null,
    quantity: toFiniteNumber(firstRefundLine?.quantity),
    customer_label: null, // refunds carry no customer object we surface
    occurred_at,
    dedupe_key,
    raw: {
      id: refund.id,
      order_id: refund.order_id,
      created_at: refund.created_at,
      currency,
      amount_original,
      refund_line_items: (refund.refund_line_items ?? []).map((li) => ({
        title: li?.line_item?.title ?? null,
        quantity: toFiniteNumber(li?.quantity),
        subtotal: li?.subtotal ?? null,
      })),
    },
  };
}
