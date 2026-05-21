/**
 * Phase 05.6-04 — pure-TS port of `MetaAds.gs` (Meta Marketing Insights API).
 *
 * Two public entry points + one type:
 *   1. `fetchMetaAdSetInsights(storeId, dateStr)` — per-adset row array used
 *      by the campaigns/ads tables (mirror of `getMetaAdSetInsights` in
 *      MetaAds.gs:19-83).
 *   2. `fetchMetaSpendForDay(storeId, dateStr)` — per-day store-level aggregate
 *      consumed by the daily-spend pipeline (replaces `getMetaSpend` in
 *      MetaAds.gs:100-133). Reuses `fetchMetaAdSetInsights` internally so we
 *      do NOT issue a second `level=account` round-trip on the cron path.
 *
 * Algorithm parity (D-C4, threat T-05.6-04-S4):
 *   - Purchase counts/values extracted in priority order
 *     omni_purchase → purchase → offsite_conversion.fb_pixel_purchase.
 *     This array is the ONLY source of truth — re-introducing the priority
 *     bug would be a Spoofing regression (see threat register).
 *   - Empty rows where spend === 0 AND impressions === 0 AND conversions === 0
 *     are dropped (matches MetaAds.gs:57). Rows with late-attributed
 *     conversions (spend=0, impressions=0, but conv>0) are kept — Meta
 *     routinely attributes purchases to already-paused ad sets via its
 *     attribution window, and dropping them lost revenue in the past.
 *
 * Version bump (D-C5 + RESEARCH §State of the Art):
 *   META_API_VERSION = 'v23.0'. The Apps Script side stays on v20.0 (which
 *   deprecates 2026-09-24). All Marketing API versions <v24.0 deprecate
 *   2026-06-09. v23.0 is the current stable per RESEARCH (line 508) and
 *   exposes the same insights field shape as v20 (assumption A2). The Apps
 *   Script side is bumped in a parallel commit — not in this file (D-C5 +
 *   Phase 05.6 CONTEXT "No .gs file modifications").
 *
 * Trust boundary (threat T-05.6-04-I2):
 *   The access token rides in the URL query string — Meta's Marketing API
 *   does NOT accept a Bearer header. This mirrors `MetaAds.gs:35` exactly.
 *   Logs are server-side only; never reach the browser.
 *
 * No `zod` runtime validation (per RESEARCH §Standard Stack): payloads are
 * operator-trusted from Meta's known API. We narrow the response shape with
 * TypeScript types only.
 */

/**
 * Meta Graph API version. Pinned to v23.0 — v20.0 (Apps Script) deprecates
 * 2026-09-24; all versions <v24.0 deprecate 2026-06-09. v23.0 is the current
 * stable surface at planning time and exposes the same insights endpoint
 * field shape as v20.0 (assumption A2 — RESEARCH §Pattern 3).
 */
export const META_API_VERSION = 'v23.0';

/**
 * One row of Meta /insights at `level=adset` — the unified shape the
 * dashboard's campaigns table consumes.
 */
export type MetaAdSetRow = {
  campaignId: string;
  campaignName: string;
  adSetId: string;
  adSetName: string;
  /** spend in the ad account's currency (ILS for all 3 stores per the seed) */
  spend: number;
  /** ISO 4217 code from `account_currency` (defaults to 'ILS' if missing) */
  currency: string;
  impressions: number;
  clicks: number;
  /** purchase COUNT, picked from `actions[]` by priority chain */
  conversions: number;
  /** purchase VALUE (in account currency), picked from `action_values[]` */
  conversionValue: number;
};

/**
 * Phase 05.6.1 — one row of Meta /insights at `level=ad`. Same shape that
 * the `ads_daily` writer in cronDaily.ts UPSERTs into Supabase.
 *
 * `spendCad`/`conversionValueCad` are intentionally NULL here even when
 * spend > 0 in the source currency: per-ad FX conversion would require
 * another step.run call (or a per-ad rate lookup) and the store-level total
 * is already FX-converted by mergeOverridesFromSupabase. Leaving these as
 * null at the ad-row level keeps the daily exec budget at 6 steps/run
 * (matches the plan's free-tier guarantee in cronDaily.ts:24-26). A future
 * pass can backfill these from a single store-level FX rate per day.
 *
 * `platform` is fixed to 'meta' so the writer can `.map(r => ({ ...r,
 * platform: 'meta' }))` if needed; we include it in the type for symmetry
 * with `GoogleAdsAdRow`.
 */
