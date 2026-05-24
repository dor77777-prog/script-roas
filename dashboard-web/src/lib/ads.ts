/**
 * Type-only re-export contract preserved post-Phase-11 cutover (READ_FROM=postgres permanent).
 *
 * The Google Sheets reader (`fetchAdsData`) was deleted in Phase 12.4 as
 * dead-at-runtime code. The `AdRow` shape is still consumed by:
 *   - `/api/ads/route.ts` (typed response contract via `fetchAdsFromPostgres`)
 *   - `components/AdsDrawer.tsx`
 *
 * Authoritative reader: `lib/postgresReaders.fetchAdsFromPostgres`.
 */

export type AdRow = {
  date: string;
  storeId: string;
  storeName: string;
  platform: 'Meta' | 'Google' | string;
  campaignId: string;
  campaignName: string;
  adSetId: string;
  adSetName: string;
  adId: string;
  adName: string;
  spend: number;            // CAD
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;  // CAD
};
