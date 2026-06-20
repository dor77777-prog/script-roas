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
import { notifyFxFailure } from '@/lib/notifications/fxFailure';
import type { StoreId } from '@/lib/registries/types';
import { getStoreSecret } from '@/lib/storeSecretsReader';
import { getTodayInIsraelTz } from '@/lib/dateRange';

export type TikTokAccountConfig = {
  advertiserId: string;
  accessToken: string;
  accountCurrency: 'USD' | 'CAD' | 'ILS';
};

async function readTikTokCredsFromEnv(storeId: StoreId): Promise<{
  advertiserId: string;
  accessToken: string;
}> {
  const upper = storeId.toUpperCase();
  // Phase 3B (Task 8): per-store DB→env dual-read via getStoreSecret. The
  // ${UPPER}_TIKTOK_* env fallback lives inside getStoreSecret, so the throw
  // string is byte-identical to the env-only version. (Name retained for
  // call-site stability even though the source is now DB-first.)
  const advertiserId = await getStoreSecret(storeId, 'TIKTOK_ADVERTISER_ID');
  const accessToken = await getStoreSecret(storeId, 'TIKTOK_ACCESS_TOKEN');
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

/**
 * Phase C soak fix (2026-05-30): returns true iff the per-store TikTok env
 * vars are set. Used by `tiktokWorker` to no-op + record `success` freshness
 * for stores that don't have their own TikTok ad account (per
 * ARCHITECTURE.md §5.4: only uzoshop has an active TikTok account today;
 * usmile360 + zolplus are "tenants" served by Phase A.5 v2's
 * campaign-store-map attribution from uzoshop's worker).
 *
 * Without this gate, every tick the worker for usmile360/zolplus called
 * `safeAccount` → `readTikTokCredsFromEnv` → threw, leaving status
 * freshness empty and producing repeated Inngest function-run failures.
 */
export function isTikTokConfiguredForStore(storeId: StoreId): boolean {
  const upper = storeId.toUpperCase();
  // Phase 3B (Task 8 / Decision 7): this SYNC boolean gate STAYS env-based on
  // purpose. getStoreSecret is async (DB round-trip) and this gate is called on
  // a hot sync path in tiktokWorker to no-op tenant stores. Converting it to a
  // DB read here is a Phase-4/6 follow-up (make the gate async + cut over).
  return (
    Boolean(process.env[`${upper}_TIKTOK_ADVERTISER_ID`]) &&
    Boolean(process.env[`${upper}_TIKTOK_ACCESS_TOKEN`])
  );
}

/**
 * Self-serve stores Phase 4b (Task 6) — DB-aware variant of
 * `isTikTokConfiguredForStore`. Returns true iff the full TikTok cred pair
 * (TIKTOK_ADVERTISER_ID + TIKTOK_ACCESS_TOKEN) resolves via `getStoreSecret`
 * (DB→env→null dual-read), falling back to the sync env check when the DB read
 * yields nothing. This mirrors how `getTikTokCreds` (tiktok.ts) +
 * `readTikTokCredsFromEnv` (above) resolve the same two keys.
 *
 * Why: a future Phase-6 store whose creds live ONLY in `store_secrets` (NOT
 * env) would make the SYNC gate return false → the worker skips ALL work AND
 * records data_freshness='success' → a silent green panel with zero data. The
 * async gate closes that hole. INERT today: env creds present → getStoreSecret's
 * env fallback returns the same value → SAME boolean as the sync gate.
 *
 * Shared-account model (TIKTOK_SHARED_STORES = uzoshop + usmile360, ONE
 * advertiser account): keyed PER-STORE via getStoreSecret, matching the
 * existing per-store cred resolution. The shared-account architecture is
 * unchanged — today only uzoshop has the env pair, so usmile360 + zolplus
 * still resolve false here and the account-level `tiktokAccountFetchEnabled`
 * gate + Phase A.5 v2 campaign-store-map keep serving tenant rows from
 * uzoshop's worker. A DB-only tenant (Phase 6) whose pair resolves in
 * store_secrets becomes configured without breaking that model.
 */
export async function isTikTokConfiguredForStoreAsync(
  storeId: StoreId,
): Promise<boolean> {
  const advertiserId = await getStoreSecret(storeId, 'TIKTOK_ADVERTISER_ID');
  const accessToken = await getStoreSecret(storeId, 'TIKTOK_ACCESS_TOKEN');
  if (advertiserId && accessToken) return true;
  // getStoreSecret already folds the env fallback in, so reaching here means
  // neither DB nor env had BOTH keys. Defer to the sync env check for a
  // byte-identical "is the env pair present?" answer (keeps the two gates in
  // lock-step on env-only stores).
  return isTikTokConfiguredForStore(storeId);
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
  const { advertiserId, accessToken } = await readTikTokCredsFromEnv(storeId);
  const info: TikTokAdvertiserInfo = await fetchTikTokAdvertiserInfo(storeId);
  return {
    advertiserId,
    accessToken,
    accountCurrency: normalizeCurrency(info.currency),
  };
}

/**
 * FX adapter mirroring `getFxCadAdapterForStore` in metaAccountConfig.ts.
 * Uses today's Frankfurter rate; `'CAD'` is identity.
 *
 * P1-11 (2026-06-10) — FX doctrine: returns `null` (NOT 0) on Frankfurter
 * failure. Callers OMIT the `*_cad` keys from the upsert payload when the
 * conversion is null so ON CONFLICT preserves the last good value, instead of
 * overwriting real intraday spend with $0 every 10-min tick. The throttled
 * notifyFxFailure alert (DQ-2) is preserved.
 *
 * 2026-06-11 (adversarial review, fx-pipeline MEDIUM) — caches the per-currency
 * IN-FLIGHT Promise (not the resolved value) so concurrent callers all await
 * the SAME promise: exactly ONE getFxRate call + ONE alert per currency, and
 * every row of one upsert batch gets an identical null-vs-number answer
 * (batch-uniform *_cad keys; PostgREST bulk upserts reject mixed key sets).
 * tiktokHotMetrics builds rows sequentially today, so the old check-then-act
 * value cache happened to be safe here — this mirrors metaAccountConfig.ts so
 * the guarantee survives a future Promise.all refactor.
 */
export async function getTikTokFxCadAdapterForStore(
  _storeId: StoreId,
  /**
   * FIX C (#19) — the IL business date the worker writes rows under (mirrors
   * getFxCadAdapterForStore). Use the row's IL date for the FX lookup, NOT the
   * UTC date, which is one day behind in the 00:00-03:00 IL window. Defaults to
   * "now" in IL for back-compat with callers that omit it.
   */
  dateStr: string = getTodayInIsraelTz(),
): Promise<(amount: number, currency: 'USD' | 'CAD' | 'ILS') => Promise<number | null>> {
  const ratePromiseCache = new Map<string, Promise<number | null>>();
  // Never rejects — failures resolve to the null sentinel (P1-11 contract),
  // so a cached promise can be awaited by any number of rows safely.
  const resolveRate = async (currency: string): Promise<number | null> => {
    try {
      const fetched = await getFxRate(currency, 'CAD', dateStr);
      if (!Number.isFinite(fetched) || fetched <= 0) {
        // DQ-2: alert instead of silently corrupting CAD spend.
        await notifyFxFailure({ currency, dateStr, errorMsg: `invalid rate ${fetched}` });
        return null;
      }
      return fetched;
    } catch (e) {
      await notifyFxFailure({ currency, dateStr, errorMsg: e instanceof Error ? e.message : String(e) });
      return null;
    }
  };
  return async (amount, currency) => {
    if (currency === 'CAD') return amount;
    let ratePromise = ratePromiseCache.get(currency);
    if (ratePromise === undefined) {
      // Populated SYNCHRONOUSLY (no await between get and set) so concurrent
      // callers in the same microtask turn share this single promise.
      ratePromise = resolveRate(currency);
      ratePromiseCache.set(currency, ratePromise);
    }
    const rate = await ratePromise;
    if (rate === null) return null;
    return amount * rate;
  };
}
