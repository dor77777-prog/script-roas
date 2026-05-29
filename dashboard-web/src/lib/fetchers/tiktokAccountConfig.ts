// dashboard-web/src/lib/fetchers/tiktokAccountConfig.ts
//
// Phase C — single-store-arg config helpers shared by the tiktok-worker
// (Task 10). Resolves the (advertiser_id, access_token, account_currency)
// trio needed by `fetchTikTokStatusForStore` + `fetchTikTokHotMetricsForStore`.
//
// Env-var convention mirrors `tiktok.ts:getTikTokCreds` so all TikTok
// callers (cronDaily, cronLive, tiktok-worker) resolve credentials
// identically. See docs/PROPS-MAP.md for the per-store env var names.
//
// Account currency comes from `fetchTikTokAdvertiserInfo` (tiktok.ts:225).
// That helper caches the result in-process — TikTok advertiser-currency
// is effectively immutable once set, so a process-lifetime cache is safe
// and saves an API hop on every worker invocation.
//
// FX adapter: TikTok's report endpoint returns spend in the
// advertiser-account currency (TikTok's `/advertiser/info/` returns one
// of USD/CAD/ILS for our 3 stores). The adapter routes 'USD' / 'ILS'
// through Frankfurter via `getFxRate`, matching the pattern used by
// `getFxCadAdapterForStore` in `metaAccountConfig.ts`.
//
// CRIT-E (TikTok parallel) — `fetchTikTokHotMetricsForStore` requires
// `accountCurrency` per call so non-USD TikTok accounts don't get
// silently inflated to CAD. The worker resolves this once via the
// advertiser-info lookup and passes it into the fetcher.
//
// Discovery note on the TikTok-token rotate-on-the-fly story: unlike
// Google Ads (refresh tokens + short-lived access tokens), TikTok
// issues a long-lived advertiser-bound `access_token` that is
// effectively static until the operator re-runs the OAuth handshake.
// No per-call refresh is needed — env-var read at construction is
// sufficient.

import {
  fetchTikTokAdvertiserInfo,
  type TikTokAdvertiserInfo,
} from './tiktok';
import { getFxRate } from './fx';
import type { StoreId } from '@/lib/registries/types';

export type TikTokAccountConfig = {
  advertiserId: string;
  accessToken: string;
  accountCurrency: 'USD' | 'CAD' | 'ILS';
};

function readTikTokCredsFromEnv(storeId: StoreId): {
  advertiserId: string;
  accessToken: string;
} {
  const upper = storeId.toUpperCase();
  const advertiserId = process.env[`${upper}_TIKTOK_ADVERTISER_ID`];
  const accessToken = process.env[`${upper}_TIKTOK_ACCESS_TOKEN`];
  const missing: string[] = [];
  if (!advertiserId) missing.push(`${upper}_TIKTOK_ADVERTISER_ID`);
  if (!accessToken) missing.push(`${upper}_TIKTOK_ACCESS_TOKEN`);
  if (missing.length) {
    throw new Error(
      `Missing TikTok creds for store "${storeId}": ${missing.join(', ')} ` +
        `(per docs/PROPS-MAP.md — set as Vercel env vars).`,
    );
  }
  return { advertiserId: advertiserId!, accessToken: accessToken! };
}

function normalizeCurrency(raw: string): 'USD' | 'CAD' | 'ILS' {
  const upper = raw.toUpperCase();
  if (upper === 'USD' || upper === 'CAD' || upper === 'ILS') return upper;
  // Unknown currency — fall back to USD (the most common TikTok account
  // currency, matches `fetchTikTokAdvertiserInfo` default at tiktok.ts:265).
  // The caller's FX adapter will still convert correctly; the worst case
  // is a CAD-account being treated as USD and getting a 1.36x bump. Logged
  // so operator notices.
  console.warn(
    `[tiktokAccountConfig] Unknown TikTok account currency "${raw}" — ` +
      `falling back to USD. Add the currency code to the type union if it's legitimate.`,
  );
  return 'USD';
}

/**
 * Resolve the full (advertiser_id, access_token, account_currency) trio
 * for the tiktok-worker. Throws on missing env vars — Inngest treats
 * thrown errors as retryable; the next successful invocation writes a
 * data_freshness=success row.
 */
export async function getTikTokAccountForStore(
  storeId: StoreId,
): Promise<TikTokAccountConfig> {
  const { advertiserId, accessToken } = readTikTokCredsFromEnv(storeId);
  const info: TikTokAdvertiserInfo = await fetchTikTokAdvertiserInfo(storeId);
  return {
    advertiserId,
    accessToken,
    accountCurrency: normalizeCurrency(info.currency),
  };
}

/**
 * FX adapter mirroring `getFxCadAdapterForStore` in metaAccountConfig.ts.
 * Uses today's Frankfurter rate; `'CAD'` is identity. Returns 0 on
 * Frankfurter error so a transient outage doesn't block the worker — the
 * resulting row records spend_cad=0 which the operator panel can flag.
 */
export async function getTikTokFxCadAdapterForStore(
  _storeId: StoreId,
): Promise<(amount: number, currency: 'USD' | 'CAD' | 'ILS') => Promise<number>> {
  const dateStr = new Date().toISOString().slice(0, 10);
  return async (amount, currency) => {
    if (currency === 'CAD') return amount;
    try {
      const rate = await getFxRate(currency, 'CAD', dateStr);
      if (!Number.isFinite(rate) || rate <= 0) return 0;
      return amount * rate;
    } catch {
      return 0;
    }
  };
}
