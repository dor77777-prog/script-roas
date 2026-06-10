// dashboard-web/src/lib/fetchers/metaAccountConfig.ts
//
// Phase B — single-store-arg config helpers shared by the meta-worker
// (Task 9) and any future caller that needs the same (token, ad-account,
// FX) trio. Keeps the env-var read pattern in one place — must match
// `meta.ts:getMetaToken` + `getMetaAdAccountId` exactly so all Meta
// callers resolve credentials the same way. See docs/PROPS-MAP.md for the
// per-store env var names (rows 26/33/39 + 27/34/40).
//
// FX adapter: ad-set budgets in metaStatus.ts are already CAD-native for
// the 3 current stores (Meta returns the account-currency raw amount).
// The adapter returns the amount untouched for 'CAD' and routes 'USD' /
// 'ILS' through Frankfurter via `getFxRate`, matching the pattern used by
// cronLiveHeavy's makeFxForDate closure. Today's date is used for the
// look-up because the status worker reports the live (current-moment)
// budget configuration, not a historical day's budget.

import { getFxRate } from '@/lib/fetchers/fx';
import { notifyFxFailure } from '@/lib/notifications/fxFailure';
import { getStoreSecret, getGlobalSecret } from '@/lib/storeSecretsReader';
import type { StoreId } from '@/lib/registries/types';

export async function getAdAccountIdForStore(storeId: StoreId): Promise<string> {
  const upper = storeId.toUpperCase();
  const raw = (await getStoreSecret(storeId, 'META_AD_ACCOUNT_ID')) ?? '';
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
 * Self-serve stores Phase 6a (MF-1) — DB-aware "is Meta configured for this
 * store?" gate. Returns true iff the per-store META_AD_ACCOUNT_ID resolves via
 * `getStoreSecret` (DB→env→null dual-read), falling back to the env check when
 * the DB read yields nothing. Mirrors `isGoogleConfiguredForStoreAsync`
 * (googleAccountConfig.ts) + `isTikTokConfiguredForStoreAsync`
 * (tiktokAccountConfig.ts) exactly: NEVER throws, fails OPEN to env so a DB
 * blip can't wrongly skip a configured store.
 *
 * Why this exists: a self-serve store added WITHOUT Meta (a supported wizard
 * option — the create-store POST writes Meta secrets only `if (meta)` and never
 * inserts a meta `store_ad_state` row) has no META_AD_ACCOUNT_ID. The
 * cron-tick-orchestrator naively fans out a `meta/job.requested` for every
 * (store, platform, scope) combo, so `metaWorker`'s status branch would resolve
 * empty creds and drive an unguarded Graph batch with an empty access_token →
 * `metaStatus.ts` throws → Inngest retries/fails EVERY 10-min tick and Meta
 * freshness is never green. With this gate the worker no-ops + records a
 * `success` freshness row instead of crash-looping.
 *
 * Scope is intentionally narrow (per-store ad-account id only) to match the
 * Google/TikTok gates. The global META_GLOBAL_TOKEN is a shared concern
 * surfaced by the worker's real-fetch path, not this configured-gate.
 *
 * INERT for the 3 current stores: each has its META_AD_ACCOUNT_ID in env →
 * getStoreSecret's env fallback returns it → gate true → full fetch path
 * unchanged (byte-identical behaviour). The DB-aware path only matters once
 * Phase 6 can add a Meta-less or DB-only-cred store.
 */
export async function isMetaConfiguredForStoreAsync(storeId: StoreId): Promise<boolean> {
  const raw = (await getStoreSecret(storeId, 'META_AD_ACCOUNT_ID')) ?? '';
  // Mirror getAdAccountIdForStore's emptiness check: strip the optional act_
  // prefix + trim so a stray "act_" or whitespace-only value reads as missing.
  const stripped = raw.replace(/^act_/, '').trim();
  return Boolean(stripped);
}

export async function getMetaAccessTokenForStore(storeId: StoreId): Promise<string> {
  const upper = storeId.toUpperCase();
  const perStore = await getStoreSecret(storeId, 'META_ACCESS_TOKEN');
  const token = perStore || (await getGlobalSecret('META_GLOBAL_TOKEN'));
  if (!token) {
    throw new Error(
      `Missing Meta access token for ${storeId}. ` +
        `Set ${upper}_META_ACCESS_TOKEN (per docs/PROPS-MAP.md) or ` +
        `META_GLOBAL_TOKEN as a Vercel environment variable.`,
    );
  }
  return token;
}

/**
 * Returns an FX adapter that converts an arbitrary `(amount, currency)` to CAD
 * using today's Frankfurter rate. `'CAD'` is identity. Used by
 * `fetchMetaStatusForStore` to normalize ad-set `daily_budget` / `lifetime_budget`
 * into the CAD-denominated registry columns and by the hot-metrics fetcher for
 * spend / conversion-value conversion.
 *
 * P1-11 (2026-06-10) — FX doctrine: on Frankfurter failure the adapter returns
 * `null` (NOT 0). Callers must OMIT the `*_cad` keys from their upsert payloads
 * when the conversion is null so Supabase ON CONFLICT preserves the last good
 * value. The previous `return 0` contract made every 10-min hot-metrics tick
 * overwrite real intraday spend with $0 during an FX outage — fake blue-band
 * ROAS until cron-daily repaired it. The throttled notifyFxFailure alert (DQ-2)
 * is preserved.
 *
 * The per-currency result (rate OR null failure sentinel) is cached inside the
 * adapter closure so (a) one worker invocation produces a CONSISTENT
 * null-vs-number answer for every row of the same currency (heterogeneous
 * upsert batches would fail PostgREST's uniform-keys rule), and (b) a flapping
 * Frankfurter isn't hammered once per row. Mirrors cronDaily's `fxCache`.
 */
export async function getFxCadAdapterForStore(
  _storeId: StoreId,
): Promise<(amount: number, currency: 'USD' | 'CAD' | 'ILS') => Promise<number | null>> {
  const dateStr = new Date().toISOString().slice(0, 10);
  const rateCache = new Map<string, number | null>();
  return async (amount, currency) => {
    if (currency === 'CAD') return amount;
    let rate = rateCache.get(currency);
    if (rate === undefined) {
      try {
        const fetched = await getFxRate(currency, 'CAD', dateStr);
        if (!Number.isFinite(fetched) || fetched <= 0) {
          // DQ-2: alert instead of silently corrupting CAD spend.
          await notifyFxFailure({ currency, dateStr, errorMsg: `invalid rate ${fetched}` });
          rate = null;
        } else {
          rate = fetched;
        }
      } catch (e) {
        await notifyFxFailure({ currency, dateStr, errorMsg: e instanceof Error ? e.message : String(e) });
        rate = null;
      }
      rateCache.set(currency, rate);
    }
    if (rate === null) return null;
    return amount * rate;
  };
}
