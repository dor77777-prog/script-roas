import type { DailyRow, DateRange } from './types';
import { TRANSACTION_FEES_RATE } from './costs';
import { billingForRange } from './billing';

/**
 * הערכת עלות סחורה (COGS) — אחוז קבוע מההכנסה היומית.
 * משמש גם להיסטוריה (תאריכים שעוד לא נכתבו עם הערך החדש ב-data-daily).
 *
 * אם משנים את הערך, יש לעדכן גם את COGS_RATE_OF_REVENUE ב-Config.gs (Apps Script).
 *
 * Note: at the read side this default is only used to back-fill historical
 * rows where `r.cogs` is missing (`hasCogs === false`). Live writers
 * (cron-daily, cron-live) now use the per-store rate from
 * `getCogsRateForStore`, mirroring the same helper in the cron functions.
 */
export const COGS_RATE_OF_REVENUE = 0.25;

/**
 * Audit fix 2026-05-23 (d/HI-02): per-store COGS rate at the read side.
 *
 * Mirrors `getCogsRateForStore` in cronDaily.ts + cronLive.ts so the
 * dashboard and the underlying `r.cogs` column agree per store. The env-var
 * key is identical (`${STORE_UPPERCASE}_COGS_RATE`) — a single env-var
 * update flows through both the writers AND this back-fill path.
 *
 * Only consulted when a row's `cogs` is missing (legacy / pre-migration
 * historical rows). Live rows already carry the correct per-store value
 * from the cron writer.
 */
export function getCogsRateForStore(storeId: string | undefined | null): number {
  if (!storeId) return COGS_RATE_OF_REVENUE;
  const envKey = `${String(storeId).toUpperCase()}_COGS_RATE`;
  const raw =
    typeof process !== 'undefined' ? process.env?.[envKey] : undefined;
  if (!raw) return COGS_RATE_OF_REVENUE;
  const parsed = parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return COGS_RATE_OF_REVENUE;
  }
  return parsed;
}

/**
 * Audit fix 2026-05-23 (d/HI-02): per-store transaction-fees rate.
 *
 * Transaction fees ARE computed at read time (no cron column for it), so
 * the per-store rate lookup must live here. Env-var convention:
 * `${STORE_UPPERCASE}_TX_FEES_RATE`. Fallback: 0.065 (the historical
 * project-wide constant), preserving prior behavior for un-calibrated
 * stores. Stores with very different processor mixes (e.g. one is mostly
 * PayPal at 5.9%, another is mostly Visa direct at ~2.7%) can now
 * calibrate independently.
 */
export function getTransactionFeesRateForStore(
  storeId: string | undefined | null,
): number {
  if (!storeId) return TRANSACTION_FEES_RATE;
  const envKey = `${String(storeId).toUpperCase()}_TX_FEES_RATE`;
  const raw =
    typeof process !== 'undefined' ? process.env?.[envKey] : undefined;
  if (!raw) return TRANSACTION_FEES_RATE;
  const parsed = parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return TRANSACTION_FEES_RATE;
  }
  return parsed;
}

export type Aggregate = {
  revenue: number;
  spend: number;
  fbSpend: number;
  gaSpend: number;
  /** Phase 05.7.7 — TikTok ad spend in CAD. 0 for stores without TikTok. */
  ttSpend: number;
  roas: number;
  grossProfit: number;       // revenue − ad spend
  cogs: number;              // 25% of revenue
  netProfit: number;         // revenue − ad spend − cogs   ("legacy net")
  /** Transaction processing fees (PayPal + currency conversion) — 6.5% of revenue. */
  transactionFees: number;
  /** Per-store monthly fixed costs (Shopify plan + apps + email) prorated to
   *  the number of days in the aggregate. */
  fixedCosts: number;
  /** Distinct stores active in the period (used for prorating fixed costs). */
  storeCount: number;
  /** Span the aggregate covers, in calendar days. Used for the fixed-cost
   *  proration math; 0 when the aggregate is empty. */
  daysCovered: number;
  /** revenue − ad spend − cogs − transaction fees − fixed costs.
   *  This is the *real* take-home after every cost line — what's left in
   *  the bank at the end of the period. */
  trueNetProfit: number;
  /** trueNetProfit / revenue. Useful as a margin chip. */
  trueMargin: number;
  rowCount: number;
};

