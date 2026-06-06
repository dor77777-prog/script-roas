import type { CompareBaseline } from './presets';
import type { AdStateMap, AdPlatform } from '@/lib/adState';

export type DailyRow = {
  date: string;        // YYYY-MM-DD
  storeId: string;
  storeName: string;
  fbSpend: number;
  gaSpend: number;
  /**
   * Phase 05.7.7 — TikTok ad spend in CAD for the day. 0 for stores
   * without a TikTok integration (currently only uzoshop has one) and
   * for historical rows pre-migration. Always finite, never null.
   */
  ttSpend: number;
  totalSpend: number;
  revenue: number;
  roas: number;
  grossProfit: number;
  cogs: number;        // 0 when scope is missing or no orders
  netProfit: number;   // revenue - spend - cogs
  hasCogs: boolean;    // true if COGS column was populated (non-empty)
  /**
   * Gross revenue BEFORE refund_line_items.subtotal deduction. Equals
   * `revenue + refundDeductionCad`. Surfaced from Phase 05.7.3 so dashboard
   * tables can show "before / after refunds" side-by-side. `null` for
   * historical rows where the column wasn't populated yet.
   */
  grossRevenue: number | null;
  /**
   * Σ refund_line_items[].subtotal for refunds processed on this date.
   * POSITIVE value. `null` for historical rows. When > 0 the dashboard
   * renders a refund-day chip with a tooltip showing the "before refunds"
   * (gross) amount alongside the net.
   */
  refundDeduction: number | null;
  /**
   * Phase 13.8 (2026-05-26) — per-platform impressions for the day,
   * populated by cron-live every ~10 min (light fetcher) and by
   * cron-daily overnight (heavy fetcher). 0 when the platform reported
   * no impressions yet; `null` for historical rows that pre-date this
   * phase (the dashboard treats `null` like "no data" and falls back to
   * "—" rather than computing CPM against a 0 baseline).
   */
  fbImpressions: number | null;
  gaImpressions: number | null;
  ttImpressions: number | null;
  /**
   * DQ-4 (2026-06-04) — daily provenance projection from data_daily's
   * finalization columns (migration 20260530100002). OPTIONAL + nullable so
   * existing consumers don't break: `isFinalized` is true once a daily/weekly
   * reconcile has sealed the row; `source` is the writer that last wrote it
   * ('live_tick' | 'daily_reconcile' | 'weekly_reconcile' | 'backfill' |
   * 'manual_override'); `lastLiveTickAt` is the freshest live-tick ISO ts;
   * `reconciledAt` is when the row was last reconciled. `null` on rows that
   * pre-date the column or where the value is unset. `undefined` when a reader
   * doesn't project these fields at all.
   */
  isFinalized?: boolean | null;
  source?: string | null;
  lastLiveTickAt?: string | null;
  reconciledAt?: string | null;
};

export type DashboardData = {
  rows: DailyRow[];
  stores: string[];    // unique store names
  lastUpdated: string; // ISO timestamp — when the API responded (server fetch time)
  /**
   * Phase 05.7.6 — ISO timestamp of the MOST RECENT data_daily row write
   * across the queried date range. Distinct from `lastUpdated` (server
   * fetch time): this answers "when did a cron last touch this data?"
   * which is what the dashboard's "עודכן לפני X דק׳" chip displays.
   *
   * `null` when no rows match the range (or all rows pre-date the
   * 2026-05-22 migration that added the column).
   */
  dataLastWriteAt: string | null;
  fxIlsToCad: number | null; // current FX rate (ECB via Frankfurter). null on failure.
  /** ads-off Phase 2 — per (store,platform) toggle map (missing key = ON) +
   *  the applicable platforms per store (derived from store meta + the TikTok
   *  shared-account set), so display surfaces can compute "store fully off".
   *  Optional + default-empty so all existing consumers are unaffected (empty
   *  ⇒ everything ON ⇒ today's behavior). */
  adStateMap?: AdStateMap;
  storeApplicablePlatforms?: Record<string, AdPlatform[]>;
  /** Present only on the degraded-error path (rows: []). Consumers should
   *  surface this through the standard error banner. /api/data uses the
   *  200-with-empty-rows pattern uniformly with /api/ads etc. (WR-06) */
  error?: string;
};

export type DateRange = {
  from: string;  // YYYY-MM-DD
  to: string;    // YYYY-MM-DD
};

export type PresetKey =
  | 'today'
  | 'yesterday'
  | 'this_month'
  | 'this_week'
  | 'last_7_days'
  | 'last_month'
  | 'last_30_days'
  | 'custom';

export type Filters = {
  preset: PresetKey;
  range: DateRange;
  store: string;   // 'All' or store name
  /**
   * Period-compare baseline (Phase A). Optional so existing Filters consumers
   * and persisted URL/state shapes keep working; when unset the UI treats it
   * as "no comparison chosen yet". See `resolveCompareRange` for resolution.
   */
  compareBaseline?: CompareBaseline;
};
