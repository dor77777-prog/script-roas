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
  /**
   * Ad-level daily unique reach (people). Meta + TikTok populate it; Google
   * leaves it null (no per-user frequency on Search/Shopping/PMax). Drives the
   * creative-fatigue early-warning's frequency = impressions / reach.
   */
  reach?: number | null;
  /**
   * Phase D (2026-05-30) — registry-backed status fields. Joined server-side
   * via the `ads_enriched` VIEW. Will be null in production until Phase B/C
   * ad-level status workers populate `ad_registry` (none exist yet — the
   * registry is keys-only after the Phase D backfill). The fields are
   * provided so the UI can begin reading them ahead of the worker rollout.
   */
  regConfiguredStatus: string | null;
  regEffectiveStatus: string | null;
  regDeliveryStatus: string | null;
  regFirstSeenAt: string | null;
  regStatusChangedAt: string | null;
  regLastStatusSuccessAt: string | null;
};
