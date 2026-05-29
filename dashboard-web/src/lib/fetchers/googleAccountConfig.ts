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
// captures the per-store customerId + access token so callers can fire
// multiple queries without re-resolving credentials each time.
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

export type GoogleCustomer = {
  searchStream: (input: { query: string }) => Promise<Array<Record<string, unknown>>>;
};

export async function getGoogleCustomerForStore(storeId: string): Promise<GoogleCustomer> {
  const customerId = getCustomerIdOrThrow(storeId);
  const accessToken = await getAccessToken(storeId);
  return {
    searchStream: async ({ query }: { query: string }) => {
      const today = new Date().toISOString().slice(0, 10);
      return runGaqlQuery(storeId, customerId, accessToken, query, today);
    },
  };
}
