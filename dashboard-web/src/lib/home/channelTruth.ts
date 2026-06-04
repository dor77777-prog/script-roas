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

import type { OrderSource, OrderAttributionRow } from '@/lib/ordersAttribution';
import type { CampaignRow } from '@/lib/campaigns';
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

/**
 * Map a CampaignRow's title-case `platform` ('Meta'|'Google'|'TikTok') to a
 * paid channel, or null for anything else. Campaign platforms are title-case
 * (see lib/campaigns.ts CampaignRow), unlike order `source` labels.
 */
function platformToChannel(p: string | null | undefined): Channel | null {
  switch (p) {
    case 'Meta': return 'meta';
    case 'Google': return 'google';
    case 'TikTok': return 'tiktok';
    default: return null;
  }
}

/**
 * channel-overcount-delta (WS2 #12) — per-acquiring-channel "overcount %":
 * how much the platform's SELF-REPORTED conversion value (Σ campaign
 * conversionValue) exceeds the Shopify click-ID-VERIFIED revenue (Σ order
 * totalCad whose `source` resolves to that channel). A positive overcount
 * means the platform is claiming more revenue than deterministic click-IDs
 * can confirm (modeled / view-through / cross-device fill).
 *
 * verified counts ALL orders for the channel (NOT first-order-only) — the
 * platform's claim covers every conversion, so the verified side must too.
 *
 * overcountPct = claim > 0 ? max(0, (claim − verified) / claim) : null.
 * Negative / halo (verified ≥ claim) clamps to 0; null when there's no claim
 * (can't compute a ratio of nothing). Returns an entry for every channel.
 *
 * Pure + read-only; CAPI-safe (no pixel/CAPI events).
 */
export function overcountByChannelFromCampaigns(
  campaigns: CampaignRow[],
  orders: OrderAttributionRow[],
  from: string,
  to: string,
  storeName?: string,
): Record<Channel, { claim: number; verified: number; overcountPct: number | null }> {
  const inWindow = (date: string, store: string) =>
    date >= from && date <= to && (storeName ? store === storeName : true);

  const claim: Record<Channel, number> = { meta: 0, google: 0, tiktok: 0 };
  for (const c of campaigns) {
    if (!inWindow(c.date, c.storeName)) continue;
    const ch = platformToChannel(c.platform);
    if (!ch) continue;
    claim[ch] += Number.isFinite(c.conversionValue) ? c.conversionValue : 0;
  }

  const verified: Record<Channel, number> = { meta: 0, google: 0, tiktok: 0 };
  for (const o of orders) {
    if (!inWindow(o.date, o.storeName)) continue;
    const ch = sourceToChannel(o.source);
    if (!ch) continue;
    verified[ch] += Number.isFinite(o.totalCad) ? o.totalCad : 0;
  }

  const out = {} as Record<Channel, { claim: number; verified: number; overcountPct: number | null }>;
  for (const channel of CHANNELS) {
    const cl = claim[channel];
    const ve = verified[channel];
    const overcountPct = cl > 0 ? Math.max(0, (cl - ve) / cl) : null;
    out[channel] = { claim: cl, verified: ve, overcountPct };
  }
  return out;
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
  /**
   * channel-overcount-delta (WS2 #12) — fraction (0..1) by which the platform's
   * self-reported conversion value exceeds Shopify click-ID-verified revenue
   * for this channel. null when there's no platform claim to compare against
   * (or no overcount data threaded through). See `overcountByChannelFromCampaigns`.
   */
  overcountPct: number | null;
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
  /**
   * channel-overcount-delta (WS2 #12) — per-channel overcount fraction (0..1)
   * or null, typically derived via `overcountByChannelFromCampaigns(...)`.
   * Optional + defaults to undefined → every channel's `overcountPct` is null
   * (backward-compatible with callers/tests passing ≤5 args).
   */
  overcountByChannel?: Partial<Record<Channel, number | null>>,
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
    const overcountPct = overcountByChannel?.[channel] ?? null;
    return { channel, ncRevenue, ncOrders, spend, ncRoas, nCac, ncNetProfit, overcountPct };
  });
}
