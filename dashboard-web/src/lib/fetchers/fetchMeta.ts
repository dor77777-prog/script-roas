// dashboard-web/src/lib/fetchers/fetchMeta.ts
//
// Task 8 — Freshness Phase A
//
// Wraps fetchWithBackoff for Meta API calls:
//   - Parses response headers defensively across 3 documented shapes
//     (priority: x-business-use-case-usage > x-fb-ads-insights-throttle > x-app-usage)
//   - Records BUC usage to meta_buc_usage via recordMetaBucUsage (fire-and-forget)
//   - Throws MetaBudgetHighError when the relevant BUC >= 80%
//   - Sentry-warns if a 4th unknown shape appears (Phase A.6 follow-up trigger)
//
// DO NOT import Sentry via lib/sentry/capture.ts — that's for caught-in-cron-step
// errors. We call @sentry/nextjs directly here (low-level fetcher util).

import * as Sentry from '@sentry/nextjs';
import { fetchWithBackoff } from './withBackoff';
import { recordMetaBucUsage } from '@/lib/notifications/metaBucUsage';

// ---------------------------------------------------------------------------
// Constants + public error class
// ---------------------------------------------------------------------------

export const META_BUDGET_THRESHOLD_PCT = 80;

export class MetaBudgetHighError extends Error {
  constructor(public readonly pct: number) {
    super(`META_BUDGET_HIGH: relevant BUC reached ${pct}% (threshold ${META_BUDGET_THRESHOLD_PCT}%)`);
    this.name = 'MetaBudgetHighError';
  }
}

// ---------------------------------------------------------------------------
// Internal type
// ---------------------------------------------------------------------------

type BucSnapshot = {
  ads_insights_call_pct: number;
  ads_insights_cputime_pct: number;
  ads_insights_time_pct: number;
  ads_insights_eta_minutes: number;
  ads_management_call_pct: number;
  ads_management_cputime_pct: number;
  ads_management_time_pct: number;
  ads_management_eta_minutes: number;
};

// ---------------------------------------------------------------------------
// Exported helpers (reused in Phase A.5+ and testable in isolation)
// ---------------------------------------------------------------------------

/**
 * Parse the numeric ad account ID from a Meta Graph API URL.
 *
 * Patterns handled:
 *   https://graph.facebook.com/v25.0/act_123456789/insights?...  → '123456789'
 *   https://graph.facebook.com/v25.0/act_123456789/campaigns?... → '123456789'
 *   https://graph.facebook.com/v25.0/act_123456789?fields=...    → '123456789'
 *   URL without act_ pattern                                      → null
 */
export function extractAdAccountIdFromUrl(url: string): string | null {
  const match = url.match(/act_(\d+)/);
  return match ? match[1] : null;
}

/**
 * Given a numeric ad account ID, find which store it belongs to by checking
 * the ${STORE}_META_AD_ACCOUNT_ID env vars (stripping any `act_` prefix from both sides).
 *
 * Known stores: uzoshop, zolplus, usmile360 (matches cronDaily/cronLive/cronLiveHeavy).
 */