export type MetaAdRow = {
  storeId: string;
  date: string;
  platform: 'meta';
  campaignId: string;
  campaignName: string;
  adSetId: string;
  adSetName: string;
  adId: string;
  adName: string;
  impressions: number;
  clicks: number;
  /** purchase COUNT — same priority chain as MetaAdSetRow.conversions */
  conversions: number;
  /**
   * spend in the ad account's CURRENCY (e.g. ILS). The writer in
   * cronDaily.ts FX-converts this to CAD once per (store, date) and
   * stores in ads_daily.spend_cad. Before 2026-05-21 this was typed
   * `spendCad: number | null` and always set to null, which made the
   * dashboard render every Meta ad with $0 spend — a major regression
   * vs the Sheets-side reader. Same fix path as MetaAdSetRow.
   */
  spend: number;
  /** ISO 4217 code from `account_currency` (defaults to 'ILS' if missing) */
  currency: string;
  /** purchase VALUE in account currency (mirror of MetaAdSetRow.conversionValue) */
  conversionValue: number;
};

/** Per-day store-level aggregate returned by `fetchMetaSpendForDay`. */
export type MetaDailyStoreSpend = {
  storeId: string;
  /** YYYY-MM-DD (same string that was passed in) */
  date: string;
  /** sum of all ad-set spend in the account currency */
  spend: number;
  /** account currency (from the first row, defaults to ILS) */
  currency: string;
};

/**
 * Phase 05.7.2 — return shape for `fetchMetaBudgets`. Direct port of the
 * `getMetaBudgets` shape in `MetaAds.gs:148-156`. Two map-of-id objects + a
 * single account-currency code so the cron writer can FX-convert once.
 *
 * Budget values are in MAJOR units (e.g. ILS or USD), already divided by 100
 * from Meta's minor-unit wire shape (agorot/cents). The Apps Script docstring
 * line 155-156 makes the unit explicit: "הערכים daily/lifetime כבר חלוקים
 * ב-100 (כלומר במטבע מלא, לא ב-cents)".
 */
export type MetaBudgets = {
  /** ISO 4217 from `act_{id}?fields=currency`. Defaults to 'ILS' on fetch failure. */
  currency: string;
  /** campaignId → budgets, populated for both CBO and lifetime-only campaigns. */
  campaigns: Record<
    string,
    {
      /** Daily budget in MAJOR currency units. 0 when unset / lifetime-only / paused. */
      dailyBudget: number;
      /** Lifetime budget in MAJOR currency units. 0 when unset. */
      lifetimeBudget: number;
      /** e.g. 'LOWEST_COST_WITHOUT_CAP', 'COST_CAP', '' when unset. */
      bidStrategy: string | null;
    }
  >;
  /** adSetId → budgets + campaign membership. */
  adSets: Record<
    string,
    {
      /** Daily budget in MAJOR currency units. 0 when CBO (campaign owns budget). */
      dailyBudget: number;
      /** Lifetime budget in MAJOR currency units. 0 when unset. */
      lifetimeBudget: number;
      /** Parent campaign — used by the writer to look up the right CBO bucket. */
      campaignId: string;
    }
  >;
};

// --- Wire types -------------------------------------------------------------
// Narrowed shape of the fields we actually read from the /insights response.
type MetaActionEntry = { action_type: string; value: string };
type MetaInsightsRow = {
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  actions?: MetaActionEntry[];
  action_values?: MetaActionEntry[];
  account_currency?: string;
};
type MetaInsightsBody = {
  data?: MetaInsightsRow[];
  paging?: { next?: string };
};

