import type { DailyRow, DateRange } from './types';
import { TRANSACTION_FEES_RATE } from './costs';
import { billingForRange } from './billing';
import { enumerateDateRange } from './dateRange';

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
  /** Business-level salaries deduction for the period (CAD). Subtracted in
   *  trueNetProfit only; 0 when no salary settings are applied. */
  salaries: number;
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

export function aggregate(
  rows: DailyRow[],
  range?: DateRange,
  /**
   * Audit fix 2026-05-23 (CRIT-1 / O3-CR-01): optional in-scope store list.
   * When provided, `billingForRange` is called with this list rather than the
   * row-derived set — so the per-store call path (`aggregateByStore`) can
   * give the FULL store universe to billingForRange even though each
   * bucket's rows belong to just one store. Without it, an "All"-scoped
   * billing row would be charged in full to each per-store bucket
   * (because singleton `storeNames.length === 1` defeats the fair-share
   * split inside billingForRange). Sum of per-store True-Net-Profit cards
   * then inflated 2-3× over the global card.
   *
   * When `scopedStoreNames` is omitted, behavior is unchanged: billing
   * proration uses the set derived from the rows themselves (matches the
   * historical global-aggregate semantics).
   */
  scopedStoreNames?: string[],
  /**
   * Phase 13.1 (2026-05-24) — per-store revenue split, supplied by
   * `aggregateByStore` so the per-store path can hand `billingForRange`
   * the FULL period revenue (sum of map values) for percent-of-revenue
   * "All" rows, AND the per-store breakdown for store-specific percent
   * rows. Without this, each bucket's `aggregate` call used the bucket's
   * own revenue as the "global", and the All-row percent contribution
   * collapsed to global / storeCount (Σ per-store = global / N instead
   * of global). When omitted (global aggregate path), the call uses the
   * row-derived `revenue` exactly as before.
   */
  revenueByStore?: Record<string, number>,
  /**
   * Phase 2026-06-02 — precomputed business-level salaries deduction for
   * this range (from `salariesForRange`). Subtracted in `trueNetProfit`
   * ONLY. The operating-profit path (revenue − spend − cogs, computed in
   * lib/home/adapters.ts) and the legacy `netProfit` field are untouched.
   * Defaults to 0 so every existing caller is unaffected.
   */
  salaries: number = 0,
): Aggregate {
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
  const rowStoreNames = Array.from(stores);
  // Audit fix 2026-05-23 (CRIT-1): for `billingForRange` use the explicit
  // scoped store list when the caller supplied one (per-store path from
  // `aggregateByStore`), otherwise fall back to the row-derived set
  // (global aggregate path). The `storeCount` shown on cards still
  // reflects the rows themselves (rowStoreNames) so a single-store
  // bucket reports storeCount=1 even though billing prorated against
  // the full universe.
  const billingStoreNames = scopedStoreNames ?? rowStoreNames;
  const daysCovered = dates.size;
  // Phase 05.7.8 — when caller hands in a request range, prefer it over
  // data-derived min/maxDate so the prorated fixed-cost slice matches what
  // the user actually selected (not just what data we have). Without this,
  // a 30-day window with 5 days of data was prorating fixed costs over 5
  // days only — silently overstating trueNetProfit.
  const billingFrom = range?.from ?? minDate;
  const billingTo = range?.to ?? maxDate;
  // Phase 12.5.x (2026-05-24) — pass `revenue` so percent-of-revenue
  // recurring rows can compute their contribution to fixedCosts. Without
  // this thread, a recurring row marked as "5% of revenue" silently
  // contributed 0 to the P&L, breaking the True Net Profit math.
  //
  // Phase 13.1 (2026-05-24) — when `revenueByStore` is supplied (per-store
  // path from `aggregateByStore`), derive the GLOBAL revenue from its
  // values rather than from the bucket's own rows. Otherwise the All-row
  // percent calc would use storeA_rev instead of totalRev, collapsing
  // Σ per-store to global / N. Also forward `revenueByStore` itself so
  // store-specific percent rows charge against THEIR store's revenue.
  const billing = billingFrom && billingTo
    ? billingForRange({
        from: billingFrom,
        to: billingTo,
        storeNames: billingStoreNames,
        ...(revenueByStore
          ? {
              revenue: Object.values(revenueByStore).reduce(
                (a, b) => a + b,
                0,
              ),
              revenueByStore,
            }
          : { revenue }),
      })
    : { total: 0, byStore: {} as Record<string, number> };
  // Audit fix 2026-05-23 (CRIT-1): when running the per-store path, the
  // per-store bucket should only carry ITS share of the period's
  // fixed costs — not the global total. `billingForRange` returns a
  // `byStore` breakdown that splits "All"-scoped rows evenly across the
  // in-scope universe. Picking the bucket's own share keeps the global
  // invariant: sum(per-store fixedCosts) == global fixedCosts.
  let fixedCosts: number;
  if (scopedStoreNames && rowStoreNames.length === 1) {
    const bucketStore = rowStoreNames[0];
    const byStore =
      (billing as { byStore?: Record<string, number> }).byStore ?? {};
    fixedCosts = byStore[bucketStore] ?? 0;
  } else {
    fixedCosts = billing.total;
  }
  const trueNetProfit = revenue - spend - cogs - transactionFees - fixedCosts - salaries;
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
    salaries,
    storeCount: rowStoreNames.length,
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
  // Phase 13.1 (2026-05-24) — precompute per-store revenue once in the same
  // pass that buckets rows. Threaded into each per-store `aggregate` call so
  // its `billingForRange` invocation can compute the GLOBAL revenue (sum of
  // values) for All-scoped percent rows AND the per-store slice for store-
  // specific percent rows. Without this, Σ per-store fixedCosts collapsed
  // to global / storeCount for percent-of-revenue rows (Phase 13.1 P0-A).
  const revenueByStore: Record<string, number> = {};
  for (const r of rows) {
    if (!map.has(r.storeName)) map.set(r.storeName, []);
    map.get(r.storeName)!.push(r);
    revenueByStore[r.storeName] = (revenueByStore[r.storeName] ?? 0) + r.revenue;
  }
  // Audit fix 2026-05-23 (CRIT-1 / O3-CR-01): pass the FULL in-scope store
  // universe to each per-store `aggregate` call. Without it each call's
  // billingForRange sees `storeNames.length === 1` (the singleton bucket)
  // and the "All"-row fair-share split degrades to "the whole amount per
  // store" — inflating every per-store True-Net-Profit card. The new
  // third arg lets `aggregate` itself ask billingForRange to split across
  // the same universe the global aggregate would, then attribute only
  // this bucket's share to the StoreAgg.
  const scopedStoreNames = Array.from(map.keys());
  const out: StoreAgg[] = [];
  for (const [store, list] of map) {
    out.push({
      store,
      ...aggregate(list, range, scopedStoreNames, revenueByStore),
    });
  }
  return out.sort((a, b) => b.roas - a.roas);
}