export function filterRows(
  rows: DailyRow[],
  range: DateRange,
  store: string,
): DailyRow[] {
  return rows.filter(r => {
    if (r.date < range.from || r.date > range.to) return false;
    if (store !== 'All' && r.storeName !== store) return false;
    return true;
  });
}

export function aggregate(rows: DailyRow[], range?: DateRange): Aggregate {
  let revenue = 0, spend = 0, fbSpend = 0, gaSpend = 0, ttSpend = 0, cogs = 0;
  // Audit fix 2026-05-23 (d/HI-02): per-store rates. Transaction fees are
  // accumulated per row using the row's own store rate so an "All"-view
  // aggregate naturally becomes a revenue-weighted sum (high-AOV stores
  // with high fee rates contribute proportionally more). For COGS we only
  // back-fill the rate when a row has hasCogs === false (legacy rows that
  // pre-date the per-store-COGS write); live rows carry r.cogs already
  // computed by the cron writer with the correct per-store rate.
  let transactionFees = 0;
  const stores = new Set<string>();
  const dates = new Set<string>();
  let minDate: string | null = null;
  let maxDate: string | null = null;
  for (const r of rows) {
    revenue += r.revenue;
    spend += r.totalSpend;
    fbSpend += r.fbSpend;
    gaSpend += r.gaSpend;
    ttSpend += r.ttSpend ?? 0;
    // Back-fill COGS only when the row's column was empty (hasCogs false).
    // For live rows r.cogs is already the correct per-store value.
    const rowCogs = r.hasCogs
      ? r.cogs
      : r.revenue * getCogsRateForStore(r.storeId);
    cogs += rowCogs;
    transactionFees += r.revenue * getTransactionFeesRateForStore(r.storeId);
    stores.add(r.storeName);
    dates.add(r.date);
    if (!minDate || r.date < minDate) minDate = r.date;
    if (!maxDate || r.date > maxDate) maxDate = r.date;
  }
  const roas = spend > 0 ? revenue / spend : 0;
  // Fixed costs now come from the billing data layer (recurring + one-time
  // entries the user manages via the BillingSettings UI). When the user
  // hasn't entered any data yet, the layer returns 0 and the seed UI
  // prompts them to set it up.
  const storeNames = Array.from(stores);
  const daysCovered = dates.size;
  // Phase 05.7.8 — when caller hands in a request range, prefer it over
  // data-derived min/maxDate so the prorated fixed-cost slice matches what
  // the user actually selected (not just what data we have). Without this,
  // a 30-day window with 5 days of data was prorating fixed costs over 5
  // days only — silently overstating trueNetProfit.
  const billingFrom = range?.from ?? minDate;
  const billingTo = range?.to ?? maxDate;
  const billing = billingFrom && billingTo
    ? billingForRange({ from: billingFrom, to: billingTo, storeNames })
    : { total: 0 };
  const fixedCosts = billing.total;
  const trueNetProfit = revenue - spend - cogs - transactionFees - fixedCosts;
  return {
    revenue,
    spend,
    fbSpend,
    gaSpend,
    ttSpend,
    roas,
    grossProfit: revenue - spend,
    cogs,
    netProfit: revenue - spend - cogs,
    transactionFees,
    fixedCosts,
    storeCount: storeNames.length,
    daysCovered,
    trueNetProfit,
    trueMargin: revenue > 0 ? trueNetProfit / revenue : 0,
    rowCount: rows.length,
  };
}

export type StoreAgg = Aggregate & { store: string };