// Ad-level rows additionally carry ad_id + ad_name. Other fields overlap
// with MetaInsightsRow, so we extend rather than duplicate.
type MetaInsightsAdRow = MetaInsightsRow & {
  ad_id?: string;
  ad_name?: string;
};
type MetaInsightsAdBody = {
  data?: MetaInsightsAdRow[];
  paging?: { next?: string };
};

// --- Env-var helpers --------------------------------------------------------
// Env var convention matches `docs/PROPS-MAP.md` (Phase 05.5-02 rows 26/33/39
// for per-store access tokens, rows 27/34/40 for ad account IDs):
//   `${STORE}_META_ACCESS_TOKEN` + `${STORE}_META_AD_ACCOUNT_ID`
// The original ordering (META_${STORE}_*) was a fetcher-side bug that caused
// live cron-live runs to fail with "Missing Meta access token" against
// properly-seeded Vercel env vars.
function getMetaToken(storeId: string): string {
  const upper = storeId.toUpperCase();
  // PROPS-MAP rows 26/33/39
  const perStore = process.env[`${upper}_META_ACCESS_TOKEN`];
  // Optional global fallback (not in PROPS-MAP, but kept for dev convenience)
  const global = process.env.META_GLOBAL_TOKEN;
  const token = perStore || global;
  if (!token) {
    throw new Error(
      `Missing Meta access token for ${storeId}. ` +
        `Set ${upper}_META_ACCESS_TOKEN (per docs/PROPS-MAP.md) or ` +
        `META_GLOBAL_TOKEN as a Vercel environment variable.`,
    );
  }
  return token;
}

function getMetaAdAccountId(storeId: string): string {
  const upper = storeId.toUpperCase();
  // PROPS-MAP rows 27/34/40
  const raw = process.env[`${upper}_META_AD_ACCOUNT_ID`] || '';
  // Strip a leading `act_` so the URL builder can always re-prepend it. This
  // mirrors MetaAds.gs:26 — operators sometimes paste the `act_` prefix from
  // the Meta UI and we want both forms to work.
  const stripped = raw.replace(/^act_/, '').trim();
  if (!stripped) {
    throw new Error(
      `Missing Meta ad account id for ${storeId}. ` +
        `Set ${upper}_META_AD_ACCOUNT_ID (per docs/PROPS-MAP.md; numeric, optionally with act_ prefix).`,
    );
  }
  return stripped;
}

/**
 * Pick a purchase metric value from the action arrays using the canonical
 * priority chain (MetaAds.gs:85-98). Exported for parity tests only — do not
 * call from production code; use `fetchMetaAdSetInsights` instead.
 */
function extractMetaPurchases(
  actions: MetaActionEntry[],
  values: MetaActionEntry[],
): { count: number; value: number } {
  // Priority chain — DO NOT reorder. omni_purchase first because it captures
  // offline conversions in addition to web/CAPI; purchase second because it
  // matches both the pixel and the server-side CAPI deduped events; the
  // legacy fb_pixel_purchase event last for accounts that have not migrated.
  // (Single line so the threat-T-S4 single-line grep gate in 05.6-04-PLAN
  // <verification> can verify all three strings in priority order.)
  // prettier-ignore
  const types = ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase'] as const;
  function pick(arr: MetaActionEntry[]): number {
    for (const t of types) {
      const found = arr.find((a) => a.action_type === t);
      if (found) return parseFloat(found.value) || 0;
    }
    return 0;
  }
  return { count: pick(actions), value: pick(values) };
}

// --- Public API -------------------------------------------------------------

/**
 * Fetch Meta /insights at `level=adset` for a single day. Returns one row per
 * ad set that was active OR received late-attributed conversions on that day.
 *
 * Throws on:
 *   - missing token / ad-account env vars (with storeId in the message)
 *   - non-200 HTTP response (with status + body for operator debugging)
 *
 * Pagination follows `body.paging.next` (Meta's cursor URL) and is capped at
 * 50 pages to bound runtime; the cap emits `console.warn` so the operator
 * sees it in the Inngest job log.
 */
