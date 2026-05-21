// Phase 05.7.4 — WhatsApp daily-summary builder (TS port of Apps Script
// `Notifications.gs:buildStoreSummary_` at lines 267-321).
//
// Aggregates per-store and total spend / revenue / ROAS / order count for
// a single date. Pulls from Postgres (data_daily + orders_attribution),
// NOT from Sheets — Apps Script is dead as of Phase 05.7.0.
//
// Returns the same shape the template-parameter builder + Apps Script
// original consumed, so the downstream `buildTemplateParameters` carries
// over verbatim.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type StoreSummary = {
  storeName: string;
  fbSpend: number;
  gaSpend: number;
  ttSpend: number;          // Phase 05.7.5 — TikTok Ads spend (CAD). 0 until Phase B writer ships.
  totalSpend: number;
  revenue: number;
  roas: number;
  orders: number;
  facebook: number;
  google: number;
  tiktok: number;           // Phase 05.7.5 — order count classified as 'tiktok-paid'.
  other: number;
};

export type DaySummary = {
  dateStr: string;
  stores: Record<string, StoreSummary>;
  totals: {
    fbSpend: number;
    gaSpend: number;
    ttSpend: number;
    spend: number;
    revenue: number;
    orders: number;
    facebook: number;
    google: number;
    tiktok: number;
    other: number;
    roas: number;
  };
};

function admin(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'notifications/summary: missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars',
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Build the per-store + totals snapshot for a single date.
 *
 * Reads:
 *   - `data_daily` rows where date = dateStr → spend + revenue + storeName
 *   - `orders_attribution` rows where date = dateStr → bucketed source counts
 *
 * Source classification mirrors Apps Script `countOrdersForDate_` lines
 * 247-251:
 *   - facebook: `source === 'meta-paid'`
 *   - google:   `source === 'google-paid'`
 *   - other:    everything else (direct, meta-organic, google-organic, …)
 *
 * Returns null when no `data_daily` rows exist for `dateStr` — caller
 * handles by sending an "no data available" placeholder body.
 */
export async function buildStoreSummary(
  dateStr: string,
): Promise<DaySummary | null> {
  const sb = admin();
  const [dataDailyRes, ordersRes] = await Promise.all([
    sb
      .from('data_daily')
      .select(
        'store_id, store_name, fb_spend_cad, ga_spend_cad, tt_spend_cad, total_spend_cad, revenue_cad',
      )
      .eq('date', dateStr),
    sb.from('orders_attribution').select('store_id, source').eq('date', dateStr),
  ]);

  if (dataDailyRes.error) {
    throw new Error(
      `notifications/summary data_daily query: ${dataDailyRes.error.message}`,
    );
  }
  if (ordersRes.error) {
    throw new Error(
      `notifications/summary orders_attribution query: ${ordersRes.error.message}`,
    );
  }
  const dataRows = dataDailyRes.data ?? [];
  if (dataRows.length === 0) return null;
  const orderRows = ordersRes.data ?? [];

  // Pre-bucket orders by storeId so we can resolve in O(1).
  // Phase 05.7.5: 'tiktok-paid' gets its own bucket alongside facebook/google.
  type Counts = {
    total: number;
    facebook: number;
    google: number;
    tiktok: number;
    other: number;
  };
  const byStore: Record<string, Counts> = {};
  for (const r of orderRows) {
    const storeId = String(r.store_id ?? '').trim();
    if (!storeId) continue;
    if (!byStore[storeId]) {
      byStore[storeId] = {
        total: 0,
        facebook: 0,
        google: 0,
        tiktok: 0,
        other: 0,
      };
    }
    const src = String(r.source ?? '').trim();
    byStore[storeId].total++;
    if (src === 'meta-paid') byStore[storeId].facebook++;
    else if (src === 'google-paid') byStore[storeId].google++;
    else if (src === 'tiktok-paid') byStore[storeId].tiktok++;
    else byStore[storeId].other++;
  }

  const stores: Record<string, StoreSummary> = {};
  const totals = {
    fbSpend: 0,
    gaSpend: 0,
    ttSpend: 0,
    spend: 0,
    revenue: 0,
    orders: 0,
    facebook: 0,
    google: 0,
    tiktok: 0,
    other: 0,
    roas: 0,
  };

  for (const r of dataRows) {
    const storeId = String(r.store_id ?? '').trim();
    if (!storeId) continue;
    const storeName = String(r.store_name ?? storeId);
    const fbSpend = Number(r.fb_spend_cad ?? 0) || 0;
    const gaSpend = Number(r.ga_spend_cad ?? 0) || 0;
    // Phase 05.7.5 — tt_spend_cad is nullable until the writer ships in Phase B.
    const ttSpend = Number(r.tt_spend_cad ?? 0) || 0;
    const totalSpendRaw = r.total_spend_cad;
    const totalSpend =
      totalSpendRaw === null || totalSpendRaw === undefined
        ? fbSpend + gaSpend + ttSpend
        : Number(totalSpendRaw) || fbSpend + gaSpend + ttSpend;
    const revenue = Number(r.revenue_cad ?? 0) || 0;
    const counts = byStore[storeId] ?? {
      total: 0,
      facebook: 0,
      google: 0,
      tiktok: 0,
      other: 0,
    };
    stores[storeId] = {
      storeName,
      fbSpend,
      gaSpend,
      ttSpend,
      totalSpend,
      revenue,
      roas: totalSpend > 0 ? revenue / totalSpend : 0,
      orders: counts.total,
      facebook: counts.facebook,
      google: counts.google,
      tiktok: counts.tiktok,
      other: counts.other,
    };
    totals.fbSpend += fbSpend;
    totals.gaSpend += gaSpend;
    totals.ttSpend += ttSpend;
    totals.spend += totalSpend;
    totals.revenue += revenue;
    totals.orders += counts.total;
    totals.facebook += counts.facebook;
    totals.google += counts.google;
    totals.tiktok += counts.tiktok;
    totals.other += counts.other;
  }
  totals.roas = totals.spend > 0 ? totals.revenue / totals.spend : 0;

  return { dateStr, stores, totals };
}
