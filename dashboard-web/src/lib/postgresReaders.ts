/**
 * postgresReaders.ts — Phase 05.6-17 Postgres-reading half of the dual-source
 * data plane. Mirrors the shape of every existing Sheets reader so route
 * handlers can branch on `readFrom()` (plan 19) without any downstream
 * adaptation. Default stays on Sheets in 05.6 — Phase 05.7 flips the flag.
 *
 * Cardinal invariant (D-E3 in CONTEXT.md):
 *   Every function in this file returns the SAME shape as its Sheets-side
 *   counterpart. Drift = silent regression at cut-over.
 *
 * Coverage in this module (8 reader functions + 1 writer):
 *   1. fetchDailyDataFromPostgres    — sheets.ts:fetchDailyData         (DailyRow[])
 *   2. fetchStoreMetaFromPostgres    — sheets.ts:fetchStoreMeta         (StoreMetaRow[])
 *   3. fetchDashboardStateFromPostgres — sheets.ts:fetchDashboardState  ({kv, updatedAtByKey})
 *   4. fetchProductsFromPostgres     — products.ts:fetchProductsData    (ProductRow[])
 *   5. fetchCampaignsFromPostgres    — campaigns.ts:fetchCampaignsData  (CampaignRow[])
 *   6. fetchAdsFromPostgres          — ads.ts:fetchAdsData              (AdRow[])
 *   7. fetchOrdersAttributionFromPostgres — ordersAttribution.ts:fetchOrdersAttribution (OrderAttributionRow[])
 *   8. fetchProductCatalogFromPostgres — productCatalog.ts:fetchProductCatalog (CatalogProduct[])
 *   9. upsertDashboardStateKeyPostgres — sheets.ts:upsertDashboardStateKey (WRITE, Phase 05.7)
 *
 * Notes:
 *   - All reads use getSupabase() (anon role). Phase 05.5-03 grants SELECT
 *     on every relevant table to anon — see migration 20260521075741.
 *   - DB `platform` column is constrained to lowercase 'meta'|'google'
 *     (migration 20260521075741 CHECK constraint). The sheets.ts CampaignRow
 *     / AdRow shape uses 'Meta'|'Google' (capitalized). Each reader
 *     TitleCases at the boundary so consumers don't have to.
 *   - Phase 05.7: `upsertDashboardStateKeyPostgres` is the dashboard-state
 *     write path that replaces the Sheets writer. Uses `getSupabaseAdmin()`
 *     (service_role) because anon only has SELECT per migration 20260521075741.
 */
import { getSupabase } from '@/lib/supabase';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import type { DailyRow } from './types';
import type { DateRange } from './dateRange';
import { isInRange } from './dateRange';
import { COGS_RATE_OF_REVENUE } from './analytics';
import type { ProductRow } from './products';
import type { CampaignRow } from './campaigns';
import type { AdRow } from './ads';
import type { OrderAttributionRow, OrderLineItem } from './ordersAttribution';
import type { CatalogProduct } from './productCatalog';
import { TIKTOK_ACTIVE_ENOUGH } from './platformConfig';
import { categorizePaymentGateway, type PaymentCategory } from './payments';
import type { OverrideRowAsRead } from '@/lib/home/overridesActive';

/**
 * Generic row type. Without a generated `Database` schema, supabase-js's
 * inferred row type for an untyped `.select(string)` is the union
 * `RowType | GenericStringError`, which TS narrows wrongly inside the
 * iteration loop. We re-cast `data` to `DbRow[]` once after the
 * `if (error) throw ...` guard so the rest of the function can read
 * snake_case columns without a 100-line type-narrowing dance.
 *
 * SAFETY: the cast is post-error-check only — `error` would have thrown
 * already if Supabase returned a string error. The actual runtime shape
 * is "object with snake_case keys", and the manual access we do here
 * (e.g. `r.fb_spend_cad`) is the same set of columns we passed to
 * `.select(...)`, so a typo would surface at TEST time (the row would be
 * `undefined`), not as a TS error.
 */
type DbRow = Record<string, unknown>;

/**
 * Phase 0 (2026-06-02) — canonical orders_attribution SELECT column list.
 * Exported so a presence test can assert every downstream-consumed column
 * is actually requested (a dropped column otherwise reads back undefined).
 */
export const ORDERS_ATTRIBUTION_SELECT =
  'date, store_id, order_id, total_cad, source, utm_source, utm_medium, ' +
  'utm_campaign, utm_content, fbclid_present, gclid_present, referrer, ' +
  'utm_id, utm_term, line_items, customer_id, order_created_at, is_first_order, ' +
  // Phase 4 — first-click lens columns (added by migration 20260603090000).
  'first_touch_source, first_fbclid_present, first_gclid_present, ' +
  'first_ttclid_present, first_utm_source, first_utm_medium, ' +
  'first_utm_campaign, first_utm_content, first_utm_id, ' +
  'first_utm_term, first_seen_at, payment_gateway';

/**
 * Name-preference rule for the Campaigns/Ads readers (2026-06-05).
 *
 * The `campaigns_enriched` / `ads_enriched` VIEWs now expose a registry-backed
 * name alias per entity — `reg_campaign_name` / `reg_ad_set_name` /
 * `reg_ad_name` — each computed server-side as
 * `COALESCE(<registry>.name, <daily>.name)`. The registry holds the CURRENT
 * (latest-seen) name for an entity, whereas the per-day `*_daily` row holds the
 * name as it was on that specific date. Preferring the registry alias keeps the
 * Campaigns/Ads UI showing the up-to-date name even when an old in-range row
 * still carries a stale name.
 *
 * Preference order: registry alias → per-day name → em-dash. The reg argument
 * may be `null`/`undefined` (LEFT JOIN miss, or pre-Phase-D rows). We use `??`
 * (not `||`) so the SQL COALESCE semantics carry through: a registry name is
 * "present" unless it is NULL/undefined; only then do we fall back to the
 * daily name, then to the em-dash placeholder shared by both readers.
 */
export function preferName(
  reg: string | null | undefined,
  daily: string | null | undefined,
): string {
  // A blank-after-trim registry name (a genuine '' the platform returned, or
  // whitespace) is treated as ABSENT so we fall through to the per-day name
  // rather than rendering the em-dash. Mirrors the views' NULLIF(name,'')
  // inside COALESCE — defense-in-depth on both sides.
  const r = (reg ?? '').trim();
  const d = (daily ?? '').trim();
  return r || d || '—';
}

/**
 * Pagination helper — works around Supabase Cloud's `db-max-rows = 1000`
 * PostgREST cap. `.range(0, 49999)` alone returns only 1000 rows because
 * PostgREST clamps to the project setting, not the client request.
 *
 * Loops chunked .range() requests until the supabase-js result is smaller
 * than the requested chunk (signal that we've reached the end of the
 * dataset). Each call rebuilds the query via `buildQuery()` because
 * supabase-js queries are not safely reusable across awaits.
 *
 * Type hint: `buildQuery` should return the chain right before .range()
 * (i.e. .from().select().gte().lte() etc.). The helper only adds .range().
 *
 * Note: `any` is unavoidable for the chain return type — supabase-js's
 * query builder is heavily generic and constructing a precise type for
 * the partial chain (with .range still available) needs Database<T> codegen
 * we don't have. The cast is contained to this helper; callers pass a
 * lambda that returns a typed builder.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Internal type — what supabase-js's PostgrestFilterBuilder returns when awaited.
 * We don't depend on a generated Database<T> type, so the data is `unknown[]`
 * (re-cast to DbRow[] in each reader after the error guard, same pattern as
 * the un-paginated readers used to do).
 */
type PaginatedQuery = {
  range: (from: number, to: number) => PromiseLike<{
    data: unknown[] | null;
    error: { message: string } | null;
  }>;
};

