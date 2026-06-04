/**
 * reconcileLive.ts — DQ-1 server-side live reconciliation.
 *
 * `reconcileLive()` fetches the SAME four production source datasets the
 * `audit:reconcile` harness compares — data_daily, products_daily,
 * campaigns_daily, orders_attribution — for a recent COMPLETED window, shapes
 * them into `ReconcileRowsInput`, and delegates to the pure `reconcileRows()`
 * core. It does NOT re-implement any of the invariant checks: it is purely the
 * fetch + shape adapter (the live harness does the same thing over HTTP via
 * `/api/data` etc.; here we read Supabase directly server-side via the
 * postgresReaders the same routes use under the hood).
 *
 * Window: the last ~7 COMPLETED days, EXCLUDING the current Israel-local day.
 * Today's row is still being written by cron-live every ~10 min, so including
 * it would surface transient mid-write cross-source gaps as false violations.
 * `to` = yesterday (IL), `from` = today − 7 (IL) — anchoring the arithmetic in
 * UTC ms off the IL "today" string (same DST-safe pattern as `defaultRange()`).
 */

import {
  fetchDailyDataFromPostgres,
  fetchProductsFromPostgres,
  fetchCampaignsFromPostgres,
  fetchOrdersAttributionFromPostgres,
} from '@/lib/postgresReaders';
import { getTodayInIsraelTz } from '@/lib/dateRange';
import type { DateRange } from '@/lib/dateRange';
import { reconcileRows } from './reconcileRows';
import type {
  ReconcileRowsInput,
  ReconcileDataRow,
  ReconcileProductRow,
  ReconcileCampaignRow,
  ReconcileOrderRow,
} from './reconcileRows';
import type { Violation } from './reconcile';

/** Days back from yesterday (inclusive) the live window reconciles. */
const WINDOW_DAYS = 7;

/** Format a UTC-epoch instant as 'YYYY-MM-DD' in Asia/Jerusalem. */
function ilDate(epochMs: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(epochMs));
}

/**
 * The last ~7 COMPLETED days in Israel TZ, excluding the current IL day.
 * `to` = yesterday, `from` = today − WINDOW_DAYS.
 */
function completedWindow(now?: string): DateRange {
  const today = getTodayInIsraelTz(now); // 'YYYY-MM-DD'
  const todayMs = Date.UTC(
    Number(today.slice(0, 4)),
    Number(today.slice(5, 7)) - 1,
    Number(today.slice(8, 10)),
  );
  const to = ilDate(todayMs - 1 * 86_400_000); // yesterday
  const from = ilDate(todayMs - WINDOW_DAYS * 86_400_000);
  return { from, to };
}

/**
 * Fetch the four production source datasets for a recent completed window and
 * reconcile them through the pure `reconcileRows()` core. Returns the same
 * `Violation[]` shape as the harness. Throws only if a reader throws (the route
 * wrapper soft-fails that to a 200 with `{ violations: [], error }`).
 */
export async function reconcileLive(now?: string): Promise<Violation[]> {
  const range = completedWindow(now);

  const [dataRows, productRows, campaignRows, ordersRows] = await Promise.all([
    fetchDailyDataFromPostgres({ range }),
    fetchProductsFromPostgres({ range }),
    fetchCampaignsFromPostgres({ range }),
    fetchOrdersAttributionFromPostgres({ range }),
  ]);

  const input: ReconcileRowsInput = {
    // DailyRow already carries date/storeName/fbSpend/gaSpend/ttSpend/
    // totalSpend/revenue/roas — map explicitly so the Reconcile* shape is
    // exact (and a future DailyRow field rename surfaces here, not silently).
    dataRows: dataRows.map(
      (r): ReconcileDataRow => ({
        date: r.date,
        storeName: r.storeName,
        fbSpend: r.fbSpend,
        gaSpend: r.gaSpend,
        ttSpend: r.ttSpend,
        totalSpend: r.totalSpend,
        revenue: r.revenue,
        roas: r.roas,
      }),
    ),
    // ProductRow carries date/storeName/revenue/netRevenue/orders.
    productRows: productRows.map(
      (r): ReconcileProductRow => ({
        date: r.date,
        storeName: r.storeName,
        revenue: r.revenue,
        netRevenue: r.netRevenue,
        orders: r.orders,
      }),
    ),
    // CampaignRow carries date/storeName/platform/spend. `platform` is the
    // display name ('Meta' | 'Google' | 'TikTok' | …) reconcileRows filters on.
    campaignRows: campaignRows.map(
      (r): ReconcileCampaignRow => ({
        date: r.date,
        storeName: r.storeName,
        platform: r.platform,
        spend: r.spend,
      }),
    ),
    // OrderAttributionRow carries date/storeName/totalCad.
    ordersRows: ordersRows.map(
      (r): ReconcileOrderRow => ({
        date: r.date,
        storeName: r.storeName,
        totalCad: r.totalCad,
      }),
    ),
  };

  return reconcileRows(input);
}
