import type { DailyRow, DateRange } from './types';
import { TRANSACTION_FEES_RATE, prorateFixedCosts } from './costs';

/**
 * הערכת עלות סחורה (COGS) — אחוז קבוע מההכנסה היומית.
 * משמש גם להיסטוריה (תאריכים שעוד לא נכתבו עם הערך החדש ב-data-daily).
 *
 * אם משנים את הערך, יש לעדכן גם את COGS_RATE_OF_REVENUE ב-Config.gs (Apps Script).
 */
export const COGS_RATE_OF_REVENUE = 0.25;

export type Aggregate = {
  revenue: number;
  spend: number;
  fbSpend: number;
  gaSpend: number;
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
  cogsCoverage: number; // 0..1 - share of rows that had COGS reported
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

export function aggregate(rows: DailyRow[]): Aggregate {
  let revenue = 0, spend = 0, fbSpend = 0, gaSpend = 0, cogs = 0, cogsRows = 0;
  const stores = new Set<string>();
  const dates = new Set<string>();
  for (const r of rows) {
    revenue += r.revenue;
    spend += r.totalSpend;
    fbSpend += r.fbSpend;
    gaSpend += r.gaSpend;
    cogs += r.cogs;
    if (r.hasCogs) cogsRows++;
    stores.add(r.storeName);
    dates.add(r.date);
  }
  const roas = spend > 0 ? revenue / spend : 0;
  const transactionFees = revenue * TRANSACTION_FEES_RATE;
  // Fixed costs (Shopify plan + apps + email) get prorated across the days
  // the aggregate covers, applied to every store that was active. So a
  // 16-day, 3-store view bills 16/30 of the monthly fixed costs × 3.
  const storeNames = Array.from(stores);
  const daysCovered = dates.size;
  const fixedCosts = prorateFixedCosts(storeNames, daysCovered);
  const trueNetProfit = revenue - spend - cogs - transactionFees - fixedCosts;
  return {
    revenue,
    spend,
    fbSpend,
    gaSpend,
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
    cogsCoverage: rows.length > 0 ? cogsRows / rows.length : 0,
    rowCount: rows.length,
  };
}

export type StoreAgg = Aggregate & { store: string };

export function aggregateByStore(rows: DailyRow[]): StoreAgg[] {
  const map = new Map<string, DailyRow[]>();
  for (const r of rows) {
    if (!map.has(r.storeName)) map.set(r.storeName, []);
    map.get(r.storeName)!.push(r);
  }
  const out: StoreAgg[] = [];
  for (const [store, list] of map) {
    out.push({ store, ...aggregate(list) });
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
  if (!prev) return { value: 0, direction: 'flat' };
  const pct = (cur - prev) / prev;
  if (Math.abs(pct) < 0.001) return { value: 0, direction: 'flat' };
  return { value: pct, direction: pct > 0 ? 'up' : 'down' };
}
