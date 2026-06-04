/**
 * adsManagerLink — campaign-scoped Ads Manager deep link for an insight's
 * (unused-in-render but kept-for-consistency) `href` field.
 *
 * Extracted here so the three insight rules that need it — the recommendation
 * rules in `lib/insights.ts`, `detectCampaignDied`, and `detectAdFatigue` —
 * share ONE definition instead of byte-identical copies. This module imports
 * nothing from `lib/insights.ts`, so importing it from there creates no cycle.
 *
 * Meta + Google only. TikTok (and organic/shopify) have no stable
 * campaign-scoped public URL here, so they return null. The interactive
 * "פתח ב-Ads Manager" button in `InsightActions` builds its own account-aware
 * link via `buildAdsManagerLink`; this is the lighter, account-agnostic form.
 */
export function adsManagerLink(platform: string, campaignId: string): string | null {
  if (!campaignId) return null;
  if (platform === 'Meta') {
    return `https://business.facebook.com/adsmanager/manage/ads?selected_campaign_ids=${encodeURIComponent(campaignId)}`;
  }
  if (platform === 'Google') {
    return `https://ads.google.com/aw/campaigns?campaignId=${encodeURIComponent(campaignId)}`;
  }
  return null;
}