export async function fetchMetaAdSetInsights(
  storeId: string,
  dateStr: string,
): Promise<MetaAdSetRow[]> {
  const token = getMetaToken(storeId);
  const adAccountId = getMetaAdAccountId(storeId);

  const fields = [
    'campaign_id',
    'campaign_name',
    'adset_id',
    'adset_name',
    'spend',
    'impressions',
    'clicks',
    'actions',
    'action_values',
    'account_currency',
  ].join(',');

  let url: string | null =
    `https://graph.facebook.com/${META_API_VERSION}/act_${adAccountId}/insights` +
    `?fields=${fields}` +
    `&time_range=${encodeURIComponent(
      JSON.stringify({ since: dateStr, until: dateStr }),
    )}` +
    `&level=adset` +
    `&limit=500` +
    `&access_token=${encodeURIComponent(token)}`;

  const out: MetaAdSetRow[] = [];
  let safety = 0;
  while (url && safety < 50) {
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Meta adsets ${storeId} ${dateStr} failed (${res.status}): ${body}`,
      );
    }
    const body = (await res.json()) as MetaInsightsBody;
    for (const r of body.data ?? []) {
      const spend = parseFloat(r.spend ?? '0') || 0;
      const impressions = parseInt(r.impressions ?? '0', 10) || 0;
      const conv = extractMetaPurchases(r.actions ?? [], r.action_values ?? []);
      // Drop rows that show no activity AND no late-attributed conversions.
      // Including conv.count in the check is critical — Meta routinely
      // attributes late purchases to already-paused ad sets; an earlier
      // version of this filter (without conv.count) dropped real revenue
      // (MetaAds.gs:51-56 comment).
      if (spend === 0 && impressions === 0 && conv.count === 0) continue;
      out.push({
        campaignId: r.campaign_id ?? '',
        campaignName: r.campaign_name ?? '',
        adSetId: r.adset_id ?? '',
        adSetName: r.adset_name ?? '',
        spend,
        currency: r.account_currency ?? 'ILS',
        impressions,
        clicks: parseInt(r.clicks ?? '0', 10) || 0,
        conversions: conv.count,
        conversionValue: conv.value,
      });
    }
    url = body.paging?.next ?? null;
    safety++;
  }
  if (safety >= 50 && url) {
    // Hit pagination cap. Surface as a warning so the operator sees it in
    // the Inngest run log; the cron retry will not paper over a real cap
    // (50 pages × 500 rows = 25k ad sets is far beyond any plausible single
    // account's day).
    console.warn(
      `Meta adsets ${storeId} ${dateStr}: hit pagination cap of 50 pages ` +
        `(${out.length} rows collected); data beyond may be missing.`,
    );
  }
  return out;
}

/**
 * Per-day store-level Meta spend aggregate.
 *
 * Implementation note: this could be served by a separate `level=account`
 * Meta API call (mirroring `getMetaSpend` in MetaAds.gs:100-133), but doing
 * so means TWO round-trips on the daily cron path — one for adsets and one
 * for the account total. Instead we sum the adset rows we already fetched,
 * which is what the daily cron writes anyway. Numerical equality with
 * `level=account` is guaranteed because Meta's account total IS the sum of
 * its ad-set spends.
 *
 * Returns `{ storeId, date, spend: 0, currency: 'ILS' }` when the account
 * has no active ad sets — matches MetaAds.gs:125-128 behavior.
 */
export async function fetchMetaSpendForDay(
  storeId: string,
  dateStr: string,
): Promise<MetaDailyStoreSpend> {
  const rows = await fetchMetaAdSetInsights(storeId, dateStr);
  const spend = rows.reduce((acc, r) => acc + r.spend, 0);
  const currency = rows[0]?.currency ?? 'ILS';
  return { storeId, date: dateStr, spend, currency };
}

/**
 * Phase 05.6.1 — fetch Meta /insights at `level=ad` for a single day.
 *
 * Mirrors `fetchMetaAdSetInsights` but at ad granularity. URL changes:
 *   - `level=ad` (was `level=adset`)
 *   - fields list adds `ad_id,ad_name`; keeps adset_id/adset_name/campaign_*
 *     so each ad-row can be JOIN'd back to its parent ad set without a
 *     second pass.
 *
 * Conversion priority chain: reuses `extractMetaPurchases` exactly — D-C4
 * algorithm parity demands the same omni_purchase → purchase → fb_pixel
 * priority at every aggregation level. A per-level fork would let one level
 * drift and silently disagree with another about the same ad's conversion
 * count.
 *
 * Empty-row filter: same threshold as the adset version (spend=0 AND
 * impressions=0 AND conversions=0). Late-attributed conversions on paused
 * ads are kept — Meta routinely attributes purchases to ads that were
 * paused days earlier via its attribution window.
 *
 * Spend conversion: `spendCad: null` in every returned row. Per-ad FX
 * conversion is intentionally deferred — see the MetaAdRow type docstring.
 *
 * Free-tier impact: this fetcher is called INSIDE the existing fetch-meta
 * step.run (parallel with fetchMetaAdSetInsights + fetchMetaSpendForDay),
 * so the cron-daily exec count stays at 6/run.
 */
export async function fetchMetaAdInsights(
  storeId: string,
  dateStr: string,
): Promise<MetaAdRow[]> {
  const token = getMetaToken(storeId);
  const adAccountId = getMetaAdAccountId(storeId);

  const fields = [
    'campaign_id',
    'campaign_name',
    'adset_id',
    'adset_name',
    'ad_id',
    'ad_name',
    'spend',
    'impressions',
    'clicks',
    'actions',
    'action_values',
    'account_currency',
  ].join(',');

  let url: string | null =
    `https://graph.facebook.com/${META_API_VERSION}/act_${adAccountId}/insights` +
    `?fields=${fields}` +
    `&time_range=${encodeURIComponent(
      JSON.stringify({ since: dateStr, until: dateStr }),
    )}` +
    `&level=ad` +
    `&limit=500` +
    `&access_token=${encodeURIComponent(token)}`;

  const out: MetaAdRow[] = [];
  let safety = 0;
  while (url && safety < 50) {
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Meta ads ${storeId} ${dateStr} failed (${res.status}): ${body}`,
      );
    }
    const body = (await res.json()) as MetaInsightsAdBody;
    for (const r of body.data ?? []) {
      const spend = parseFloat(r.spend ?? '0') || 0;
      const impressions = parseInt(r.impressions ?? '0', 10) || 0;
      const conv = extractMetaPurchases(r.actions ?? [], r.action_values ?? []);
      // Same activity filter as adset-level (MetaAds.gs:51-56 + meta.ts:229-234).
      if (spend === 0 && impressions === 0 && conv.count === 0) continue;
      out.push({
        storeId,
        date: dateStr,
        platform: 'meta',
        campaignId: r.campaign_id ?? '',
        campaignName: r.campaign_name ?? '',
        adSetId: r.adset_id ?? '',
        adSetName: r.adset_name ?? '',
        adId: r.ad_id ?? '',
        adName: r.ad_name ?? '',
        impressions,
        clicks: parseInt(r.clicks ?? '0', 10) || 0,
        conversions: conv.count,
        // 2026-05-21: expose raw account-currency values. The cronDaily.ts
        // writer fetches one FX rate per (store, date) and converts both
        // ad-set + ad-level rows together — one extra fetch per cron run,
        // not one per row, so the exec budget is preserved.
        spend,
        currency: r.account_currency ?? 'ILS',
        conversionValue: conv.value,
      });
    }
    url = body.paging?.next ?? null;
    safety++;
  }
  if (safety >= 50 && url) {
    console.warn(
      `Meta ads ${storeId} ${dateStr}: hit pagination cap of 50 pages ` +
        `(${out.length} rows collected); data beyond may be missing.`,
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Wire-row shapes for the campaigns + adsets + account endpoints used by
// `fetchMetaBudgets`. Separate from the /insights wire types above because
// these endpoints expose budget fields (not metrics), and the budget values
// come back as STRINGS in MINOR currency units (agorot for ILS, cents for
// USD). The `toMajor` helper inside `fetchMetaBudgets` performs the divide-
// by-100 conversion — see MetaAds.gs:205-208 for the canonical implementation.
// ---------------------------------------------------------------------------
type MetaCampaignWireRow = {
  id?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  bid_strategy?: string;
  status?: string;
  effective_status?: string;
};
type MetaAdSetWireRow = {
  id?: string;
  campaign_id?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  status?: string;
  effective_status?: string;
};
type MetaCampaignsBudgetsBody = {
  data?: MetaCampaignWireRow[];
  paging?: { next?: string };
};
type MetaAdSetsBudgetsBody = {
  data?: MetaAdSetWireRow[];
  paging?: { next?: string };
};

/**
 * Phase 05.7.2 — 1:1 port of `getMetaBudgets` in MetaAds.gs:157-289.
 *
 * Returns the campaign + ad-set daily / lifetime budgets, plus the ad
 * account's currency. The cron writer (`cronDaily.ts` Step 5c) uses this to
 * populate the `campaign_budget_cad`, `ad_set_budget_cad`, and `budget_type`
 * columns on `campaigns_daily`, which previously wrote null and made the
 * dashboard's campaigns tab unable to show budgets — a Sheets-side
 * regression at cut-over.
 *
 * Why a SEPARATE fetcher (not folded into /insights):
 *   Meta's /insights endpoint does NOT expose budgets. They live on the
 *   campaigns / adsets endpoints (not /insights), each with its own
 *   pagination loop. The Apps Script side calls them 1× per daily cron
 *   (MetaAds.gs:288); we match that frequency — one call per (store, day)
 *   inside the existing fetch-meta step.run, so the daily exec budget stays
 *   at 6 (no new step added).
 *
 * Three HTTP calls in this function:
 *   1. `GET /act_{id}?fields=currency` — account currency one-shot.
 *      Soft-failure (warns + falls back to ILS) per MetaAds.gs:174-203,
 *      because a partial budget map is much more useful than throwing.
 *   2. `GET /act_{id}/campaigns?fields=...` — paginated up to 50 pages.
 *   3. `GET /act_{id}/adsets?fields=...` — paginated up to 50 pages.
 *
 * Units: Meta returns budget values as STRINGS in MINOR currency units
 * (e.g. `"5000"` in an ILS account = ₪50.00). The `toMajor` helper
 * divides by 100 to convert to MAJOR units. The cron writer then runs
 * the result through `cadFor()` (same FX closure that already converts
 * spend + conversion_value) so the column lands in CAD on disk.
 *
 * Error handling: this fetcher must NEVER throw on a single page error
 * (mirrors MetaAds.gs:218-221 + 257-260). A partial budget map is far
 * more useful than a hard failure that breaks the whole cron run.
 * Operators see the warn() in the Inngest job log, and the unaffected
 * campaigns still get their budgets populated.
 */
export async function fetchMetaBudgets(storeId: string): Promise<MetaBudgets> {
  const token = getMetaToken(storeId);
  const adAccountId = getMetaAdAccountId(storeId);

  // ---- toMajor: minor → major unit conversion --------------------------
  // Meta returns budget values as STRINGS in MINOR units (agorot/cents)
  // — e.g. `"5000"` in an ILS account is ₪50.00. Direct port of
  // MetaAds.gs:205-208.
  function toMajor(rawStr: string | undefined): number {
    if (rawStr === undefined || rawStr === null || rawStr === '') return 0;
    const n = parseFloat(rawStr);
    return Number.isFinite(n) ? n / 100 : 0;
  }

  // ---- 1. account currency (one shot) ---------------------------------
  // Mirrors MetaAds.gs:172-203. A silent ILS fallback would multiply USD
  // budgets by the ILS→CAD rate (~0.36) instead of USD→CAD (~1.36) —
  // ~3.8x off. The Apps Script logs a loud warning on the fallback; we
  // do the same so the operator sees it in the Inngest run output.
  let currency = 'ILS';
  try {
    const acctUrl =
      `https://graph.facebook.com/${META_API_VERSION}/act_${adAccountId}` +
      `?fields=currency&access_token=${encodeURIComponent(token)}`;
    const acctRes = await fetch(acctUrl);
    if (acctRes.ok) {
      const acctBody = (await acctRes.json()) as { currency?: string };
      if (acctBody.currency) {
        currency = acctBody.currency;
      } else {
        console.warn(
          `Meta budgets ${storeId}: account currency fetch returned 200 ` +
            `but no currency field; defaulting to ILS. Non-ILS accounts ` +
            `will be mis-converted (~3-4x off).`,
        );
      }
    } else {
      const body = await acctRes.text();
      console.warn(
        `Meta budgets ${storeId}: account currency fetch failed ` +
          `(${acctRes.status}: ${body.slice(0, 200)}); defaulting to ILS.`,
      );
    }
  } catch (e) {
    // Network / DNS / abort — never throw out of currency fetch (parity
    // with MetaAds.gs:197-203 catch block).
    console.warn(
      `Meta budgets ${storeId}: account currency fetch threw: ` +
        `${(e as Error).message ?? String(e)}; defaulting to ILS.`,
    );
  }

  // ---- 2. campaigns (paginated) ---------------------------------------
  const campaigns: MetaBudgets['campaigns'] = {};
  let curl: string | null =
    `https://graph.facebook.com/${META_API_VERSION}/act_${adAccountId}/campaigns` +
    `?fields=id,daily_budget,lifetime_budget,bid_strategy,status,effective_status` +
    `&limit=500&access_token=${encodeURIComponent(token)}`;
  let safety = 0;
  while (curl && safety < 50) {
    const res = await fetch(curl);
    if (!res.ok) {
      const body = await res.text();
      // SOFT-FAIL per MetaAds.gs:218-221 — partial map > throw on a
      // transient page error. Log and bail out of the loop.
      console.warn(
        `Meta budgets ${storeId} campaigns failed (${res.status}): ` +
          `${body.slice(0, 200)}`,
      );
      break;
    }
    const body = (await res.json()) as MetaCampaignsBudgetsBody;
    for (const c of body.data ?? []) {
      if (!c.id) continue;
      campaigns[c.id] = {
        dailyBudget: toMajor(c.daily_budget),
        lifetimeBudget: toMajor(c.lifetime_budget),
        bidStrategy: c.bid_strategy || null,
      };
    }
    curl = body.paging?.next ?? null;
    safety++;
  }
  if (safety >= 50 && curl) {
    console.warn(
      `Meta budgets ${storeId}: hit pagination cap of 50 pages for campaigns ` +
        `(${Object.keys(campaigns).length} rows collected); some campaigns may be missing.`,
    );
  }

  // ---- 3. ad-sets (paginated) -----------------------------------------
  const adSets: MetaBudgets['adSets'] = {};
  let aurl: string | null =
    `https://graph.facebook.com/${META_API_VERSION}/act_${adAccountId}/adsets` +
    `?fields=id,campaign_id,daily_budget,lifetime_budget,status,effective_status` +
    `&limit=500&access_token=${encodeURIComponent(token)}`;
  safety = 0;
  while (aurl && safety < 50) {
    const res = await fetch(aurl);
    if (!res.ok) {
      const body = await res.text();
      console.warn(
        `Meta budgets ${storeId} adsets failed (${res.status}): ` +
          `${body.slice(0, 200)}`,
      );
      break;
    }
    const body = (await res.json()) as MetaAdSetsBudgetsBody;
    for (const a of body.data ?? []) {
      if (!a.id) continue;
      adSets[a.id] = {
        dailyBudget: toMajor(a.daily_budget),
        lifetimeBudget: toMajor(a.lifetime_budget),
        campaignId: a.campaign_id || '',
      };
    }
    aurl = body.paging?.next ?? null;
    safety++;
  }
  if (safety >= 50 && aurl) {
    console.warn(
      `Meta budgets ${storeId}: hit pagination cap of 50 pages for adsets ` +
        `(${Object.keys(adSets).length} rows collected); some ad-sets may be missing.`,
    );
  }

  return { currency, campaigns, adSets };
}