export function lookupStoreByAdAccount(accountId: string | null): string | null {
  if (!accountId) return null;
  const normalized = accountId.replace(/^act_/, '');
  for (const storeId of ['uzoshop', 'zolplus', 'usmile360']) {
    const envVal = process.env[`${storeId.toUpperCase()}_META_AD_ACCOUNT_ID`];
    if (envVal && envVal.replace(/^act_/, '').trim() === normalized) {
      return storeId;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Shape parsers (all return BucSnapshot; missing fields default to 0)
// ---------------------------------------------------------------------------

/**
 * Shape 2 — x-business-use-case-usage (preferred, per-BUC per-ad-account)
 *
 * JSON: { "<ad_account_id>": [ { "type": "ads_insights"|"ads_management", ... } ] }
 *
 * Throws if neither ads_insights nor ads_management type rows are present
 * (caller catches → Sentry warning).
 */
function parseBucShape(raw: string, _url: string): BucSnapshot {
  const obj = JSON.parse(raw) as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (!keys.length) {
    throw new Error('[parseBucShape] empty BUC object');
  }
  // Pick the first ad-account key (we record per-call; caller iterates if needed in Phase A.5+)
  const rows = obj[keys[0]] as Array<{
    type: string;
    call_count: number;
    total_cputime: number;
    total_time: number;
    estimated_time_to_regain_access: number;
  }>;
  if (!Array.isArray(rows)) {
    throw new Error('[parseBucShape] BUC value is not an array');
  }

  const insightsRow = rows.find(r => r.type === 'ads_insights');
  const managementRow = rows.find(r => r.type === 'ads_management');

  if (!insightsRow && !managementRow) {
    throw new Error('[parseBucShape] neither ads_insights nor ads_management row found');
  }

  return {
    ads_insights_call_pct: insightsRow?.call_count ?? 0,
    ads_insights_cputime_pct: insightsRow?.total_cputime ?? 0,
    ads_insights_time_pct: insightsRow?.total_time ?? 0,
    ads_insights_eta_minutes: insightsRow?.estimated_time_to_regain_access ?? 0,
    ads_management_call_pct: managementRow?.call_count ?? 0,
    ads_management_cputime_pct: managementRow?.total_cputime ?? 0,
    ads_management_time_pct: managementRow?.total_time ?? 0,
    ads_management_eta_minutes: managementRow?.estimated_time_to_regain_access ?? 0,
  };
}

/**
 * Shape 3 — x-fb-ads-insights-throttle (alternative for insights endpoint)
 *
 * JSON: { "app_id_util_pct": N, "acc_id_util_pct": N, "ads_api_access_tier": "..." }
 *
 * acc_id_util_pct maps conservatively to all three insights pct fields
 * (we don't know the breakdown, so we use the same value for all three).
 * All management fields = 0.
 */
function parseInsightsThrottleShape(raw: string): BucSnapshot {
  const obj = JSON.parse(raw) as { app_id_util_pct?: number; acc_id_util_pct?: number };
  const pct = obj.acc_id_util_pct ?? 0;
  return {
    ads_insights_call_pct: pct,
    ads_insights_cputime_pct: pct,
    ads_insights_time_pct: pct,
    ads_insights_eta_minutes: 0,
    ads_management_call_pct: 0,
    ads_management_cputime_pct: 0,
    ads_management_time_pct: 0,
    ads_management_eta_minutes: 0,
  };
}

/**
 * Shape 1 — x-app-usage (app-wide fallback)
 *
 * JSON: { "call_count": N, "total_time": N, "total_cputime": N }
 *
 * App-usage is app-wide so we don't know which pool is exhausted.
 * Conservative: write the same values to BOTH insights and management pools,
 * so the worker throttles on whichever URL is being called.
 */
function parseAppUsageShape(raw: string): BucSnapshot {
  const obj = JSON.parse(raw) as { call_count?: number; total_time?: number; total_cputime?: number };
  const callPct = obj.call_count ?? 0;
  const cputimePct = obj.total_cputime ?? 0;
  const timePct = obj.total_time ?? 0;
  return {
    ads_insights_call_pct: callPct,
    ads_insights_cputime_pct: cputimePct,
    ads_insights_time_pct: timePct,
    ads_insights_eta_minutes: 0,
    ads_management_call_pct: callPct,
    ads_management_cputime_pct: cputimePct,
    ads_management_time_pct: timePct,
    ads_management_eta_minutes: 0,
  };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * fetchMeta — wrapper around fetchWithBackoff for Meta Graph API calls.
 *
 * Reads usage headers, records BUC snapshot, and throws MetaBudgetHighError
 * when the relevant BUC (insights for /insights URLs, management otherwise) >= 80%.
 */
export async function fetchMeta(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetchWithBackoff(url, init, { provider: 'meta' });

  // Pick the highest-fidelity available shape.
  const bucRaw = res.headers.get('x-business-use-case-usage');
  const throttleRaw = res.headers.get('x-fb-ads-insights-throttle');
  const appUsageRaw = res.headers.get('x-app-usage');

  let snapshot: BucSnapshot | null = null;
  try {
    if (bucRaw) {
      snapshot = parseBucShape(bucRaw, url);
    } else if (throttleRaw) {
      snapshot = parseInsightsThrottleShape(throttleRaw);
    } else if (appUsageRaw) {
      snapshot = parseAppUsageShape(appUsageRaw);
    } else {
      // None of the 3 documented shapes present — alert for Phase A.6 follow-up.
      const allHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => { allHeaders[k] = v; });
      Sentry.captureMessage(
        '[fetchMeta] no known usage header present in Meta response',
        { level: 'warning', extra: { url: url.split('?')[0], headers: allHeaders } },
      );
    }
  } catch (e) {
    Sentry.captureMessage(
      '[fetchMeta] failed to parse usage header',
      { level: 'warning', extra: { url: url.split('?')[0], err: String(e), bucRaw, throttleRaw, appUsageRaw } },
    );
  }

  if (snapshot) {
    const accountId = extractAdAccountIdFromUrl(url);
    const storeId = lookupStoreByAdAccount(accountId);
    if (storeId && accountId) {
      void recordMetaBucUsage({
        store_id: storeId,
        ad_account_id: accountId,
        ads_insights_call_pct: snapshot.ads_insights_call_pct,
        ads_insights_cputime_pct: snapshot.ads_insights_cputime_pct,
        ads_insights_time_pct: snapshot.ads_insights_time_pct,
        ads_insights_eta_minutes: snapshot.ads_insights_eta_minutes,
        ads_management_call_pct: snapshot.ads_management_call_pct,
        ads_management_cputime_pct: snapshot.ads_management_cputime_pct,
        ads_management_time_pct: snapshot.ads_management_time_pct,
        ads_management_eta_minutes: snapshot.ads_management_eta_minutes,
        last_url: url.split('?')[0],
      });
    }

    // Relevance heuristic by URL pattern:
    //   /insights endpoints throttle on ads_insights pool
    //   everything else throttles on ads_management pool
    const relevantPct = url.includes('/insights')
      ? Math.max(snapshot.ads_insights_call_pct, snapshot.ads_insights_cputime_pct, snapshot.ads_insights_time_pct)
      : Math.max(snapshot.ads_management_call_pct, snapshot.ads_management_cputime_pct, snapshot.ads_management_time_pct);

    if (relevantPct >= META_BUDGET_THRESHOLD_PCT) {
      throw new MetaBudgetHighError(relevantPct);
    }
  }

  return res;
}
