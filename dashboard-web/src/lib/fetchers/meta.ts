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

// --- Env-var helpers --------------------------------------------------------
function getMetaToken(storeId: string): string {
  // Per-store first (`META_UZOSHOP_TOKEN`), global fallback. Mirrors the
  // Apps Script convention (`{storeId}.meta.accessToken` ?? `meta.accessToken`)
  // and the PROPS-MAP destination column (RESEARCH §Pattern 3).
  const perStore = process.env[`META_${storeId.toUpperCase()}_TOKEN`];
  const global = process.env.META_GLOBAL_TOKEN;
  const token = perStore || global;
  if (!token) {
    throw new Error(
      `Missing Meta access token for ${storeId}. ` +
        `Set META_${storeId.toUpperCase()}_TOKEN (preferred) or META_GLOBAL_TOKEN ` +
        `as a Vercel environment variable.`,
    );
  }
  return token;
}

function getMetaAdAccountId(storeId: string): string {
  const raw = process.env[`META_${storeId.toUpperCase()}_AD_ACCOUNT_ID`] || '';
  // Strip a leading `act_` so the URL builder can always re-prepend it. This
  // mirrors MetaAds.gs:26 — operators sometimes paste the `act_` prefix from
  // the Meta UI and we want both forms to work.
  const stripped = raw.replace(/^act_/, '').trim();
  if (!stripped) {
    throw new Error(
      `Missing Meta ad account id for ${storeId}. ` +
        `Set META_${storeId.toUpperCase()}_AD_ACCOUNT_ID (numeric, optionally with act_ prefix).`,
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
