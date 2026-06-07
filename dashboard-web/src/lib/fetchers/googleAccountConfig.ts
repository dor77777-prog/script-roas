// dashboard-web/src/lib/fetchers/googleAccountConfig.ts
//
// Phase C — adapter that builds a minimal `customer` shape compatible
// with the Phase C Google fetchers (`googleStatus.ts`, `googleHotMetrics.ts`).
//
// The Phase C fetchers expect:
//
//   type Customer = {
//     searchStream: (input: { query: string }) => Promise<Array<Record<string, unknown>>>;
//   };
//
// We don't introduce a new HTTP client — we reuse the existing
// `runGaqlQuery` + OAuth-refresh helpers in `googleAds.ts`. The closure
// captures the per-store customerId so callers can fire multiple queries
// without re-resolving the customer-id env lookup each time.
//
// Token staleness — fetchGoogleStatusForStore can make up to 4 sequential
// GAQL calls (change_status discovery + per-type entity follow-up). If we
// captured `accessToken` once at construction time, a token resolved at
// minute 0 could age out by minute 8 even though `getAccessToken` would
// otherwise refresh from its module-level cache. By calling
// `getAccessToken(storeId)` INSIDE the `searchStream` closure we let the
// cache (60-second safety margin, see googleAds.ts:188-254) hand out a
// fresh token whenever the cached one is about to expire, at near-zero
// cost on warm hits (single Map lookup + Date.now compare). The customer-
// id env-var check stays at construction time so misconfigured stores
// throw early instead of after each searchStream call.
//
// Note on `dateStr`: `runGaqlQuery` only uses the dateStr param to
// decorate its error message ("...failed for ${storeId} ${dateStr}…").
// Passing today is fine — it just helps the operator narrow which day's
// run hit the error.

import {
  getAccessToken,
  getCustomerIdOrThrow,
  runGaqlQuery,
} from './googleAds';
import { getStoreSecret } from '@/lib/storeSecretsReader';

export type GoogleCustomer = {
  searchStream: (input: { query: string }) => Promise<Array<Record<string, unknown>>>;
};

export async function getGoogleCustomerForStore(storeId: string): Promise<GoogleCustomer> {
  // Env-var check at construction time — fail fast on misconfig rather
  // than after the first searchStream call.
  const customerId = await getCustomerIdOrThrow(storeId);
  return {
    searchStream: async ({ query }: { query: string }) => {
      // Re-ask per call: cache-aware (see googleAds.ts:195-254). Avoids
      // token staleness across the 4 sequential GAQL calls in the status
      // branch while remaining cheap on warm hits.
      const accessToken = await getAccessToken(storeId);
      const today = new Date().toISOString().slice(0, 10);
      return runGaqlQuery(storeId, customerId, accessToken, query, today);
    },
  };
}

/**
 * Phase C soak fix (2026-05-30): returns true iff the per-store Google Ads
 * customer-id env var is set. Used by `googleWorker` to no-op + record a
 * `success` freshness row for stores that don't have a Google Ads account
 * (e.g. usmile360 / zolplus when only uzoshop runs Google). Without this
 * check, the orchestrator's blanket fan-out fed those stores into a
 * `safeCustomer` call that always threw, leaving data_freshness empty.
 *
 * The check is intentionally narrow: it inspects only the per-store
 * customer id. OAuth client id/secret + refresh token are global concerns
 * shared by all configured stores; if they go missing the next REAL fetch
 * fails loud (via the new try/catch in the worker).
 *
 * Operator note (2026-05-30): the global `GOOGLEADS_REFRESH_TOKEN` was
 * rotated today via OAuth Playground after Google revoked the prior one
 * (Testing-mode 7-day TTL). Until the `roas-tracker-ga` consent screen is
 * published to Production, the operator must rotate the refresh token
 * every ~7 days or whenever a `invalid_grant` shows up in
 * `data_freshness.error_message` for the `google` platform. The new
 * try/catch in `googleWorker` surfaces this as `transient_error` rows
 * with the full Google response, so the trigger condition is visible in
 * the Operator Panel without digging into Inngest logs.
 */
export function isGoogleConfiguredForStore(storeId: string): boolean {
  const envVar = `${storeId.toUpperCase()}_GOOGLEADS_CUSTOMER_ID`;
  return Boolean(process.env[envVar]);
}

/**
 * Self-serve stores Phase 4b (Task 6) — DB-aware variant of
 * `isGoogleConfiguredForStore`. Returns true iff the per-store
 * GOOGLEADS_CUSTOMER_ID resolves via `getStoreSecret` (DB→env→null dual-read),
 * falling back to the sync env check when the DB read yields nothing. This
 * mirrors how `getCustomerIdOrThrow` (googleAds.ts) resolves the same key.
 *
 * Why: a future Phase-6 store whose customer id lives ONLY in `store_secrets`
 * (NOT env) would make the SYNC gate return false → the worker skips ALL work
 * AND records data_freshness='success' → a silent green panel with zero data.
 * The async gate closes that hole. INERT today: env creds present →
 * getStoreSecret's env fallback returns the same value → SAME boolean as the
 * sync gate (only uzoshop has the env var → unchanged for the 3 stores).
 *
 * Scope is intentionally narrow (per-store customer id only) to match the sync
 * gate; OAuth client id/secret + refresh token are global concerns surfaced by
 * the worker's real-fetch try/catch, not this configured-gate.
 */
export async function isGoogleConfiguredForStoreAsync(storeId: string): Promise<boolean> {
  const customerId = await getStoreSecret(storeId, 'GOOGLEADS_CUSTOMER_ID');
  if (customerId) return true;
  // getStoreSecret already folds the env fallback in; reaching here means
  // neither DB nor env had the key. Defer to the sync env check for a
  // byte-identical answer on env-only stores.
  return isGoogleConfiguredForStore(storeId);
}
