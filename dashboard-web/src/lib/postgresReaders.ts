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
import type { StoreMetaRow } from './sheets';
import type { ProductRow } from './products';
import type { CampaignRow } from './campaigns';
import type { AdRow } from './ads';
import type { OrderAttributionRow, OrderLineItem } from './ordersAttribution';
import type { CatalogProduct } from './productCatalog';

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
function titleCasePlatform(v: unknown): 'Meta' | 'Google' | string {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (s.toLowerCase() === 'meta') return 'Meta';
  if (s.toLowerCase() === 'google') return 'Google';
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
          'date, store_id, store_name, fb_spend_cad, ga_spend_cad, total_spend_cad, ' +
            'revenue_cad, roas, gross_profit_cad, cogs_cad, net_profit_cad, ' +
            'gross_revenue_cad, refund_deduction_cad',
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
    const totalSpendRaw = r.total_spend_cad;
    const totalSpend =
      totalSpendRaw === null || totalSpendRaw === undefined
        ? fbSpend + gaSpend
        : toNumber(totalSpendRaw) || fbSpend + gaSpend;
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

    rows.push({
      date: dateStr,
      storeId: String(r.store_id),
      storeName: String(r.store_name),
      fbSpend,
      gaSpend,
      totalSpend,
      revenue,
      roas,
      grossProfit,
      cogs,
      netProfit,
      hasCogs: true,
      grossRevenue,
      refundDeduction,
    });
  }
  return rows;
}

// ────────────────────────────────────────────────────────────────────────
// 2. fetchStoreMetaFromPostgres — stores → StoreMetaRow[]
//    Mirrors sheets.ts:fetchStoreMeta (line 239)
// ────────────────────────────────────────────────────────────────────────

/**
 * Postgres equivalent of sheets.ts:fetchStoreMeta. Returns the SAME
 * StoreMetaRow[] shape.
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
 * The 'act_' prefix strip and dash strip mirror sheets.ts:275-276 — that's
 * the canonical shape; consumers (CampaignsTable, CampaignDrawer) build deep
 * links from these normalized IDs.
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
        .from('campaigns_daily')
        .select(
          'date, store_id, platform, campaign_id, campaign_name, ' +
            'ad_set_id, ad_set_name, spend_cad, impressions, clicks, conversions, ' +
            'conversion_value_cad, campaign_budget_cad, ad_set_budget_cad, budget_type',
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
    if (spend === 0 && impressions === 0 && conversions === 0) continue;

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
      campaignName: String(r.campaign_name ?? '').trim() || '—',
      adSetId: String(r.ad_set_id),
      adSetName: String(r.ad_set_name ?? '').trim() || '—',
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
    });
  }
  return rows;
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
        .from('ads_daily')
        .select(
          'date, store_id, platform, campaign_id, campaign_name, ad_set_id, ' +
            'ad_set_name, ad_id, ad_name, spend_cad, impressions, clicks, ' +
            'conversions, conversion_value_cad',
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
      campaignName: String(r.campaign_name ?? '').trim() || '—',
      adSetId: String(r.ad_set_id),
      adSetName: String(r.ad_set_name ?? '').trim() || '—',
      adId: String(r.ad_id),
      adName: String(r.ad_name ?? '').trim() || '—',
      spend,
      impressions,
      clicks: toNumber(r.clicks),
      conversions,
      conversionValue: toNumber(r.conversion_value_cad),
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
        .select(
          'date, store_id, order_id, total_cad, source, utm_source, utm_medium, ' +
            'utm_campaign, utm_content, fbclid_present, gclid_present, referrer, ' +
            'utm_id, utm_term, line_items',
        );
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
    });
  }
  return rows;
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