/**
 * Sibling of `aggregate` that splits a row collection into per-store buckets
 * and aggregates each bucket independently.
 *
 * Audit fix 2026-05-23 (d/CR-02): the inner `aggregate(list)` call now also
 * receives the caller's `range` (when supplied). Without it, each per-store
 * bucket's fixed-cost proration was anchored to that bucket's own min/max
 * date — which is shorter than the operator's selected range whenever a
 * store had no rows on the boundary days. Per-store cards therefore
 * understated fixed costs vs the global aggregate card, breaking the
 * invariant `sum(perStoreFixedCosts) ≈ globalFixedCosts` on multi-store
 * windows.
 *
 * The `range` arg is intentionally optional so existing callers that pre-date
 * the Phase 05.7.8 range plumbing continue to compile; consumers should pass
 * `filters.range` whenever it's available. TodayLive (which only ever holds
 * one day's rows) is fine without it — the bucket's min/max date IS that one
 * day. Dashboard.tsx:166 SHOULD pass `filters.range`.
 *
 * COORDINATION NOTE (audit-v2 Wave 1): Dashboard.tsx is owned by Agent B for
 * a separate change (GoalTracker prop wiring). Adding the `, filters.range`
 * argument at the call site is a 1-line wire-up Agent B can pick up — the
 * default behaviour stays correct (just sub-optimal) until they do.
 */
export function aggregateByStore(
  rows: DailyRow[],
  range?: DateRange,
): StoreAgg[] {
  const map = new Map<string, DailyRow[]>();
  for (const r of rows) {
    if (!map.has(r.storeName)) map.set(r.storeName, []);
    map.get(r.storeName)!.push(r);
  }
  const out: StoreAgg[] = [];
  for (const [store, list] of map) {
    out.push({ store, ...aggregate(list, range) });
  }
  return out.sort((a, b) => b.roas - a.roas);
}

export type DailySeries = {
  date: string;
  byStore: Record<string, number>; // store -> roas
  totalRoas: number;
  totalRevenue: number;
  totalSpend: number;
};

export function dailySeries(rows: DailyRow[], stores: string[]): DailySeries[] {
  const map = new Map<string, DailySeries>();
  for (const r of rows) {
    if (!map.has(r.date)) {
      map.set(r.date, {
        date: r.date,
        byStore: {},
        totalRoas: 0,
        totalRevenue: 0,
        totalSpend: 0,
      });
    }
    const entry = map.get(r.date)!;
    entry.byStore[r.storeName] = r.roas;
    entry.totalRevenue += r.revenue;
    entry.totalSpend += r.totalSpend;
  }
  for (const e of map.values()) {
    e.totalRoas = e.totalSpend > 0 ? e.totalRevenue / e.totalSpend : 0;
    // Fill missing stores with 0 for chart continuity
    for (const s of stores) {
      if (!(s in e.byStore)) e.byStore[s] = 0;
    }
  }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export function roasLabel(roas: number): { text: string; tone: 'red' | 'orange' | 'green' | 'blue' | 'gray' } {
  if (!roas || roas <= 0) return { text: 'אין נתונים', tone: 'gray' };
  if (roas < 2) return { text: 'דורש בחינה', tone: 'red' };
  if (roas < 2.7) return { text: 'סביר', tone: 'orange' };
  if (roas <= 3) return { text: 'טוב', tone: 'green' };
  return { text: 'מעולה', tone: 'blue' };
}

export function deltaPct(cur: number, prev: number): { value: number; direction: 'up' | 'down' | 'flat' } {
  // Direction is the sign of the *signed* change (cur - prev), not the sign
  // of the percent. This matters when `prev` is negative — e.g. net profit
  // going from -200 to +500 is an improvement, but (cur-prev)/prev with a
  // signed denominator would render as a negative percent + down arrow.
  if (cur === prev) return { value: 0, direction: 'flat' };
  const direction: 'up' | 'down' = cur > prev ? 'up' : 'down';

  // Denominator uses |prev| so the percent always represents "size of change
  // relative to the prior magnitude". When prev is zero we'd divide by zero;
  // fall back to |cur| (or 1) so the value stays finite — the arrow direction
  // is what matters most in that case anyway.
  const denom = prev !== 0 ? Math.abs(prev) : Math.max(Math.abs(cur), 1);
  const pct = (cur - prev) / denom;
  if (Math.abs(pct) < 0.001) return { value: 0, direction: 'flat' };
  return { value: pct, direction };
}