async function paginate<T>(
  buildQuery: () => any,
  chunkSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  let start = 0;
  // Hard ceiling — 50 chunks × 1k = 50k rows. Prevents runaway loops if a
  // server bug returns the same page forever.
  const MAX_CHUNKS = 50;
  for (let chunk = 0; chunk < MAX_CHUNKS; chunk++) {
    const q = buildQuery() as PaginatedQuery;
    const { data, error } = await q.range(start, start + chunkSize - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < chunkSize) break;
    start += chunkSize;
  }
  return all;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Coerces an unknown DB cell to a finite number. NUMERIC columns come back
 * from supabase-js as either `number` or `string` (depending on size /
 * configuration); BIGINT comes back as `number` for small values and as
 * `string` for values exceeding Number.MAX_SAFE_INTEGER. The Sheets-side
 * `parseNumber` does the same job for spreadsheet cells — we keep the
 * conversion semantics aligned to maintain shape parity.
 */
function toNumber(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

/**
 * DB stores platform values as lowercase 'meta' / 'google' (CHECK constraint
 * in migration 20260521075741). The Sheets-side CampaignRow / AdRow shape
 * uses 'Meta' / 'Google'. TitleCase at the boundary so consumer code keeps
 * its existing pattern matches without case-conversion glue.
 */
function titleCasePlatform(v: unknown): 'Meta' | 'Google' | 'TikTok' | string {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (s.toLowerCase() === 'meta') return 'Meta';
  if (s.toLowerCase() === 'google') return 'Google';
  if (s.toLowerCase() === 'tiktok') return 'TikTok';
  return s; // Pass through unknown values — matches sheets.ts permissive behavior.
}

/**
 * Mirrors ordersAttribution.ts:parseLineItems (line 137). The Sheets writer
 * stores line items as a JSON STRING in column N; the Postgres writer (plan
 * 08) will store the same payload as JSONB. The two storage formats end up
 * as the same JS array after Supabase's automatic JSON decoding, so we just
 * need to validate the inner shape and convert {p,u,r} → {productId,units,revenueCad}.
 *
 * Tolerance matches the Sheets-side reader: malformed entries are dropped
 * (filter), not erroring the whole row. Empty / null input returns [].
 */
function parseLineItems(v: unknown): OrderLineItem[] {
  if (v === null || v === undefined || v === '') return [];
  const parsed = typeof v === 'string'
    ? (() => { try { return JSON.parse(v); } catch { return null; } })()
    : v;
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(
      (it): it is { p: string; u: unknown; r: unknown } =>
        it !== null && typeof it === 'object' &&
        typeof (it as { p?: unknown }).p === 'string' &&
        (it as { p: string }).p.trim().length > 0,
    )
    .map(it => ({
      productId: String(it.p).trim(),
      units: Number(it.u ?? 0),
      revenueCad: Number(it.r ?? 0),
    }))
    .filter(li => Number.isFinite(li.units) && Number.isFinite(li.revenueCad));
}

// ────────────────────────────────────────────────────────────────────────
// 1. fetchDailyDataFromPostgres — data_daily → DailyRow[]
//    Mirrors sheets.ts:fetchDailyData (line 115)
// ────────────────────────────────────────────────────────────────────────

/**
 * Postgres equivalent of sheets.ts:fetchDailyData. Returns the SAME
 * DailyRow[] shape so route handlers can branch on readFrom() without
 * affecting downstream consumers.
 *
 * The sheets.ts version supports archive fallback for ranges older than 18
 * months. Phase 05.6 history is 2026-05-01+ (D-A3), so there's no archive to
 * fall back to yet — the Postgres reader doesn't need that branch. If the
 * Postgres history later spans >18 months, this is the right place to add a
 * cold-storage join (or a partitioned table).
 *
 * Derived-field semantics match sheets.ts exactly:
 *   - totalSpend = stored value, else fb + ga
 *   - roas       = revenue / totalSpend (0 when totalSpend = 0)
 *   - grossProfit = stored value, else revenue - totalSpend
 *   - cogs        = stored value, else revenue * COGS_RATE_OF_REVENUE (0.25)
 *   - netProfit   = stored value, else revenue - totalSpend - (computed cogs)
 *
 * In-range filtering: pushed down to Postgres via .gte/.lte (server-side
 * efficiency). A defensive isInRange() check on the client side is kept
 * as a belt-and-suspenders measure for the edge case where Postgres date
 * comparison semantics diverge (e.g. tz-shift on the DB side).
 */
/**
 * Phase 05.7.6 — Returns the most recent `updated_at` across rows in the
 * given table+range (or null if no rows exist). Used by /api/* endpoints
 * to surface `dataLastWriteAt` for the dashboard's per-tab freshness chip.
 *
 * Implementation: single .order('updated_at', desc).limit(1) call —
 * MUCH cheaper than scanning all rows. Each table has an `updated_at`
 * column with a trigger that sets NOW() on every INSERT/UPDATE.
 */
async function fetchTableLastWriteAt(
  table: 'data_daily' | 'campaigns_daily' | 'products_daily' | 'ads_daily',
  opts?: { range?: DateRange },
): Promise<string | null> {
  try {
    let q = getSupabase()
      .from(table)
      .select('updated_at')
      .order('updated_at', { ascending: false })
      .limit(1);
    if (opts?.range) {
      q = q.gte('date', opts.range.from).lte('date', opts.range.to);
    }
    const { data, error } = await q;
    if (error) throw error;
    const row = (data ?? [])[0];
    if (!row) return null;
    const ts = (row as { updated_at?: string | null }).updated_at;
    return ts ?? null;
  } catch {
    // Don't fail the whole API response over a freshness lookup —
    // the dashboard degrades to "no chip" when this returns null.
    return null;
  }
}

export async function fetchDataDailyLastWriteAt(
  opts?: { range?: DateRange },
): Promise<string | null> {
  return fetchTableLastWriteAt('data_daily', opts);
}

export async function fetchCampaignsDailyLastWriteAt(
  opts?: { range?: DateRange },
): Promise<string | null> {
  return fetchTableLastWriteAt('campaigns_daily', opts);
}

export async function fetchProductsDailyLastWriteAt(
  opts?: { range?: DateRange },
): Promise<string | null> {
  return fetchTableLastWriteAt('products_daily', opts);
}

export async function fetchAdsDailyLastWriteAt(
  opts?: { range?: DateRange },
): Promise<string | null> {
  return fetchTableLastWriteAt('ads_daily', opts);
}

export async function fetchDailyDataFromPostgres(
  opts?: { range?: DateRange },
): Promise<DailyRow[]> {
  // Paginate to bypass Supabase Cloud's db-max-rows=1000 cap (see `paginate()`).
  let data: DbRow[];
  try {
    data = await paginate<DbRow>(() => {
      let q = getSupabase()
        .from('data_daily')
        .select(
          'date, store_id, store_name, fb_spend_cad, ga_spend_cad, tt_spend_cad, total_spend_cad, ' +
            'revenue_cad, roas, gross_profit_cad, cogs_cad, net_profit_cad, ' +
            'gross_revenue_cad, refund_deduction_cad, ' +
            // Phase 13.8 (2026-05-26) — per-platform impressions for live CPM.
            'fb_impressions, ga_impressions, tt_impressions, ' +
            // DQ-4 (2026-06-04) — daily provenance projection. Finalization
            // columns added by migration 20260530100002; additive optional
            // fields on DailyRow → no consumer breaks.
            'is_finalized, source, last_live_tick_at, reconciled_at',
        );
      if (opts?.range) {
        q = q.gte('date', opts.range.from).lte('date', opts.range.to);
      }
      return q;
    });
  } catch (e) {
    throw new Error(`postgresReaders.fetchDailyData: ${(e as Error).message}`);
  }

  const rows: DailyRow[] = [];
  for (const r of data) {
    const dateStr = String(r.date);
    if (opts?.range && !isInRange(dateStr, opts.range)) continue;

    const fbSpend = toNumber(r.fb_spend_cad);
    const gaSpend = toNumber(r.ga_spend_cad);
    const ttSpend = toNumber(r.tt_spend_cad);
    const totalSpendRaw = r.total_spend_cad;
    const totalSpend =
      totalSpendRaw === null || totalSpendRaw === undefined
        ? fbSpend + gaSpend + ttSpend
        : toNumber(totalSpendRaw) || fbSpend + gaSpend + ttSpend;
    const revenue = toNumber(r.revenue_cad);
    const roasRaw = r.roas;
    const roas =
      roasRaw === null || roasRaw === undefined
        ? totalSpend > 0 ? revenue / totalSpend : 0
        : toNumber(roasRaw);
    const grossProfit =
      r.gross_profit_cad === null || r.gross_profit_cad === undefined
        ? revenue - totalSpend
        : toNumber(r.gross_profit_cad);
    const cogs =
      r.cogs_cad === null || r.cogs_cad === undefined
        ? revenue * COGS_RATE_OF_REVENUE
        : toNumber(r.cogs_cad);
    const netProfit =
      r.net_profit_cad === null || r.net_profit_cad === undefined
        ? revenue - totalSpend - cogs
        : toNumber(r.net_profit_cad);

    // Surface gross + refund_deduction as nullable (Phase 05.7.3).
    // Historical rows pre-migration have NULL — UI degrades gracefully.
    const grossRaw = r.gross_revenue_cad;
    const refundRaw = r.refund_deduction_cad;
    const grossRevenue =
      grossRaw === null || grossRaw === undefined ? null : toNumber(grossRaw);
    const refundDeduction =
      refundRaw === null || refundRaw === undefined ? null : toNumber(refundRaw);

    // Phase 13.8 (2026-05-26) — per-platform impressions; null on rows that
    // pre-date the column (before the migration ran), 0 on rows where the
    // platform reported no impressions yet. The dashboard treats null as
    // "no data" (renders "—") and 0 as a real measurement.
    const fbImpRaw = r.fb_impressions;
    const gaImpRaw = r.ga_impressions;
    const ttImpRaw = r.tt_impressions;
    const fbImpressions =
      fbImpRaw === null || fbImpRaw === undefined ? null : Number(fbImpRaw) || 0;
    const gaImpressions =
      gaImpRaw === null || gaImpRaw === undefined ? null : Number(gaImpRaw) || 0;
    const ttImpressions =
      ttImpRaw === null || ttImpRaw === undefined ? null : Number(ttImpRaw) || 0;

    rows.push({
      date: dateStr,
      storeId: String(r.store_id),
      storeName: String(r.store_name),
      fbSpend,
      gaSpend,
      ttSpend,
      totalSpend,
      revenue,
      roas,
      grossProfit,
      cogs,
      netProfit,
      hasCogs: true,
      grossRevenue,
      refundDeduction,
      fbImpressions,
      gaImpressions,
      ttImpressions,
      // DQ-4 (2026-06-04) — daily provenance. PostgREST returns timestamptz as
      // an ISO string already; we only normalise null/undefined → null and
      // coerce the boolean. `is_finalized` is NOT NULL DEFAULT false in the
      // schema, but historical rows read before the migration could be null —
      // preserve that as null rather than coercing to false.
      isFinalized: r.is_finalized == null ? null : Boolean(r.is_finalized),
      source: r.source == null ? null : String(r.source),
      lastLiveTickAt: r.last_live_tick_at == null ? null : String(r.last_live_tick_at),
      reconciledAt: r.reconciled_at == null ? null : String(r.reconciled_at),
    });
  }
  return rows;
}

// ────────────────────────────────────────────────────────────────────────
// 2. fetchStoreMetaFromPostgres — stores → StoreMetaRow[]
// ────────────────────────────────────────────────────────────────────────

/**
 * Shape of a single row in the `stores` table after normalization.
 *
 * Relocated from `lib/sheets.ts` in Phase 11 (Apps Script decommission). The
 * type originally lived alongside the now-deleted `fetchStoreMeta` Sheets
 * reader; `postgresReaders.ts` is the sole remaining consumer.
 */
export type StoreMetaRow = {
  storeId: string;
  storeName: string;
  planDisplayName: string;
  shopifyPlus: boolean;
  partnerDevelopment: boolean;
  updatedAt: string | null;
  /** When the GraphQL plan-detection call failed (missing scope, expired
   *  token, GraphQL errors), the writer persists the error message so the
   *  dashboard can show the real reason auto-detect isn't working. Empty
   *  string / null means the last refresh succeeded. */
  lastError: string | null;
  /** Meta ad account ID (numeric, no act_ prefix). Used by CampaignsTable +
   *  CampaignDrawer to build correct deep links to Ads Manager. null if the
   *  store has no Meta account configured. */
  metaAdAccountId: string | null;
  /** Google Ads customer ID (numeric, no dashes). Same role as the Meta one
   *  for the Google Ads deep link. null when not configured. */
  googleAdsCustomerId: string | null;
  /** Phase A.5 — TikTok advertiser ID (numeric). Sourced from the env var
   *  `${storeId.toUpperCase()}_TIKTOK_ADVERTISER_ID` by the /api/store-meta
   *  route (the value isn't persisted in the `stores` table). null when the
   *  store has no TikTok account configured. */
  tiktokAdvertiserId: string | null;
};

/**
 * Returns one normalized row per store from the `stores` table.
 *
 * Field mapping (DB column → StoreMetaRow):
 *   id                       → storeId
 *   name                     → storeName
 *   plan_display_name        → planDisplayName
 *   shopify_plus             → shopifyPlus
 *   partner_dev              → partnerDevelopment
 *   updated_at (TIMESTAMPTZ) → updatedAt (ISO string or null)
 *   last_error               → lastError (null when '' / null in DB)
 *   meta_ad_account_id       → metaAdAccountId (strip 'act_' prefix; null if blank)
 *   google_ads_customer_id   → googleAdsCustomerId (strip dashes; null if blank)
 *
 * The 'act_' prefix strip and dash strip are the canonical shape; consumers
 * (CampaignsTable, CampaignDrawer) build deep links from these normalized IDs.
 */
export async function fetchStoreMetaFromPostgres(): Promise<StoreMetaRow[]> {
  const { data, error } = await getSupabase()
    .from('stores')
    .select(
      'id, name, plan_display_name, shopify_plus, partner_dev, updated_at, ' +
        'last_error, meta_ad_account_id, google_ads_customer_id',
    );

  if (error) throw new Error(`postgresReaders.fetchStoreMeta: ${error.message}`);

  const rows: StoreMetaRow[] = [];
  for (const r of (data as unknown as DbRow[] | null) ?? []) {
    const metaRaw = String(r.meta_ad_account_id ?? '').trim();
    const googleRaw = String(r.google_ads_customer_id ?? '').trim();
    const lastErrorRaw = r.last_error;

    rows.push({
      storeId: String(r.id),
      storeName: String(r.name ?? '').trim(),
      planDisplayName: r.plan_display_name == null ? '' : String(r.plan_display_name).trim(),
      shopifyPlus: r.shopify_plus === true,
      partnerDevelopment: r.partner_dev === true,
      updatedAt: r.updated_at ? String(r.updated_at) : null,
      lastError:
        lastErrorRaw === null || lastErrorRaw === undefined || lastErrorRaw === ''
          ? null
          : String(lastErrorRaw),
      metaAdAccountId: metaRaw ? metaRaw.replace(/^act_/, '') : null,
      googleAdsCustomerId: googleRaw ? googleRaw.replace(/-/g, '') : null,
      // Phase A.5 — populated server-side by /api/store-meta/route.ts from
      // env var `${STORE.toUpperCase()}_TIKTOK_ADVERTISER_ID`. The reader
      // stays pure (DB only); the route enriches before serving so the
      // dashboard can build the campaign-store-map key.
      tiktokAdvertiserId: null,
    });
  }
  return rows;
}

// ────────────────────────────────────────────────────────────────────────
// 3. fetchDashboardStateFromPostgres — dashboard_state → {kv, updatedAtByKey}
//    Mirrors sheets.ts:fetchDashboardState (line 338)
// ────────────────────────────────────────────────────────────────────────

/**
 * Postgres equivalent of sheets.ts:fetchDashboardState. Returns the SAME
 * shape: `{ kv, updatedAtByKey }`.
 *
 * dashboard_state stores values as JSONB, so Supabase auto-decodes them to
 * the native JS shape. Compared to sheets.ts where each cell is a JSON
 * STRING that has to be JSON.parsed, this reader skips the inner parse
 * step but produces the same {kv, updatedAtByKey} shape.
 *
 * Prototype-pollution hardening (matches sheets.ts:357 Object.create(null)):
 *   We use Object.create(null) for both kv and updatedAtByKey so a row with
 *   key="__proto__" or "constructor" written directly by a service-role
 *   actor (or a malformed manual edit) can only set own properties on the
 *   returned object — never on Object.prototype.
 */
export async function fetchDashboardStateFromPostgres(): Promise<{
  kv: Record<string, unknown>;
  updatedAtByKey: Record<string, string>;
}> {
  const { data, error } = await getSupabase()
    .from('dashboard_state')
    .select('key, value, updated_at');

  if (error) throw new Error(`postgresReaders.fetchDashboardState: ${error.message}`);

  const kv: Record<string, unknown> = Object.create(null);
  const updatedAtByKey: Record<string, string> = Object.create(null);

  for (const r of (data as unknown as DbRow[] | null) ?? []) {
    const key = String(r.key ?? '').trim();
    if (!key) continue;
    const updatedAt = r.updated_at ? String(r.updated_at) : '';
    // Match sheets.ts dedup: keep the row with the newest updatedAt.
    // Postgres's PRIMARY KEY (key) prevents duplicates in the first place,
    // but the comparison is cheap and forward-compatible if the schema ever
    // changes to allow per-key history rows.
    const prevAt = updatedAtByKey[key];
    if (prevAt !== undefined && updatedAt < prevAt) continue;
    kv[key] = r.value;
    updatedAtByKey[key] = updatedAt;
  }

  return { kv, updatedAtByKey };
}

// ────────────────────────────────────────────────────────────────────────
// 4. fetchProductsFromPostgres — products_daily → ProductRow[]
//    Mirrors products.ts:fetchProductsData (line 69)
// ────────────────────────────────────────────────────────────────────────

/**
 * Postgres equivalent of products.ts:fetchProductsData. Returns the SAME
 * ProductRow[] shape.
 *
 * Empty-row filter mirrors products.ts:110 — drop rows where both units and
 * revenue are zero, otherwise the dashboard shows phantom inventory.
 */
export async function fetchProductsFromPostgres(
  opts?: { range?: DateRange },
): Promise<ProductRow[]> {
  let data: DbRow[];
  try {
    data = await paginate<DbRow>(() => {
      let q = getSupabase()
        .from('products_daily')
        .select(
          'date, store_id, store_name, product_id, product_title, units, ' +
            'gross_revenue_cad, orders, net_revenue_cad',
        );
      if (opts?.range) {
        q = q.gte('date', opts.range.from).lte('date', opts.range.to);
      }
      return q;
    });
  } catch (e) {
    throw new Error(`postgresReaders.fetchProducts: ${(e as Error).message}`);
  }

  const rows: ProductRow[] = [];
  for (const r of data) {
    const dateStr = String(r.date);
    if (opts?.range && !isInRange(dateStr, opts.range)) continue;

    const units = toNumber(r.units);
    const revenue = toNumber(r.gross_revenue_cad);
    const netRev = toNumber(r.net_revenue_cad);
    // Drop rows that are zero on EVERY revenue surface. Phase 05.6 fetchers
    // populate net_revenue_cad (the refund-corrected number) but leave
    // units + gross_revenue_cad at 0/null — so the original units+revenue-only
    // filter would discard real product rows. Keep any row where ANY of the
    // three has meaningful data.
    if (units <= 0 && revenue <= 0 && netRev <= 0) continue;

    const netRaw = r.net_revenue_cad;
    rows.push({
      date: dateStr,
      storeId: String(r.store_id),
      storeName: String(r.store_name),
      productId: String(r.product_id),
      productTitle: String(r.product_title ?? '').trim() || '—',
      units,
      revenue,
      orders: toNumber(r.orders),
      netRevenue:
        netRaw === null || netRaw === undefined || netRaw === '' ? null : toNumber(netRaw),
    });
  }
  return rows;
}

// ────────────────────────────────────────────────────────────────────────
// 5. fetchCampaignsFromPostgres — campaigns_daily → CampaignRow[]
//    Mirrors campaigns.ts:fetchCampaignsData (line 78)
// ────────────────────────────────────────────────────────────────────────

/**
 * Postgres equivalent of campaigns.ts:fetchCampaignsData. Returns the SAME
 * CampaignRow[] shape.
 *
 * Two normalizations on the boundary:
 *   - platform: DB lowercase → Sheets-shape Title Case
 *   - storeName: campaigns_daily has only store_id; we hardcode the same
 *     STORE_TAB_CONFIG map used by campaigns.ts so the storeName field
 *     stays populated.
 *
 * Empty-row filter mirrors campaigns.ts:140 — drop rows with zero spend,
 * impressions, AND conversions.
 */
const STORE_NAME_BY_ID: Record<string, string> = {
  uzoshop: 'uzoshop',
  zolplus: 'Zol Plus',
  usmile360: '360usmile',
};

export async function fetchCampaignsFromPostgres(
  opts?: { range?: DateRange },
): Promise<CampaignRow[]> {
  // NOTE: campaigns_daily schema does NOT include a store_name column (only
  // data_daily + products_daily do). Querying it caused a Postgres error
  // surfaced as a soft-fail with 0 rows. We project store_name on the
  // boundary via STORE_NAME_BY_ID below.
  let data: DbRow[];
  try {
    data = await paginate<DbRow>(() => {
      let q = getSupabase()
        .from('campaigns_enriched')
        .select(
          'date, store_id, platform, campaign_id, campaign_name, ' +
            'ad_set_id, ad_set_name, ' +
            // 2026-06-05 — registry-backed name aliases
            // (COALESCE(registry.name, daily.name)) added to campaigns_enriched.
            // The reader PREFERS these (via preferName) so the Campaigns UI
            // shows the entity's current name, not a stale per-day name.
            'reg_campaign_name, reg_ad_set_name, ' +
            'spend_cad, impressions, clicks, conversions, ' +
            'conversion_value_cad, campaign_budget_cad, ad_set_budget_cad, ' +
            // Phase 05.7.x — effective_status column added in migration
            // 20260522180000. NULL for rows written before the migration; the
            // dashboard's CampaignsTableRow falls back to its 2-day
            // lastActiveDate heuristic when this is null.
            'budget_type, effective_status, ' +
            // Phase A (2026-05-29) — `last_live_tick_at` column added in
            // migration 20260530100002. Populated by cron-live + Phase C
            // hot-metrics workers; NULL on cron-daily writes. Surfaced into
            // the row's CampaignFreshnessChip for an at-a-glance freshness
            // indicator next to the campaign name.
            'last_live_tick_at, ' +
            // Phase D (2026-05-30) — registry-backed status columns, joined
            // server-side via the campaigns_enriched VIEW. The 12-column
            // bundle from campaign_registry — we project only the 6 the UI
            // consumes; the other 6 are reachable via SELECT * on the view
            // if a future caller needs them.
            'reg_configured_status, reg_effective_status, reg_delivery_status, ' +
            'reg_first_seen_at, reg_status_changed_at, reg_last_status_success_at',
        );
      if (opts?.range) {
        q = q.gte('date', opts.range.from).lte('date', opts.range.to);
      }
      return q;
    });
  } catch (e) {
    throw new Error(`postgresReaders.fetchCampaigns: ${(e as Error).message}`);
  }

  const rows: CampaignRow[] = [];
  for (const r of data) {
    const dateStr = String(r.date);
    if (opts?.range && !isInRange(dateStr, opts.range)) continue;

    const spend = toNumber(r.spend_cad);
    const impressions = toNumber(r.impressions);
    const conversions = toNumber(r.conversions);
    // Phase 05.7.x (2026-05-23) — operator spec:
    //   Show campaign if EITHER (a) it had activity in the range, OR
    //   (b) it is CURRENTLY active on its platform (so brand-new
    //   active campaigns appear within 10 min, before they spend).
    //   Paused / archived campaigns with no activity in the range are
    //   dropped — they'd be visual noise (operator would ask "why is
    //   this paused campaign showing up?").
    //
    // (a) hasActivity → real metric data, regardless of status.
    // (b) isCurrentlyActive → cron-live placeholder rows for ad-sets
    //     in the platform's "on" state.
    //       Meta:   'ACTIVE'
    //       Google: 'ENABLED'
    //       TikTok: any value in TIKTOK_ACTIVE_ENOUGH (DELIVERY_OK,
    //               BUDGET_EXCEED, AUDIT, REVIEWING, NOT_START).
    //
    // Audit fix 2026-05-24 (U-01): the TikTok branch previously checked
    // only `ADGROUP_STATUS_DELIVERY_OK` — out of step with the writer
    // (`cronLive.ts:isActiveForPlatform`) which already used the full
    // 5-status active set. Effect: an ad-group in BUDGET_EXCEED with
    // hasActivity=false was UPSERTed as a placeholder by cron-live but
    // silently dropped by this reader, so the operator saw the row vanish
    // from the dashboard mid-day even though TikTok Ads Manager still
    // painted it as Active. Both helpers now import the shared
    // `TIKTOK_ACTIVE_ENOUGH` set from `@/lib/platformConfig`.
    const hasActivity = spend > 0 || impressions > 0 || conversions > 0;
    const effectiveStatusRaw = (r as { effective_status?: unknown }).effective_status;
    const statusNorm =
      effectiveStatusRaw === null || effectiveStatusRaw === undefined
        ? ''
        : String(effectiveStatusRaw).trim().toUpperCase();
    const platformNorm = String(r.platform || '').toLowerCase();
    const isCurrentlyActive =
      (platformNorm === 'meta' && statusNorm === 'ACTIVE') ||
      (platformNorm === 'google' && statusNorm === 'ENABLED') ||
      (platformNorm === 'tiktok' && TIKTOK_ACTIVE_ENOUGH.has(statusNorm));
    if (!hasActivity && !isCurrentlyActive) {
      continue;
    }

    const storeId = String(r.store_id);
    const cbRaw = r.campaign_budget_cad;
    const abRaw = r.ad_set_budget_cad;
    const btRaw = String(r.budget_type ?? '').trim().toUpperCase();

    rows.push({
      date: dateStr,
      storeId,
      // campaigns_daily has no store_name column — derive from store_id via
      // the canonical map (mirrors campaigns.ts:38 sheets-side behavior).
      storeName: STORE_NAME_BY_ID[storeId] ?? storeId,
      platform: titleCasePlatform(r.platform),
      campaignId: String(r.campaign_id),
      campaignName: preferName(
        (r as { reg_campaign_name?: string | null }).reg_campaign_name,
        r.campaign_name as string | null | undefined,
      ),
      adSetId: String(r.ad_set_id),
      adSetName: preferName(
        (r as { reg_ad_set_name?: string | null }).reg_ad_set_name,
        r.ad_set_name as string | null | undefined,
      ),
      spend,
      impressions,
      clicks: toNumber(r.clicks),
      conversions,
      conversionValue: toNumber(r.conversion_value_cad),
      campaignBudgetCad:
        cbRaw === null || cbRaw === undefined || cbRaw === '' ? null : toNumber(cbRaw),
      adSetBudgetCad:
        abRaw === null || abRaw === undefined || abRaw === '' ? null : toNumber(abRaw),
      budgetType: btRaw === 'CBO' || btRaw === 'ABO' ? btRaw : '',
      // Phase 05.7.x — pass effective_status through with no
      // normalisation; the dashboard groups statuses platform-by-platform
      // (Meta PAUSED ≠ Google PAUSED ≠ TikTok ADGROUP_STATUS_DISABLE),
      // so converting to a common enum here would lose information.
      effectiveStatus: (() => {
        const v = (r as { effective_status?: unknown }).effective_status;
        if (v === null || v === undefined) return null;
        const s = String(v).trim();
        return s || null;
      })(),
      // Phase A (2026-05-29) — ISO timestamp of the freshest live-tick
      // that wrote this row. PostgREST returns timestamptz as an ISO
      // string already; we just normalise null/empty to null so the
      // aggregator can max() across rows without ambiguity.
      lastLiveTickAt: (() => {
        const v = (r as { last_live_tick_at?: unknown }).last_live_tick_at;
        if (v === null || v === undefined) return null;
        const s = String(v).trim();
        return s || null;
      })(),
      regConfiguredStatus: ((): string | null => {
        const v = (r as { reg_configured_status?: unknown }).reg_configured_status;
        if (v === null || v === undefined) return null;
        const s = String(v).trim();
        return s || null;
      })(),
      regEffectiveStatus: ((): string | null => {
        const v = (r as { reg_effective_status?: unknown }).reg_effective_status;
        if (v === null || v === undefined) return null;
        const s = String(v).trim();
        return s || null;
      })(),
      regDeliveryStatus: ((): string | null => {
        const v = (r as { reg_delivery_status?: unknown }).reg_delivery_status;
        if (v === null || v === undefined) return null;
        const s = String(v).trim();
        return s || null;
      })(),
      regFirstSeenAt: ((): string | null => {
        const v = (r as { reg_first_seen_at?: unknown }).reg_first_seen_at;
        if (v === null || v === undefined) return null;
        const s = String(v).trim();
        return s || null;
      })(),
      regStatusChangedAt: ((): string | null => {
        const v = (r as { reg_status_changed_at?: unknown }).reg_status_changed_at;
        if (v === null || v === undefined) return null;
        const s = String(v).trim();
        return s || null;
      })(),
      regLastStatusSuccessAt: ((): string | null => {
        const v = (r as { reg_last_status_success_at?: unknown }).reg_last_status_success_at;
        if (v === null || v === undefined) return null;
        const s = String(v).trim();
        return s || null;
      })(),
    });
  }
  return rows;
}

// ────────────────────────────────────────────────────────────────────────
// 5b. fetchCurrentCampaignStatuses — absolute-latest effective_status per
//     (store, platform, campaign, ad_set), regardless of any operator-
//     selected range.
//
//     Phase D (2026-05-30) — refactored to read campaign_registry directly
//     + broadcast via campaigns_daily lookup. Previously this was a 60-day
//     SELECT over campaigns_daily ordered by updated_at DESC. Post-Phase-B,
//     campaign_registry IS the authoritative source: every (store, platform,
//     campaign_id) has exactly one row whose effective_status is refreshed
//     by the status-scope worker every ~10 min. The 60-day scan is now
//     redundant — registry has fresher data and skips the per-row dedup.
//
//     Phase 12.5.x history preserved for reference: the dashboard's "כבוי"
//     chip used to derive off-state from the chronologically-latest row
//     INSIDE the operator's selected range. That worked iff cron-live's
//     UPDATE pass had refreshed in-range historical rows. When that refresh
//     lagged (or soft-failed for TikTok), the chip stayed silent on a paused
//     campaign. This helper decoupled the chip from the in-range data —
//     keeping that decoupling, just switching the source to registry.
// ────────────────────────────────────────────────────────────────────────

/**
 * Phase D (2026-05-30) — refactored to read campaign_registry directly
 * + broadcast via campaigns_daily lookup.
 *
 * Map value shape: `{ status, updatedAt }`. The `status` is the registry's
 * `effective_status`; the `updatedAt` is the registry's `last_seen_at`
 * (when the status-scope worker last refreshed this campaign).
 *
 * Map key shape: `storeId::Platform::campaignId::adSetId`. Platform is
 * TitleCase to match `CampaignRow.platform` so the aggregator can look up
 * by the same key it already builds. Registry stores per-campaign — to
 * preserve the key shape, we broadcast each campaign's status to every
 * (campaign, ad_set) tuple that exists in campaigns_daily.
 *
 * Soft-fail: a query error returns an empty map. The aggregator's existing
 * in-range logic still produces a status — this helper is an enhancement,
 * not a hard dependency.
 *
 * Known scale note: Query 2 (`campaigns_daily` → distinct `(store, platform,
 * campaign_id, ad_set_id)` tuples) is unbounded by date. At current prod
 * scale (~15k rows) it's well under the `paginate()` ceiling (50k rows). If
 * `campaigns_daily` grows past ~50k, the helper will silently truncate;
 * the proper fix is to switch Query 2 to read directly from `adset_registry`
 * (one row per ad_set, Phase D backfilled) and drop the broadcast loop.
 */
export type CurrentEffectiveStatusEntry = {
  status: string;
  updatedAt: string; // ISO timestamp
};

/**
 * Bug fix (2026-06-04) — last-known CBO/ABO budget type per campaign /
 * ad-set. Returned by `fetchLastKnownBudgetTypes` and consumed by the
 * aggregator to backfill an all-empty in-range `budget_type` window. Defined
 * here (the reader boundary) parallel to `CurrentEffectiveStatusEntry`; the
 * aggregator declares a structurally-identical type of its own, matching the
 * existing `CurrentEffectiveStatusEntry`/`CurrentStatusEntry` split.
 */
export type LastKnownBudgetTypeEntry = {
  budgetType: 'CBO' | 'ABO';
  lastSeenAt: string; // YYYY-MM-DD — date of the latest non-empty budget_type
};

export async function fetchCurrentCampaignStatuses(): Promise<
  Record<string, CurrentEffectiveStatusEntry>
> {
  const out: Record<string, CurrentEffectiveStatusEntry> = {};

  // 1. Read absolute-latest status for every campaign from the registry.
  //    Phase D (2026-05-30) — previously this was a 60-day SELECT over
  //    campaigns_daily ordered by updated_at DESC. Registry IS the
  //    authoritative source post-Phase-B: every (store, platform,
  //    campaign_id) has exactly one row whose effective_status was
  //    last refreshed by the status-scope worker (≤10 min lag).
  let registry: DbRow[];
  try {
    registry = await paginate<DbRow>(() => {
      return getSupabase()
        .from('campaign_registry')
        .select('store_id, platform, campaign_id, effective_status, last_seen_at')
        .not('effective_status', 'is', null);
    });
  } catch (e) {
    console.warn(`postgresReaders.fetchCurrentCampaignStatuses (registry): ${(e as Error).message}`);
    return out;
  }

  // 2. Build a campaign-level map of status → updatedAt.
  type CampaignStatus = { status: string; updatedAt: string };
  const byCampaign = new Map<string, CampaignStatus>();
  for (const r of registry) {
    const storeId    = String(r.store_id ?? '');
    const platform   = titleCasePlatform(r.platform);
    const campaignId = String(r.campaign_id ?? '');
    if (!storeId || !campaignId) continue;
    const status = String(r.effective_status ?? '').trim();
    if (!status) continue;
    const updatedAt = r.last_seen_at ? String(r.last_seen_at) : '';
    if (!updatedAt) continue;
    byCampaign.set(`${storeId}::${platform}::${campaignId}`, { status, updatedAt });
  }

  // 3. For every (store, platform, campaign) we have a status for, look up
  //    all of its ad_set_ids from campaigns_daily and broadcast the campaign
  //    status to each. Keeps the existing key shape so callers don't change.
  //    NB: campaigns_daily (not adsets_daily — that table doesn't exist) is
  //    the source of (campaign_id, ad_set_id) tuples; its PK includes
  //    ad_set_id, making it ad-set-granular.
  let adsets: DbRow[];
  try {
    adsets = await paginate<DbRow>(() => {
      return getSupabase()
        .from('campaigns_daily')
        .select('store_id, platform, campaign_id, ad_set_id');
    });
  } catch (e) {
    console.warn(`postgresReaders.fetchCurrentCampaignStatuses (adsets): ${(e as Error).message}`);
    return out;
  }
  const seen = new Set<string>();
  for (const r of adsets) {
    const storeId    = String(r.store_id ?? '');
    const platform   = titleCasePlatform(r.platform);
    const campaignId = String(r.campaign_id ?? '');
    const adSetId    = String(r.ad_set_id ?? '');
    if (!storeId || !campaignId || !adSetId) continue;
    const campaignKey = `${storeId}::${platform}::${campaignId}`;
    const status = byCampaign.get(campaignKey);
    if (!status) continue;
    const key = `${campaignKey}::${adSetId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out[key] = { status: status.status, updatedAt: status.updatedAt };
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────
// 5b. fetchLastKnownBudgetTypes — last-known CBO/ABO per campaign / ad-set
//     Bug fix (2026-06-04). Mirrors fetchCurrentCampaignStatuses end to end.
// ────────────────────────────────────────────────────────────────────────

/**
 * Bug fix (2026-06-04) — CBO/ABO chip disappears on single-day / "today"
 * views. `campaigns_daily.budget_type` is DERIVED: writers (cronDaily +
 * persistCampaignsLive) set 'CBO' when the campaign budget>0, 'ABO' when the
 * ad-set budget>0, else ''. Meta returns 0/0 budgets for paused / lifetime /
 * budget-off campaigns, so TODAY's rows often carry budget_type='' and the
 * aggregator's gated update loop leaves the aggregate's budget_type='' — the
 * chip vanishes.
 *
 * This reader returns the most-recent NON-EMPTY budget_type per
 * `${storeId}::${Platform}::${campaignId}::${adSetId}` key (last-known wins),
 * so the aggregator can backfill an all-empty in-range window. Meta-only —
 * the chip only renders for Meta. Mirrors `fetchCurrentCampaignStatuses`
 * exactly: SAME key shape, SAME `titleCasePlatform` boundary, SAME
 * `paginate()` ceiling, SAME soft-fail-to-{} (console.warn) on query error.
 *
 * Map value shape: `{ budgetType, lastSeenAt }`. `lastSeenAt` is the row's
 * `date` (YYYY-MM-DD) of the most-recent non-empty budget_type; the
 * aggregator uses it only to break ties when rolling ad-sets up to a
 * campaign (freshest non-empty wins).
 */
export async function fetchLastKnownBudgetTypes(): Promise<
  Record<string, LastKnownBudgetTypeEntry>
> {
  const out: Record<string, LastKnownBudgetTypeEntry> = {};

  let rows: DbRow[];
  try {
    rows = await paginate<DbRow>(() => {
      return getSupabase()
        .from('campaigns_daily')
        .select('store_id, platform, campaign_id, ad_set_id, budget_type, date')
        .eq('platform', 'meta')
        .in('budget_type', ['CBO', 'ABO']);
    });
  } catch (e) {
    console.warn(`postgresReaders.fetchLastKnownBudgetTypes: ${(e as Error).message}`);
    return out;
  }

  // Keep the row with the MOST-RECENT date per key (last-known wins). `date`
  // is a fixed-width YYYY-MM-DD string so lexicographic compare == chrono.
  const latestDate = new Map<string, string>();
  for (const r of rows) {
    const storeId    = String(r.store_id ?? '');
    const platform   = titleCasePlatform(r.platform);
    const campaignId = String(r.campaign_id ?? '');
    const adSetId    = String(r.ad_set_id ?? '');
    if (!storeId || !campaignId || !adSetId) continue;
    const bt = String(r.budget_type ?? '').trim();
    if (bt !== 'CBO' && bt !== 'ABO') continue;
    const date = r.date ? String(r.date) : '';
    if (!date) continue;
    const key = `${storeId}::${platform}::${campaignId}::${adSetId}`;
    const prev = latestDate.get(key);
    if (!prev || date > prev) {
      latestDate.set(key, date);
      out[key] = { budgetType: bt, lastSeenAt: date };
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────
// 6. fetchAdsFromPostgres — ads_daily → AdRow[]
//    Mirrors ads.ts:fetchAdsData (line 71)
// ────────────────────────────────────────────────────────────────────────

/**
 * Postgres equivalent of ads.ts:fetchAdsData. Returns the SAME AdRow[] shape.
 *
 * Same platform TitleCase + storeName fallback as fetchCampaignsFromPostgres.
 * Empty-row filter mirrors ads.ts:120.
 */
export async function fetchAdsFromPostgres(
  opts?: { range?: DateRange },
): Promise<AdRow[]> {
  let data: DbRow[];
  try {
    data = await paginate<DbRow>(() => {
      let q = getSupabase()
        .from('ads_enriched')
        .select(
          'date, store_id, platform, campaign_id, campaign_name, ad_set_id, ' +
            'ad_set_name, ad_id, ad_name, ' +
            // 2026-06-05 — registry-backed name aliases
            // (COALESCE(registry.name, daily.name)) added to ads_enriched. The
            // reader PREFERS these (via preferName) so the Ads UI shows each
            // entity's current name, not a stale per-day name.
            'reg_campaign_name, reg_ad_set_name, reg_ad_name, ' +
            'spend_cad, impressions, clicks, reach, ' +
            'conversions, conversion_value_cad, ' +
            // Phase D (2026-05-30) — registry-backed status columns from
            // ad_registry, joined server-side via the ads_enriched VIEW.
            // 12-column reg_* bundle; we project the 6 the UI consumes,
            // the other 6 are reachable via SELECT * if a future caller
            // needs them. NB: ads_daily has no effective_status column,
            // so the registry is currently keys-only after the Phase D
            // backfill — these columns will be NULL until Phase B/C
            // ad-level status workers ship.
            'reg_configured_status, reg_effective_status, reg_delivery_status, ' +
            'reg_first_seen_at, reg_status_changed_at, reg_last_status_success_at',
        );
      if (opts?.range) {
        q = q.gte('date', opts.range.from).lte('date', opts.range.to);
      }
      return q;
    });
  } catch (e) {
    throw new Error(`postgresReaders.fetchAds: ${(e as Error).message}`);
  }

  const rows: AdRow[] = [];
  for (const r of data) {
    const dateStr = String(r.date);
    if (opts?.range && !isInRange(dateStr, opts.range)) continue;

    const spend = toNumber(r.spend_cad);
    const impressions = toNumber(r.impressions);
    const conversions = toNumber(r.conversions);
    if (spend === 0 && impressions === 0 && conversions === 0) continue;

    const storeId = String(r.store_id);
    rows.push({
      date: dateStr,
      storeId,
      // ads_daily doesn't carry store_name; fall back to the canonical map.
      storeName: STORE_NAME_BY_ID[storeId] ?? storeId,
      platform: titleCasePlatform(r.platform),
      campaignId: String(r.campaign_id),
      campaignName: preferName(
        (r as { reg_campaign_name?: string | null }).reg_campaign_name,
        r.campaign_name as string | null | undefined,
      ),
      adSetId: String(r.ad_set_id),
      adSetName: preferName(
        (r as { reg_ad_set_name?: string | null }).reg_ad_set_name,
        r.ad_set_name as string | null | undefined,
      ),
      adId: String(r.ad_id),
      adName: preferName(
        (r as { reg_ad_name?: string | null }).reg_ad_name,
        r.ad_name as string | null | undefined,
      ),
      spend,
      impressions,
      clicks: toNumber(r.clicks),
      conversions,
      conversionValue: toNumber(r.conversion_value_cad),
      reach: (r as { reach?: unknown }).reach == null
        ? null
        : toNumber((r as { reach?: unknown }).reach),
      // Phase D (2026-05-30) — registry-backed status fields joined via the
      // ads_enriched VIEW. NULL in production until Phase B/C ad-level
      // status workers populate ad_registry (none exist yet; the registry
      // was keys-only backfilled).
      regConfiguredStatus: (() => {
        const v = (r as { reg_configured_status?: unknown }).reg_configured_status;
        if (v === null || v === undefined) return null;
        const s = String(v).trim();
        return s || null;
      })(),
      regEffectiveStatus: (() => {
        const v = (r as { reg_effective_status?: unknown }).reg_effective_status;
        if (v === null || v === undefined) return null;
        const s = String(v).trim();
        return s || null;
      })(),
      regDeliveryStatus: (() => {
        const v = (r as { reg_delivery_status?: unknown }).reg_delivery_status;
        if (v === null || v === undefined) return null;
        const s = String(v).trim();
        return s || null;
      })(),
      regFirstSeenAt: (() => {
        const v = (r as { reg_first_seen_at?: unknown }).reg_first_seen_at;
        if (v === null || v === undefined) return null;
        const s = String(v).trim();
        return s || null;
      })(),
      regStatusChangedAt: (() => {
        const v = (r as { reg_status_changed_at?: unknown }).reg_status_changed_at;
        if (v === null || v === undefined) return null;
        const s = String(v).trim();
        return s || null;
      })(),
      regLastStatusSuccessAt: (() => {
        const v = (r as { reg_last_status_success_at?: unknown }).reg_last_status_success_at;
        if (v === null || v === undefined) return null;
        const s = String(v).trim();
        return s || null;
      })(),
    });
  }
  return rows;
}

// ────────────────────────────────────────────────────────────────────────
// 7. fetchOrdersAttributionFromPostgres — orders_attribution → OrderAttributionRow[]
//    Mirrors ordersAttribution.ts:fetchOrdersAttribution (line 187)
// ────────────────────────────────────────────────────────────────────────

/**
 * Postgres equivalent of ordersAttribution.ts:fetchOrdersAttribution.
 * Returns the SAME OrderAttributionRow[] shape.
 *
 * `includeLineItems` toggle matches the Sheets-side API exactly: when false
 * (the default), the heavy line_items JSONB column is still read but is
 * post-processed to [] before returning, so the wire shape stays consistent.
 * (Unlike Sheets, we can't easily skip the column at the SQL level without
 * branching the select string; the savings come from short-circuiting the
 * parser, which is the dominant cost on the consumer side.)
 *
 * Range filter pushed down via .gte/.lte. Empty `order_id` rows are skipped
 * (matches ordersAttribution.ts:240).
 */
export async function fetchOrdersAttributionFromPostgres(
  opts?: { range?: DateRange; includeLineItems?: boolean },
): Promise<OrderAttributionRow[]> {
  const includeLI = opts?.includeLineItems === true;

  let data: DbRow[];
  try {
    data = await paginate<DbRow>(() => {
      let q = getSupabase()
        .from('orders_attribution')
        .select(ORDERS_ATTRIBUTION_SELECT);
      if (opts?.range) {
        q = q.gte('date', opts.range.from).lte('date', opts.range.to);
      }
      return q;
    });
  } catch (e) {
    throw new Error(`postgresReaders.fetchOrdersAttribution: ${(e as Error).message}`);
  }

  const rows: OrderAttributionRow[] = [];
  for (const r of data) {
    const dateStr = String(r.date);
    if (opts?.range && !isInRange(dateStr, opts.range)) continue;

    const orderId = String(r.order_id ?? '').trim();
    if (!orderId) continue;

    const storeId = String(r.store_id);
    rows.push({
      date: dateStr,
      storeId,
      // orders_attribution doesn't carry store_name; fall back to canonical map.
      storeName: STORE_NAME_BY_ID[storeId] ?? storeId,
      orderId,
      totalCad: toNumber(r.total_cad),
      source: String(r.source ?? '').trim() as OrderAttributionRow['source'],
      utmSource: String(r.utm_source ?? '').trim(),
      utmMedium: String(r.utm_medium ?? '').trim(),
      utmCampaign: String(r.utm_campaign ?? '').trim(),
      utmContent: String(r.utm_content ?? '').trim(),
      fbclidPresent: r.fbclid_present === true,
      gclidPresent: r.gclid_present === true,
      referringSite: String(r.referrer ?? '').trim(),
      utmId: String(r.utm_id ?? '').trim(),
      utmTerm: String(r.utm_term ?? '').trim(),
      // Matches ordersAttribution.ts:259 — empty [] when includeLineItems=false,
      // so iteration without null-guards remains safe.
      lineItems: includeLI ? parseLineItems(r.line_items) : [],
      customerId:
        r.customer_id == null ? null : String(r.customer_id).trim() || null,
      orderCreatedAt:
        r.order_created_at == null ? null : String(r.order_created_at),
      isFirstOrder:
        r.is_first_order === true ? true : r.is_first_order === false ? false : null,
      // Phase 4 — first-click. NULL columns → null/false (no first-click
      // signal), never coerced to 'direct'.
      firstTouchSource:
        r.first_touch_source == null ? null : String(r.first_touch_source).trim() || null,
      firstFbclidPresent: r.first_fbclid_present === true,
      firstGclidPresent: r.first_gclid_present === true,
      firstTtclidPresent: r.first_ttclid_present === true,
      firstUtmSource:
        r.first_utm_source == null ? null : String(r.first_utm_source).trim() || null,
      firstUtmMedium:
        r.first_utm_medium == null ? null : String(r.first_utm_medium).trim() || null,
      firstUtmCampaign:
        r.first_utm_campaign == null ? null : String(r.first_utm_campaign).trim() || null,
      firstUtmContent:
        r.first_utm_content == null ? null : String(r.first_utm_content).trim() || null,
      firstUtmId:
        r.first_utm_id == null ? null : String(r.first_utm_id).trim() || null,
      firstUtmTerm:
        r.first_utm_term == null ? null : String(r.first_utm_term).trim() || null,
      firstSeenAt:
        r.first_seen_at == null ? null : String(r.first_seen_at).trim() || null,
      paymentGateway:
        r.payment_gateway == null ? null : String(r.payment_gateway).trim() || null,
    });
  }
  return rows;
}

// ────────────────────────────────────────────────────────────────────────
// 7b. fetchCohortMonthlyFromPostgres — customer_cohort_monthly → CohortMonthlyRow[]
//    Wave 2 (2026-06-03) — backs the customer-value (cohorts/LTV) tab. The
//    table is seeded from full Shopify Bulk history joined to the
//    customer_first_order ledger (scripts/backfillCohortMonthly.ts) and
//    refreshed weekly (full replace per store) by cron-cohort-refresh.
// ────────────────────────────────────────────────────────────────────────

/**
 * Wave 2 — canonical customer_cohort_monthly SELECT column list. Exported so
 * the select-string presence guard can pin every downstream-consumed column
 * (a dropped column otherwise reads back undefined). Mirrors the
 * ORDERS_ATTRIBUTION_SELECT convention. `updated_at` is intentionally NOT in
 * the consumed set — the UI never surfaces the per-cell write time.
 */
export const COHORT_MONTHLY_SELECT =
  'store_id, first_order_month, month_since, active_customers, orders, gross_cad, net_cad, repeat_customers';

/**
 * One normalized row of the customer_cohort_monthly aggregate. CamelCase to
 * match the rest of the reader layer; numerics are coerced via `toNumber` so
 * NUMERIC/INT columns (which supabase-js may return as string or number)
 * always surface as finite numbers for the pure compute layer.
 */
export type CohortMonthlyRow = {
  storeId: string;
  /** 'YYYY-MM' — the cohort's first-order month (from the ledger). */
  firstOrderMonth: string;
  /** 0..11 — whole calendar months since the cohort's first order (cap 11). */
  monthSince: number;
  /** Distinct customers of the cohort who ordered in that month_since. */
  activeCustomers: number;
  orders: number;
  grossCad: number;
  netCad: number;
  /**
   * A6 (2026-06-04) — distinct in-window (12mo) repeaters for the cohort,
   * populated ONLY on the M0 row (null elsewhere, and null on rows written
   * before the column was backfilled). The honest repeat-rate numerator.
   */
  repeatCustomers: number | null;
};

/**
 * Postgres reader for the customer_cohort_monthly aggregate.
 *
 * - Optional `storeId` filter pushed down server-side via `.eq('store_id', …)`
 *   (the /api/cohorts route returns all stores; the client slices by store,
 *   like /api/orders-attribution — so the filter is an optional convenience).
 * - Deterministic ordering: `first_order_month` then `month_since`, so the
 *   compute layer and any cohort-grid render see cells in a stable shape.
 * - Paginated (via `paginate()`) to bypass Supabase Cloud's db-max-rows=1000
 *   cap — same as every other multi-row reader here.
 */
export async function fetchCohortMonthlyFromPostgres(
  opts?: { storeId?: string },
): Promise<CohortMonthlyRow[]> {
  let data: DbRow[];
  try {
    data = await paginate<DbRow>(() => {
      let q = getSupabase()
        .from('customer_cohort_monthly')
        .select(COHORT_MONTHLY_SELECT);
      if (opts?.storeId) {
        q = q.eq('store_id', opts.storeId);
      }
      // Stable cell order for the compute layer + cohort grid.
      return q
        .order('first_order_month', { ascending: true })
        .order('month_since', { ascending: true });
    });
  } catch (e) {
    throw new Error(`postgresReaders.fetchCohortMonthly: ${(e as Error).message}`);
  }

  const rows: CohortMonthlyRow[] = [];
  for (const r of data) {
    rows.push({
      // A1 (2026-06-04): project to the DISPLAY name on the reader boundary —
      // the customer-value scope selector + global filter use display names
      // (data.stores), so emitting the raw store_id matched only uzoshop
      // (identical string) and rendered an all-zero tab for Zol Plus / 360usmile.
      // Mirrors every sibling reader (campaigns/products/payments).
      storeId: STORE_NAME_BY_ID[String(r.store_id)] ?? String(r.store_id),
      firstOrderMonth: String(r.first_order_month ?? '').trim(),
      monthSince: toNumber(r.month_since),
      activeCustomers: toNumber(r.active_customers),
      orders: toNumber(r.orders),
      grossCad: toNumber(r.gross_cad),
      netCad: toNumber(r.net_cad),
      repeatCustomers: r.repeat_customers == null ? null : toNumber(r.repeat_customers),
    });
  }
  return rows;
}

// ────────────────────────────────────────────────────────────────────────
// 7c. readPaymentMethodsByMonth — orders_attribution → PaymentMethodsByMonth
//     תשלומים (2026-06-03) — per-month split of sales by payment gateway
//     (credit / paypal / other) as orders + revenue (CAD), business-wide and
//     per-store. Categorization is regex-based (categorizePaymentGateway), so
//     it runs in code over the raw `payment_gateway` rather than in SQL.
// ────────────────────────────────────────────────────────────────────────

/**
 * תשלומים — canonical orders_attribution SELECT for the payment-methods
 * aggregate. Exported so the select-string presence guard can pin every
 * downstream-consumed column (a dropped column otherwise reads back undefined).
 * Mirrors the ORDERS_ATTRIBUTION_SELECT / COHORT_MONTHLY_SELECT convention.
 */
export const PAYMENT_METHODS_SELECT = 'store_id, date, total_cad, payment_gateway';

/** One gateway bucket: order count + revenue (CAD, already FX-converted). */
export type PaymentBucket = { orders: number; revenueCad: number };

/** The three categories, fully populated (zeroed when a category is absent). */
export type PaymentCategoryTotals = Record<PaymentCategory, PaymentBucket>;

/** One month's split: per-store buckets + a business-wide rollup. */
export type PaymentMethodsMonth = {
  /** 'YYYY-MM'. */
  month: string;
  /** Keyed by store_id → the store's credit/paypal/other buckets. */
  perStore: Record<string, PaymentCategoryTotals>;
  /** Sum across all stores in the month. */
  business: PaymentCategoryTotals;
};

/** Result of readPaymentMethodsByMonth — months ascending. */
export type PaymentMethodsByMonth = { months: PaymentMethodsMonth[] };

/** A fresh zeroed credit/paypal/other bucket set. */
function emptyCategoryTotals(): PaymentCategoryTotals {
  return {
    credit: { orders: 0, revenueCad: 0 },
    paypal: { orders: 0, revenueCad: 0 },
    other: { orders: 0, revenueCad: 0 },
  };
}

/**
 * Aggregate orders_attribution per month × store × payment category.
 *
 * - Reads the raw `payment_gateway` and categorizes in code via
 *   `categorizePaymentGateway` (regex-based — not expressible cheaply in the
 *   PostgREST select). NULL / unbackfilled gateways fall into `other`.
 * - Revenue sums `total_cad` (already FX-converted to CAD; no FX work here).
 * - Month derived from the `date` string's 'YYYY-MM' prefix (orders_attribution
 *   `date` is an IL-local 'YYYY-MM-DD' day key — same source the other order
 *   readers consume), so month bucketing stays consistent with the rest of the
 *   reader layer without a SQL date_trunc.
 * - Paginated (via `paginate()`) to bypass Supabase Cloud's db-max-rows=1000.
 * - Per-store buckets are keyed by the store DISPLAY NAME (STORE_NAME_BY_ID,
 *   e.g. 'Zol Plus' / '360usmile') — NOT the raw store_id — so the keys match
 *   `data.stores` (built from `storeName`) and the global store filter that the
 *   client layer uses everywhere. (Keying by store_id silently broke the
 *   per-store picker for every store whose name ≠ id: 2026-06-04 incident.)
 *   The business rollup is the sum across stores. Months are returned ascending.
 */
export async function readPaymentMethodsByMonth(): Promise<PaymentMethodsByMonth> {
  let data: DbRow[];
  try {
    data = await paginate<DbRow>(() =>
      getSupabase().from('orders_attribution').select(PAYMENT_METHODS_SELECT),
    );
  } catch (e) {
    throw new Error(`postgresReaders.readPaymentMethodsByMonth: ${(e as Error).message}`);
  }

  // month → { perStore, business }
  const byMonth = new Map<string, PaymentMethodsMonth>();

  for (const r of data) {
    const month = String(r.date ?? '').slice(0, 7);
    // Guard against malformed dates (no 'YYYY-MM' prefix) — skip rather than
    // bucket under an empty month key.
    if (month.length !== 7) continue;

    const storeId = String(r.store_id);
    // Key per-store buckets by the DISPLAY NAME so they match data.stores /
    // the global store filter (the client identifies stores by name, not id).
    const storeKey = STORE_NAME_BY_ID[storeId] ?? storeId;
    const category = categorizePaymentGateway(
      r.payment_gateway == null ? null : String(r.payment_gateway),
    );
    const revenueCad = toNumber(r.total_cad);

    let entry = byMonth.get(month);
    if (!entry) {
      entry = { month, perStore: {}, business: emptyCategoryTotals() };
      byMonth.set(month, entry);
    }

    let store = entry.perStore[storeKey];
    if (!store) {
      store = emptyCategoryTotals();
      entry.perStore[storeKey] = store;
    }

    store[category].orders += 1;
    store[category].revenueCad += revenueCad;
    entry.business[category].orders += 1;
    entry.business[category].revenueCad += revenueCad;
  }

  const months = [...byMonth.values()].sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
  return { months };
}

// ────────────────────────────────────────────────────────────────────────
// 8. fetchProductCatalogFromPostgres — product_catalog → CatalogProduct[]
//    Mirrors productCatalog.ts:fetchProductCatalog (line 59)
// ────────────────────────────────────────────────────────────────────────

/**
 * Postgres equivalent of productCatalog.ts:fetchProductCatalog. Returns the
 * SAME CatalogProduct[] shape.
 *
 * No range filtering — the catalog is a snapshot of every product, used by
 * the ProductPickerModal so fresh items (zero sales yet) are still pickable.
 */
export async function fetchProductCatalogFromPostgres(): Promise<CatalogProduct[]> {
  let data: DbRow[];
  try {
    data = await paginate<DbRow>(() =>
      getSupabase()
        .from('product_catalog')
        .select('store_id, product_id, title, handle, status, price_cad, image_url, product_type, vendor'),
    );
  } catch (e) {
    throw new Error(`postgresReaders.fetchProductCatalog: ${(e as Error).message}`);
  }

  const rows: CatalogProduct[] = [];
  for (const r of data) {
    const productId = String(r.product_id ?? '').trim();
    if (!productId) continue;

    const storeId = String(r.store_id);
    rows.push({
      productId,
      storeId,
      storeName: STORE_NAME_BY_ID[storeId] ?? storeId,
      title: String(r.title ?? '').trim() || '(ללא שם)',
      handle: String(r.handle ?? '').trim(),
      status: String(r.status ?? '').trim(),
      priceCad: toNumber(r.price_cad),
      imageUrl: String(r.image_url ?? '').trim(),
      productType: String(r.product_type ?? '').trim(),
      vendor: String(r.vendor ?? '').trim(),
    });
  }
  return rows;
}

// ────────────────────────────────────────────────────────────────────────
// 9. upsertDashboardStateKeyPostgres — dashboard_state INSERT/UPDATE
//    Mirrors sheets.ts:upsertDashboardStateKey (line 432) — WRITE side.
//    Phase 05.7 — replaces the Sheets write path for /api/dashboard-state POST.
// ────────────────────────────────────────────────────────────────────────

/**
 * Postgres equivalent of sheets.ts:upsertDashboardStateKey.
 *
 * Atomic UPSERT on the `dashboard_state` table (`key TEXT PRIMARY KEY,
 * value JSONB, updated_at TIMESTAMPTZ` per migration 20260521063112).
 *
 * Why service_role (`getSupabaseAdmin`) and not anon:
 *   - Migration 20260521075741 grants anon SELECT only on dashboard_state.
 *     INSERT/UPDATE need an authenticated role; service_role bypasses RLS
 *     (which is disabled here anyway) and is the simplest write path under
 *     the URL-obscurity trust model (D-D2).
 *   - This function is server-side only (called from the /api/dashboard-state
 *     POST handler). It must NEVER be imported by a client component, same
 *     constraint as `getSupabaseAdmin` itself.
 *
 * Concurrency vs. the Sheets writer: the Sheets writer had a CR2-01 race
 * (two concurrent appends for the same new key produced duplicate rows).
 * Postgres's PRIMARY KEY on `key` + the `onConflict: 'key'` upsert clause
 * collapses that race to a single row server-side — no duplicate-cleanup
 * branch needed. The .upsert call here is therefore strictly safer than
 * the Sheets path it replaces, with no behavioral regression on the
 * single-key happy path.
 *
 * Caller invariants (matches sheets.ts:upsertDashboardStateKey):
 *   - `key` MUST already pass `isAllowedStateKey` (the /api/dashboard-state
 *     route validates this at the API boundary; we do not re-validate here
 *     for the same reason the Sheets writer does not).
 *   - `value` MUST be JSON-serializable (the JSONB column will throw on
 *     non-serializable inputs — `BigInt`, circular refs, etc. The route
 *     handler's `JSON.stringify(body.value ?? null)` size-check above this
 *     call also surfaces those errors first).
 */
export async function upsertDashboardStateKeyPostgres(
  key: string,
  value: unknown,
): Promise<void> {
  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from('dashboard_state')
    .upsert(
      {
        key,
        // JSONB column accepts any JSON-serializable value. Cast is required
        // because supabase-js's untyped insert type insists on a row-shape
        // mapping; we don't have a generated Database<T> codegen.
        value: value as never,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' },
    );
  if (error) {
    throw new Error(`dashboard_state upsert (${key}): ${error.message}`);
  }
}

// ────────────────────────────────────────────────────────────────────────
// 10. fetchManualOverridesForRange — manual_overrides → OverrideRowAsRead[]
//     DQ-3 (2026-06-04) — raw read for the overrides-active data-quality
//     summary. Feeds the pure `overridesActive()` helper in
//     src/lib/home/overridesActive.ts (which owns the OverrideRowAsRead type).
// ────────────────────────────────────────────────────────────────────────

/**
 * Reads the `manual_overrides` rows whose `date` falls inside [range.from,
 * range.to] (both inclusive), in the shape the pure `overridesActive()` helper
 * consumes. The wire shape is OverrideRowAsRead — owned by overridesActive.ts;
 * we IMPORT it (never redefine) so a column drift surfaces at the type
 * boundary.
 *
 * `updated_at` + `applies_to` are added by migration
 * 20260604130000_manual_overrides_audit_cols.sql (NULL on existing rows). The
 * select requests them so they're present post-apply; before the migration
 * runs the column doesn't exist and the query soft-fails to [] — the helper
 * already treats both as forward-compat OPTIONAL fields.
 *
 * Soft-fail: a query error returns `[]` (console.warn), mirroring
 * fetchCurrentCampaignStatuses — the data-quality badge is an enhancement,
 * never a hard dependency, so a DB hiccup degrades to "no overrides flagged"
 * rather than crashing the Home surface.
 */
export async function fetchManualOverridesForRange(
  range: DateRange,
): Promise<OverrideRowAsRead[]> {
  let data: DbRow[];
  try {
    data = await paginate<DbRow>(() =>
      getSupabase()
        .from('manual_overrides')
        .select(
          'id, date, store_id, platform, spend, currency, notes, created_at, updated_at, applies_to',
        )
        .gte('date', range.from)
        .lte('date', range.to),
    );
  } catch (e) {
    console.warn(`postgresReaders.fetchManualOverridesForRange: ${(e as Error).message}`);
    return [];
  }

  const rows: OverrideRowAsRead[] = [];
  for (const r of data) {
    rows.push({
      id: Number(r.id),
      date: String(r.date ?? '').trim(),
      store_id: String(r.store_id ?? '').trim(),
      platform: String(r.platform ?? '').trim(),
      // spend is NUMERIC(14,4) — may decode as number or string; the
      // OverrideRowAsRead type accepts `number | string`, so we pass through
      // without coercion to preserve fidelity (the helper doesn't read it).
      spend: (r.spend as number | string) ?? 0,
      currency: String(r.currency ?? '').trim(),
      notes: r.notes == null ? null : String(r.notes),
      created_at: String(r.created_at ?? '').trim(),
      updated_at: r.updated_at == null ? null : String(r.updated_at),
      applies_to: r.applies_to == null ? null : String(r.applies_to),
    });
  }
  return rows;
}

// ────────────────────────────────────────────────────────────────────────
// 11. fetchCohortAsOf — data_freshness → ISO string | null
//     DQ-6 (2026-06-04) — the "data as of" timestamp for the cohort/LTV
//     surface: the freshest successful cohort_monthly refresh.
// ────────────────────────────────────────────────────────────────────────

/**
 * Returns max(last_success_at) across data_freshness rows where
 * scope = 'cohort_monthly' AND status = 'success', or null when no successful
 * cohort refresh has been recorded yet.
 *
 * `last_success_at` is the success-timestamp column on data_freshness (see
 * FreshnessRow in src/lib/inngest/freshness.ts) — recordFreshness sets it to
 * NOW() on every success and preserves the prior value on failure.
 *
 * Implementation: order by last_success_at desc, take the first non-null —
 * cheaper than a server-side aggregate and avoids relying on a NUMERIC/agg
 * decode. Soft-fail to null (console.warn) — the UI degrades to "no as-of
 * chip" rather than crashing.
 */
export async function fetchCohortAsOf(): Promise<string | null> {
  try {
    const { data, error } = await getSupabase()
      .from('data_freshness')
      .select('last_success_at')
      .eq('scope', 'cohort_monthly')
      .eq('status', 'success')
      .not('last_success_at', 'is', null)
      .order('last_success_at', { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    const row = (data as unknown as DbRow[] | null)?.[0];
    if (!row) return null;
    const ts = row.last_success_at;
    return ts == null ? null : String(ts);
  } catch (e) {
    console.warn(`postgresReaders.fetchCohortAsOf: ${(e as Error).message}`);
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────────
// 12. fetchTikTokCoverageInputs — data_daily + campaigns_daily → coverage feed
//     DQ-7 (2026-06-04) — the inputs for the pure `tiktokCoverage()` helper
//     (src/lib/home/tiktokCoverage.ts): account-level total vs Σ per-campaign.
// ────────────────────────────────────────────────────────────────────────

/**
 * Returns the two inputs `tiktokCoverage()` needs over [range.from, range.to]:
 *
 *   - accountTotalCad: Σ data_daily.tt_spend_cad across ALL stores in the
 *     range. TikTok runs a single shared ad account whose spend is attributed
 *     to stores via the campaign-store-map; the per-store tt_spend_cad columns
 *     therefore SUM back to the account total. This is the mapping-AGNOSTIC
 *     account figure coverage compares against Σ-mapped-campaigns. Already
 *     FX-converted to CAD by the writers (no FX work here).
 *
 *   - campaigns: one entry per TikTok campaigns_daily row in range →
 *     { campaignId, advertiserId, spendCad }. The shape `tiktokCoverage()`
 *     expects, used to build the `tiktok::<advertiserId>::<campaignId>` map
 *     key.
 *
 * advertiserId resolution: campaigns_daily has NO advertiser_id column
 * (campaigns are stored under the MAPPED store_id, not the advertiser). TikTok
 * is a single shared account; its advertiser id is env-sourced via
 * `UZOSHOP_TIKTOK_ADVERTISER_ID` (uzoshop is the default/owning store per
 * ARCHITECTURE §A.5). We attach that single advertiser id to every campaign so
 * the key matches the campaign-store-map (which is keyed the same way). When
 * the env var is unset the advertiserId is '' — the pure helper still works,
 * it just won't find map entries (every campaign falls to the default-store
 * fallback or unmapped), which is the correct degraded behaviour.
 *
 * Soft-fail: any error returns `{ accountTotalCad: 0, campaigns: [] }`
 * (console.warn) — the coverage badge degrades to "nothing to flag".
 */
export async function fetchTikTokCoverageInputs(
  range: DateRange,
): Promise<{
  accountTotalCad: number;
  campaigns: Array<{ campaignId: string; advertiserId: string; spendCad: number }>;
}> {
  // Single shared TikTok account → advertiser id from the default/owning
  // store's env var. Trim to '' (not undefined) so the key shape stays a
  // string in every branch.
  const advertiserId =
    process.env.UZOSHOP_TIKTOK_ADVERTISER_ID?.trim() || '';

  try {
    // 1. Account total = Σ tt_spend_cad across all stores in range. Project
    //    only the one column we sum (cheaper than the full daily SELECT).
    const dailyRows = await paginate<DbRow>(() =>
      getSupabase()
        .from('data_daily')
        .select('tt_spend_cad')
        .gte('date', range.from)
        .lte('date', range.to),
    );
    let accountTotalCad = 0;
    for (const r of dailyRows) {
      accountTotalCad += toNumber(r.tt_spend_cad);
    }

    // 2. Per-campaign TikTok rows in range. campaigns_daily is ad-set-granular
    //    (PK includes ad_set_id) — sum spend_cad per campaign_id so the
    //    coverage feed is one entry per campaign (matching the helper's
    //    campaign-keyed map). Rows with empty campaign_id are skipped.
    const campRows = await paginate<DbRow>(() =>
      getSupabase()
        .from('campaigns_daily')
        .select('campaign_id, spend_cad')
        .eq('platform', 'tiktok')
        .gte('date', range.from)
        .lte('date', range.to),
    );
    const spendByCampaign = new Map<string, number>();
    for (const r of campRows) {
      const campaignId = String(r.campaign_id ?? '').trim();
      if (!campaignId) continue;
      spendByCampaign.set(
        campaignId,
        (spendByCampaign.get(campaignId) ?? 0) + toNumber(r.spend_cad),
      );
    }

    const campaigns = [...spendByCampaign.entries()].map(([campaignId, spendCad]) => ({
      campaignId,
      advertiserId,
      spendCad,
    }));

    return { accountTotalCad, campaigns };
  } catch (e) {
    console.warn(`postgresReaders.fetchTikTokCoverageInputs: ${(e as Error).message}`);
    return { accountTotalCad: 0, campaigns: [] };
  }
}
