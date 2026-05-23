/**
 * Shared per-platform configuration sets.
 *
 * Created 2026-05-24 (AUDIT U-01) to break the writer↔reader asymmetry
 * on TikTok's "active enough to enroll a placeholder row" set:
 *
 *   - WRITER: `cronLive.ts:isActiveForPlatform` decides whether to UPSERT
 *     a today-placeholder row in campaigns_daily for a TikTok ad-group
 *     whose `effective_status` falls outside the spend/impression set.
 *
 *   - READER: `postgresReaders.ts` (inside `readCampaignsDailyRows`)
 *     decides whether to surface a row that has zero activity but a
 *     "currently delivering" status to the dashboard.
 *
 * Pre-fix the two helpers each had their own inline literal:
 *
 *   - cronLive.ts:243 had a 5-status `TIKTOK_ACTIVE_ENOUGH` set.
 *   - postgresReaders.ts:608 had a 1-status check
 *     (`statusNorm === 'ADGROUP_STATUS_DELIVERY_OK'`).
 *
 * Effect: an ad-group in BUDGET_EXCEED (paused TODAY due to daily cap,
 * resumes tomorrow) would be UPSERTed as "active" by the writer but
 * silently dropped by the reader because `hasActivity=false` and the
 * reader only recognised DELIVERY_OK. Operator saw the row disappear
 * from the dashboard mid-day even though TikTok Ads Manager still
 * painted it as Active.
 *
 * Both sides now import `TIKTOK_ACTIVE_ENOUGH` from this module — one
 * source of truth, no drift possible.
 *
 * Source: TikTok Business API `/adgroup/get/` `operation_status` field.
 * https://business-api.tiktok.com/portal/docs?id=1739561631127553
 *
 * The "off" half of the TikTok taxonomy (DISABLE / TIMEDOUT / FROZEN /
 * ARCHIVED / DELETE) lives in `CampaignsTableRow.tsx` because it's
 * needed for the row chip's off-coloring; the writer/reader pair only
 * needs the active half (anything outside the active set falls through
 * to "not delivering" → not enrolled / not surfaced).
 */
export const TIKTOK_ACTIVE_ENOUGH: ReadonlySet<string> = new Set([
  'ADGROUP_STATUS_DELIVERY_OK',
  'ADGROUP_STATUS_BUDGET_EXCEED',
  'ADGROUP_STATUS_AUDIT',
  'ADGROUP_STATUS_REVIEWING',
  'ADGROUP_STATUS_NOT_START',
]);
