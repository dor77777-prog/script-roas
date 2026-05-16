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
 * account that actually owns the campaign. Including `act=<metaId>` (Meta)
 * or `__c=<customerId>` (Google) forces the right account to load first.
 *
 * Fallback behaviour when the account ID isn't configured yet (e.g. the user
 * hasn't run `refreshAllStoreMeta` in Apps Script): we still return a URL
 * — just without the account selector. That preserves the pre-fix behaviour
 * ("Ads Manager opens on whatever account you were last in") which is
 * suboptimal but strictly better than hiding the button entirely.
 *
 * Returns null only when the platform is unrecognised or campaignId is empty.
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
    const metaId = acct?.metaAdAccountId ?? null;
    const params = new URLSearchParams();
    if (metaId) params.set('act', metaId);
    params.set('selected_campaign_ids', campaignId);
    if (adSetId) {
      params.set('selected_adset_ids', adSetId);
    }
    // adsets view drills one level deeper than the campaigns list — usually
    // what the user wants when clicking through from a row.
    return `https://business.facebook.com/adsmanager/manage/adsets?${params.toString()}`;
  }

  if (platform === 'Google') {
    const customerId = acct?.googleAdsCustomerId ?? null;
    const params = new URLSearchParams();
    if (customerId) params.set('__c', customerId);
    params.set('campaignId', campaignId);
    if (adSetId) {
      params.set('adGroupId', adSetId);
      return `https://ads.google.com/aw/ads?${params.toString()}`;
    }
    return `https://ads.google.com/aw/adgroups?${params.toString()}`;
  }

  return null;
}

/**
 * True when we have the account ID and can build a deep link that opens the
 * right account. False when we're falling back to the account-less URL (which
 * still works but may land on the wrong account). UI can use this to render
 * a tooltip explaining why some clicks may land on the wrong account until
 * the user runs `refreshAllStoreMeta` once.
 */
export function hasAccountAwareLink(
  platform: string,
  storeId: string,
  accounts: AdAccountMap,
): boolean {
  const acct = accounts[storeId];
  if (!acct) return false;
  if (platform === 'Meta') return !!acct.metaAdAccountId;
  if (platform === 'Google') return !!acct.googleAdsCustomerId;
  return false;
}
