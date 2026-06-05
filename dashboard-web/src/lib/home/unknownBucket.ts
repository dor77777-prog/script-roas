/**
 * Decompose the UNKNOWN/direct order bucket by signals ALREADY on each row.
 *
 * The unknown bucket is the set of orders that carry NO attribution signal —
 * the exact complement of `hasAttributionSignal` (the same predicate the hero
 * CoverageChip uses, so the panel can never disagree with the chip). This is a
 * DESCRIPTIVE slice (who ARE these orders?) — it NEVER redistributes the
 * unknown share across channels (covered + unknown still = 100%).
 *
 * CAPI-safe: pure compute over orders_attribution fields already in hand; zero
 * pixel/CAPI events. Mapping-aware by construction (rows are written
 * mapping-resolved).
 */
import type { OrderAttributionRow } from '@/lib/ordersAttribution';
import { hasAttributionSignal } from '@/lib/home/adapters';
import { categorizePaymentGateway, type PaymentCategory } from '@/lib/payments';

/** AOV band edges (CAD). low < 50 ≤ mid ≤ 70 < high — home-aligned bands
 *  (operator 2026-06-05): matches the per-store AOV color rule (>70 strong /
 *  <50 weak / 50–70 neutral). */
export const AOV_LOW_MAX = 50;
export const AOV_HIGH_MIN = 70;
/** Max products surfaced in the breakdown. */
export const TOP_PRODUCTS_N = 5;

export interface UnknownBucketBreakdown {
  unknownOrders: number;
  unknownRevenueCad: number;
  newVsReturning: { new: number; returning: number; unclassifiable: number };
  aovBands: { low: number; mid: number; high: number };
  byStore: Array<{ store: string; orders: number }>;
  topProducts: Array<{ productId: string; units: number; revenueCad: number }>;
  byPaymentCategory: Record<PaymentCategory, number>;
}

function emptyBreakdown(): UnknownBucketBreakdown {
  return {
    unknownOrders: 0,
    unknownRevenueCad: 0,
    newVsReturning: { new: 0, returning: 0, unclassifiable: 0 },
    aovBands: { low: 0, mid: 0, high: 0 },
    byStore: [],
    topProducts: [],
    byPaymentCategory: { credit: 0, paypal: 0, other: 0 },
  };
}

export function decomposeUnknownBucket(
  rows: readonly OrderAttributionRow[],
): UnknownBucketBreakdown {
  const out = emptyBreakdown();
  const storeCounts = new Map<string, number>();
  const productAgg = new Map<string, { units: number; revenueCad: number }>();

  for (const o of rows) {
    if (hasAttributionSignal(o)) continue; // covered — never counted here
    out.unknownOrders += 1;
    const aov = Number.isFinite(o.totalCad) ? o.totalCad : 0;
    out.unknownRevenueCad += aov;

    if (o.isFirstOrder === true) out.newVsReturning.new += 1;
    else if (o.isFirstOrder === false) out.newVsReturning.returning += 1;
    else out.newVsReturning.unclassifiable += 1;

    if (aov < AOV_LOW_MAX) out.aovBands.low += 1;
    else if (aov > AOV_HIGH_MIN) out.aovBands.high += 1;
    else out.aovBands.mid += 1;

    storeCounts.set(o.storeName, (storeCounts.get(o.storeName) ?? 0) + 1);

    out.byPaymentCategory[categorizePaymentGateway(o.paymentGateway)] += 1;

    for (const li of o.lineItems) {
      const cur = productAgg.get(li.productId) ?? { units: 0, revenueCad: 0 };
      cur.units += Number.isFinite(li.units) ? li.units : 0;
      cur.revenueCad += Number.isFinite(li.revenueCad) ? li.revenueCad : 0;
      productAgg.set(li.productId, cur);
    }
  }

  out.byStore = [...storeCounts.entries()]
    .map(([store, orders]) => ({ store, orders }))
    .sort((a, b) => b.orders - a.orders);

  out.topProducts = [...productAgg.entries()]
    .map(([productId, v]) => ({ productId, units: v.units, revenueCad: v.revenueCad }))
    .sort((a, b) => b.units - a.units)
    .slice(0, TOP_PRODUCTS_N);

  return out;
}
