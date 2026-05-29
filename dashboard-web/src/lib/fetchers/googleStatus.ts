// dashboard-web/src/lib/fetchers/googleStatus.ts
//
// Phase C — Google Ads status discovery via change_status. Returns
// changed campaign/adgroup/ad ids + full status rows for each.
//
// CRIT-C note: GAQL queries themselves remain snake_case (GAQL is
// case-sensitive snake_case), but the Google Ads JSON API returns
// camelCase keys — see googleAds.ts:479-489 for the canonical shape:
//   r.changeStatus.resourceType / resourceName / lastChangeDateTime
//   r.adGroup, r.adGroupAd.ad, metrics.costMicros, metrics.conversionsValue
// Snake-case lookups silently return undefined → empty result sets.

import type {
  AdRegistryRow,
  AdsetRegistryRow,
  CampaignRegistryRow,
  StoreId,
} from '@/lib/registries/types';

type Customer = {
  searchStream: (input: { query: string }) => Promise<Array<Record<string, unknown>>>;
};

export type GoogleStatusInput = {
  storeId: StoreId;
  customer: Customer;
};

export type GoogleStatusResult = {
  campaigns: CampaignRegistryRow[];
  adsets: AdsetRegistryRow[];
  ads: AdRegistryRow[];
};

const NULL_PLACEHOLDER = '__will_be_overwritten_by_upsert_layer__';

export async function fetchGoogleStatusForStore(input: GoogleStatusInput): Promise<GoogleStatusResult> {
  const { storeId, customer } = input;

  // 1. Discover changed entities via change_status (last 24h).
  const changeRows = await customer.searchStream({
    query: `
      SELECT change_status.resource_name, change_status.resource_type, change_status.last_change_date_time
        FROM change_status
       WHERE change_status.last_change_date_time DURING LAST_24_HOURS
         AND change_status.resource_type IN ('CAMPAIGN', 'AD_GROUP', 'AD_GROUP_AD')
    `,
  });

  const campaignIds = new Set<string>();
  const adgroupIds = new Set<string>();
  const adIds = new Set<string>();
  for (const r of changeRows) {
    // CRIT-C: JSON response uses camelCase keys (changeStatus, resourceType,
    // resourceName). Snake-case here would silently return undefined.
    const cs = (r as { changeStatus?: Record<string, unknown> }).changeStatus;
    if (!cs) continue;
    const type = cs.resourceType as string;
    const name = cs.resourceName as string;
    const id = name?.split('/').pop();
    if (!id) continue;
    if (type === 'CAMPAIGN') campaignIds.add(id);
    if (type === 'AD_GROUP') adgroupIds.add(id);
    if (type === 'AD_GROUP_AD') adIds.add(id);
  }

  // 2. Follow up with full entity rows.
  const campaigns: CampaignRegistryRow[] = [];
  if (campaignIds.size > 0) {
    const ids = [...campaignIds].map(id => `'${id}'`).join(',');
    const rows = await customer.searchStream({
      query: `SELECT campaign.id, campaign.name, campaign.status, campaign.serving_status FROM campaign WHERE campaign.id IN (${ids})`,
    });
    for (const r of rows) {
      const c = (r as { campaign?: Record<string, unknown> }).campaign;
      if (!c) continue;
      campaigns.push(toCampaignRow(storeId, c));
    }
  }

  const adsets: AdsetRegistryRow[] = [];
  if (adgroupIds.size > 0) {
    const ids = [...adgroupIds].map(id => `'${id}'`).join(',');
    const rows = await customer.searchStream({
      query: `SELECT ad_group.id, ad_group.campaign, ad_group.name, ad_group.status FROM ad_group WHERE ad_group.id IN (${ids})`,
    });
    for (const r of rows) {
      // CRIT-C: JSON uses camelCase key `adGroup` even though GAQL uses
      // snake_case `ad_group`.
      const ag = (r as { adGroup?: Record<string, unknown> }).adGroup;
      if (!ag) continue;
      adsets.push(toAdsetRow(storeId, ag));
    }
  }

  const ads: AdRegistryRow[] = [];
  if (adIds.size > 0) {
    const ids = [...adIds].map(id => `'${id}'`).join(',');
    const rows = await customer.searchStream({
      // IMP-B: include campaign.id so the ad-row gets a non-empty
      // campaign_id (ad_registry.campaign_id is NOT NULL per Phase B).
      query: `SELECT campaign.id, ad_group_ad.ad.id, ad_group_ad.ad_group, ad_group_ad.status FROM ad_group_ad WHERE ad_group_ad.ad.id IN (${ids})`,
    });
    for (const r of rows) {
      // CRIT-C: JSON uses camelCase key `adGroupAd` even though GAQL uses
      // snake_case `ad_group_ad`. Same for the sibling `campaign` field.
      const aga = (r as { adGroupAd?: Record<string, unknown> }).adGroupAd;
      const camp = (r as { campaign?: Record<string, unknown> }).campaign;
      if (!aga) continue;
      ads.push(toAdRow(storeId, aga, camp));
    }
  }

  return { campaigns, adsets, ads };
}

