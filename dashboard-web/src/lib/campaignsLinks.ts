/**
 * Ads Manager deep-link helpers. Lives in its own file so client components
 * can import it without pulling in lib/campaigns.ts, which depends on the
 * googleapis package (server-only).
 */

/**
 * Map of storeId → platform ad-account IDs, used to build deep links into
 * each platform's Ads Manager. The map is built on the client from the
 * `/api/store-meta` response (which Apps Script publishes from Script
 * Properties). null on either field means the store doesn't have that
 * platform configured.
 */
export type AdAccountMap = Record<
  string,
  { metaAdAccountId: string | null; googleAdsCustomerId: string | null }
>;

/**
 * Build a deep link to the right Ads Manager UI for a campaign / ad-set.
 *
 * The key insight: without an explicit account ID in the URL, both Meta and
 * Google Ads open whichever account the user was last viewing — not the
 * account that actually owns the campaign. The user lands on a "campaign not
 * found in this account" view. Including `act=<metaId>` (Meta) or
 * `__c=<customerId>` (Google) forces the right account to load first.
 *
 * Returns null if the platform isn't supported OR if the account ID for the
 * store isn't configured yet (we'd rather hide the link than send the user
 * to the wrong account).
 */
export function buildAdsManagerLink(opts: {
  platform: string;
  storeId: string;
  campaignId: string;
  adSetId?: string;
  accounts: AdAccountMap;
}): string | null {
  const { platform, storeId, campaignId, adSetId, accounts } = opts;
  if (!campaignId) return null;
  const acct = accounts[storeId];

  if (platform === 'Meta') {
    const metaId = acct?.metaAdAccountId;
    if (!metaId) return null;
    // When we know the ad-set, drill straight to the ad-sets view filtered to
    // that ad-set. Otherwise drill to the campaign's ad-sets view (one level
    // deep is usually more useful than the campaigns list).
    const params = new URLSearchParams();
    params.set('act', metaId);
    params.set('selected_campaign_ids', campaignId);
    if (adSetId) {
      params.set('selected_adset_ids', adSetId);
      return `https://business.facebook.com/adsmanager/manage/adsets?${params.toString()}`;
    }
    return `https://business.facebook.com/adsmanager/manage/adsets?${params.toString()}`;
  }

  if (platform === 'Google') {
    const customerId = acct?.googleAdsCustomerId;
    if (!customerId) return null;
    // Google Ads URLs use `__c=<customerId>` to select the account. Drill to
    // the campaign's ad-groups view if we have a specific campaign; ad-set
    // ID isn't meaningful on Google's side (no equivalent UI in the URL).
    const params = new URLSearchParams();
    params.set('__c', customerId);
    params.set('campaignId', campaignId);
    if (adSetId) {
      params.set('adGroupId', adSetId);
      return `https://ads.google.com/aw/ads?${params.toString()}`;
    }
    return `https://ads.google.com/aw/adgroups?${params.toString()}`;
  }

  return null;
}
