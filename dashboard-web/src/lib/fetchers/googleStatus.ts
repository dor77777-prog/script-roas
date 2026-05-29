// dashboard-web/src/lib/fetchers/googleStatus.ts
//
// Phase C — Google Ads status discovery via change_status. Returns
// changed campaign/adgroup/ad ids + full status rows for each.

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
    const cs = (r as { change_status?: Record<string, unknown> }).change_status;
    if (!cs) continue;
    const type = cs.resource_type as string;
    const name = cs.resource_name as string;
    const id = name.split('/').pop();
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
      const ag = (r as { ad_group?: Record<string, unknown> }).ad_group;
      if (!ag) continue;
      adsets.push(toAdsetRow(storeId, ag));
    }
  }

  const ads: AdRegistryRow[] = [];
  if (adIds.size > 0) {
    const ids = [...adIds].map(id => `'${id}'`).join(',');
    const rows = await customer.searchStream({
      query: `SELECT ad_group_ad.ad.id, ad_group_ad.ad_group, ad_group_ad.status FROM ad_group_ad WHERE ad_group_ad.ad.id IN (${ids})`,
    });
    for (const r of rows) {
      const aga = (r as { ad_group_ad?: Record<string, unknown> }).ad_group_ad;
      if (!aga) continue;
      ads.push(toAdRow(storeId, aga));
    }
  }

  return { campaigns, adsets, ads };
}

function toCampaignRow(storeId: StoreId, c: Record<string, unknown>): CampaignRegistryRow {
  const configured = String(c.status ?? '');
  const effective = String(c.serving_status ?? '');
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
  const campaignName = ag.campaign as string ?? '';
  const campaignId = campaignName.split('/').pop() ?? '';
  return {
    ...toCampaignRow(storeId, { ...ag, id: campaignId }),
    campaign_id: campaignId,
    adset_id: String(ag.id),
    daily_budget_cad: null, lifetime_budget_cad: null,
  };
}

function toAdRow(storeId: StoreId, aga: Record<string, unknown>): AdRegistryRow {
  const adgroupName = aga.ad_group as string ?? '';
  const adgroupId = adgroupName.split('/').pop() ?? '';
  const adInner = aga.ad as Record<string, unknown> ?? {};
  return {
    ...toCampaignRow(storeId, aga),
    campaign_id: '',
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