function toCampaignRow(storeId: StoreId, c: Record<string, unknown>): CampaignRegistryRow {
  const configured = String(c.status ?? '');
  // CRIT-C: JSON returns `servingStatus` (camelCase) even though GAQL uses
  // snake_case `serving_status`.
  const effective = String(c.servingStatus ?? '');
  return {
    store_id: storeId, platform: 'google',
    campaign_id: String(c.id), name: c.name as string ?? null,
    configured_status: configured || null,
    effective_status: effective || null,
    delivery_status: deriveDelivery(effective),
    is_enabled: configured === 'ENABLED',
    is_serving: effective === 'SERVING',
    first_seen_at: NULL_PLACEHOLDER, last_seen_at: NULL_PLACEHOLDER,
    platform_updated_at: null, status_changed_at: null,
    last_metrics_success_at: null, last_status_success_at: null,
    raw_status_payload: c,
    missed_seen_count: 0, is_removed: false,
  };
}

function toAdsetRow(storeId: StoreId, ag: Record<string, unknown>): AdsetRegistryRow {
  const campaignResource = ag.campaign as string ?? '';
  const campaignId = campaignResource.split('/').pop() ?? '';
  const base = toCampaignRow(storeId, { ...ag, id: campaignId });
  // IMP-D: Google's ad_group resource does NOT expose a serving_status field
  // (only campaign-level does). Without an ad-group-level serving signal, we
  // derive is_serving from is_enabled (ad_group.status === 'ENABLED' is the
  // best proxy). Acknowledged limitation: a campaign-paused parent will not
  // pull the adgroup's is_serving down here — Phase C scope keeps it simple.
  const isEnabled = String(ag.status ?? '') === 'ENABLED';
  return {
    ...base,
    campaign_id: campaignId,
    adset_id: String(ag.id),
    is_serving: isEnabled,
    daily_budget_cad: null,
    lifetime_budget_cad: null,
  };
}

function toAdRow(
  storeId: StoreId,
  aga: Record<string, unknown>,
  camp: Record<string, unknown> | undefined,
): AdRegistryRow {
  // CRIT-C: JSON uses camelCase key `adGroup` for the resource name field
  // even though the GAQL select clause used `ad_group_ad.ad_group`.
  const adgroupResource = (aga.adGroup as string) ?? '';
  const adgroupId = adgroupResource.split('/').pop() ?? '';
  const adInner = aga.ad as Record<string, unknown> ?? {};
  // IMP-B: campaign_id is sourced from the sibling `campaign` field returned
  // by the same row (the GAQL query now includes `campaign.id`). Falls back
  // to '' only if the row genuinely lacks the field (should not happen with
  // the updated query).
  const campaignId = String((camp ?? {}).id ?? '');
  return {
    ...toCampaignRow(storeId, aga),
    campaign_id: campaignId,
    adset_id: adgroupId,
    ad_id: String(adInner.id ?? ''),
  };
}

function deriveDelivery(effective: string): string | null {
  if (effective === 'SERVING') return 'DELIVERING';
  if (effective === 'PENDING') return 'PENDING_REVIEW';
  if (effective === 'ENDED' || effective === 'NONE') return 'NOT_DELIVERING';
  if (!effective) return null;
  return 'UNKNOWN';
}
