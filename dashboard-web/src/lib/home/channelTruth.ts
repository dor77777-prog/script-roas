// dashboard-web/src/lib/home/channelTruth.ts
//
// channel-nc-roas-split (Wave 2) — break the blended new-customer metrics down
// BY PAID CHANNEL (Meta / Google / TikTok). The blended NC-ROAS can hide one
// channel subsidising another (Meta 4× covering TikTok 1.2×); the per-channel
// split is the lever for daily budget reallocation.
//
// MAPPING-AWARE: per-channel revenue comes from the acquiring-channel label
// already on every order (`source`); per-channel spend is the per-platform
// data_daily spend (fb/ga/tt), PASSED IN — never recomputed from raw account
// totals. CAPI-safe: read-only, zero pixel/CAPI events.

import type { OrderSource } from '@/lib/ordersAttribution';
import type { FirstOrderInput } from '@/lib/home/newCustomerMetrics';

export type Channel = 'meta' | 'google' | 'tiktok';
export const CHANNELS = ['meta', 'google', 'tiktok'] as const satisfies readonly Channel[];

/** Map an order's acquiring source to a paid channel, or null (organic/direct/email/…). */
export function sourceToChannel(s: OrderSource | null | undefined): Channel | null {
  switch (s) {
    case 'meta-paid': return 'meta';
    case 'google-paid': return 'google';
    case 'tiktok-paid': return 'tiktok';
    default: return null;
  }
}

export interface ChannelMetric {
  channel: Channel;
  /** First-order revenue (CAD) attributed to this paid channel (net basis). */
  ncRevenue: number;
  /** Count of first-orders attributed to this paid channel. */
  ncOrders: number;
  /** Per-platform ad spend (CAD), mapping-aware (passed in). */
  spend: number;
  /** ncRevenue ÷ spend; null when spend ≤ 0 or no attributed revenue. */
  ncRoas: number | null;
  /** spend ÷ ncOrders; null when no attributed first-orders. */
  nCac: number | null;
  /**
   * per-channel-net-profit (Wave 2) — CONTRIBUTION net on new-customer
   * acquisition: ncRevenue × keepRate − spend (keepRate = 1 − COGS% − fees%).
   * Excludes fixed costs / salaries (not channel-attributable). null when the
   * channel has neither spend nor attributed revenue.
   */
  ncNetProfit: number | null;
}

/**
 * Per-channel new-customer metrics. `spendByChannel` is the per-platform CAD
 * spend over the SAME range as `rows` (e.g. {meta: curAgg.fbSpend, …}).
 * `storeName` optionally scopes to one store (matches computeNewCustomerMetrics).
 */
export function computeChannelTruth(
  rows: FirstOrderInput[],
  spendByChannel: Record<Channel, number>,
  storeName?: string,
  /**
   * Gross→net factor (default 1). The blended NC-ROAS is re-based onto NET
   * (refund-adjusted) revenue; pass the same factor so per-channel NC-ROAS
   * sits on the SAME basis as the blended number shown beside it. `ncRevenue`
   * is reported NET (already scaled); nCac/ncOrders are count-based (untouched).
   */
  netAdjust = 1,
  /**
   * Keep-rate (1 − COGS% − fees%, 0..1) for the CONTRIBUTION net-profit metric.
   * Default 1 → ncNetProfit = ncRevenue − spend (pre-COGS) for callers that
   * don't pass it; real callers derive it from the period's COGS + fees.
   */
  keepRate = 1,
): ChannelMetric[] {
  const scoped = storeName ? rows.filter((r) => r.storeName === storeName) : rows;
  const factor = Number.isFinite(netAdjust) && netAdjust > 0 ? netAdjust : 1;
  const keep = Number.isFinite(keepRate) ? Math.max(0, Math.min(1, keepRate)) : 1;
  return CHANNELS.map((channel) => {
    let ncRevenueGross = 0;
    let ncOrders = 0;
    for (const r of scoped) {
      if (r.isFirstOrder === true && sourceToChannel(r.source) === channel) {
        ncRevenueGross += Number.isFinite(r.totalCad) ? r.totalCad : 0;
        ncOrders += 1;
      }
    }
    const ncRevenue = ncRevenueGross * factor;
    const spend = Number.isFinite(spendByChannel[channel]) ? spendByChannel[channel] : 0;
    const ncRoas = spend > 0 && ncRevenue > 0 ? ncRevenue / spend : null;
    const nCac = ncOrders > 0 ? spend / ncOrders : null;
    const ncNetProfit = spend > 0 || ncRevenue > 0 ? ncRevenue * keep - spend : null;
    return { channel, ncRevenue, ncOrders, spend, ncRoas, nCac, ncNetProfit };
  });
}