export type DailySeries = {
  date: string;
  /**
   * Per-store ROAS for the day. `null` means "no data for that store on
   * that day" — distinct from `0` (which is a real "spent but earned
   * nothing" outcome). Charts that bind to these values must use
   * `connectNulls={false}` so the visual gap is preserved.
   *
   * Audit fix 2026-05-23 (CRIT-3 + HIGH-8): previously this was
   * `Record<string, number>` and the function back-filled missing
   * (store, day) cells with `0`. That made a temporary data outage look
   * like a catastrophic ROAS=0 day on the chart instead of a true gap.
   */
  byStore: Record<string, number | null>;
  totalRoas: number;
  totalRevenue: number;
  totalSpend: number;
};

/**
 * Build the per-day series for the RoasChart.
 *
 * Audit fix 2026-05-23 (CRIT-3 + HIGH-8):
 *
 *   - When `range` is provided, the result walks EVERY calendar day in
 *     `[range.from, range.to]` (inclusive). Days with no data emit a row
 *     whose per-store values are all `null` and whose totals are 0.
 *     Pre-fix behavior skipped missing days entirely — combined with the
 *     RoasChart's categorical X-axis, a 5-day outage in a 30-day window
 *     was rendered as a single 1-day step between the surrounding active
 *     points, visually compressing reality (CRIT-3).
 *
 *   - Missing per-store cells on a day where SOME store has data emit
 *     `null` (not `0`). Previously they were forced to `0`, which the
 *     RoasChart drew as a real ROAS=0 dot — indistinguishable from a
 *     legitimate "spent without earning" disaster (HIGH-8).
 *
 *   - When `range` is omitted, behavior is unchanged from the legacy
 *     contract: rows present in `rows` become rows in the result; missing
 *     per-store cells become `null` (the safer default for charts that
 *     opt in to gap rendering).
 *
 * Callers MUST render with `connectNulls={false}` on every per-store
 * <Line> for the gap visualization to be honest.
 */
export function dailySeries(
  rows: DailyRow[],
  stores: string[],
  range?: DateRange,
): DailySeries[] {
  const map = new Map<string, DailySeries>();

  // First pass — accumulate everything from the rows themselves.
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

  // Determine the date universe. When `range` is supplied, every day in
  // [range.from, range.to] gets a row (with `null` per-store values where
  // no data exists). Otherwise, only the dates already present in `rows`
  // get a row (legacy behavior).
  const dateList = range
    ? enumerateDateRange(range.from, range.to)
    : Array.from(map.keys()).sort((a, b) => a.localeCompare(b));

  // Ensure a row exists for every date in scope, then fill missing per-store
  // cells with `null` (NOT 0 — the chart needs to distinguish "no data" from
  // "spent without earning").
  for (const date of dateList) {
    if (!map.has(date)) {
      map.set(date, {
        date,
        byStore: {},
        totalRoas: 0,
        totalRevenue: 0,
        totalSpend: 0,
      });
    }
    const entry = map.get(date)!;
    entry.totalRoas = entry.totalSpend > 0 ? entry.totalRevenue / entry.totalSpend : 0;
    for (const s of stores) {
      if (!(s in entry.byStore)) entry.byStore[s] = null;
    }
  }

  // Sort to the date universe order (chronological for both branches).
  return dateList.map((date) => map.get(date)!);
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
