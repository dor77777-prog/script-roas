/**
 * Payment-gateway helpers (תשלומים breakdown).
 *
 * `orders_attribution.payment_gateway` stores the order's RAW primary gateway
 * name (e.g. `shopify_payments`, `paypal`, `gift_card`, `manual`). We keep the
 * raw value (not a pre-bucketed category) so categorization stays adjustable
 * and future per-gateway fee work is possible.
 *
 * - `primaryGateway` picks a single raw name from Shopify's
 *   `payment_gateway_names` array (an order can list multiple tenders):
 *   prefer the first name that is NOT a secondary tender (gift_card / manual /
 *   store credit), else fall back to the first name.
 * - `categorizePaymentGateway` buckets a raw name into credit / paypal / other.
 */

export type PaymentCategory = 'credit' | 'paypal' | 'other';

/** Secondary tenders that are usually settled alongside a real gateway. */
const SECONDARY = /gift[_ ]?card|manual|store credit/i;

/**
 * Pick the single raw primary gateway from Shopify's `payment_gateway_names`.
 * Prefers the first non-secondary tender; falls back to the first name.
 * Returns `null` for an empty / missing list.
 */
export function primaryGateway(names: string[] | undefined | null): string | null {
  if (!names || names.length === 0) return null;
  return names.find((n) => !SECONDARY.test(n)) ?? names[0];
}

/**
 * Categorize a raw gateway name into credit / paypal / other.
 *   paypal*                                            → paypal
 *   card brands / credit / card / stripe / shopify_pay → credit
 *   everything else (gift_card, manual, cod, NULL)     → other
 */
export function categorizePaymentGateway(raw: string | null | undefined): PaymentCategory {
  if (!raw) return 'other';
  if (/paypal/i.test(raw)) return 'paypal';
  // Secondary tenders (gift_card / manual / store credit) are always "other",
  // even though "gift_card" contains the substring "card".
  if (SECONDARY.test(raw)) return 'other';
  if (/visa|master|amex|discover|card|credit|stripe|shopify_payments|bogus/i.test(raw)) return 'credit';
  return 'other';
}
