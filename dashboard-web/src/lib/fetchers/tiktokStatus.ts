// dashboard-web/src/lib/fetchers/tiktokStatus.ts
//
// Phase C — TikTok status discovery via /campaign/get/, /adgroup/get/,
// /ad/get/. Each endpoint paginates with page=1..N. Per-row store_id is
// resolved via the campaign-store-map (Phase A.5) so multi-store
// advertisers attribute correctly.

import type {
  AdRegistryRow, AdsetRegistryRow, CampaignRegistryRow,
  StoreId,
} from '@/lib/registries/types';

const TT_BASE = 'https://business-api.tiktok.com/open_api/v1.3';
const NULL_PLACEHOLDER = '__will_be_overwritten_by_upsert_layer__';

// Safety cap mirrors `tiktok.ts:332` (TIKTOK_PAGINATION_CAP) — prevents
// a buggy/malicious `total_page` value from looping indefinitely. At
// page_size=1000 this still gives us up to 50k entities per endpoint
// before we soft-warn and break.
const TT_PAGINATION_CAP = 50;

export type TikTokStatusInput = {
  storeId: StoreId;
  advertiserId: string;
  accessToken: string;
  campaignStoreMap: Record<string, string>;
  fetcher?: typeof fetch;
};

export type TikTokStatusResult = {
  campaigns: CampaignRegistryRow[];
  adsets: AdsetRegistryRow[];
  ads: AdRegistryRow[];
};

export async function fetchTikTokStatusForStore(input: TikTokStatusInput): Promise<TikTokStatusResult> {
  const { storeId, advertiserId, accessToken, campaignStoreMap, fetcher = fetch } = input;

  const fetchAll = async (endpoint: string): Promise<Array<Record<string, unknown>>> => {
    const out: Array<Record<string, unknown>> = [];
    let page = 1;
    let totalPages = 1;
    while (page <= totalPages) {
      if (page > TT_PAGINATION_CAP) {
        console.warn(
          `TikTok ${endpoint} statuses ${storeId} (advertiser ${advertiserId}): ` +
            `hit pagination cap of ${TT_PAGINATION_CAP} pages — some rows may be missing.`,
        );
        break;
      }
      const url = `${TT_BASE}/${endpoint}/get/?advertiser_id=${advertiserId}&primary_status=STATUS_ALL&page=${page}&page_size=1000`;
      const res = await fetcher(url, { headers: { 'Access-Token': accessToken } });
      if (!res.ok) throw new Error(`TikTok ${endpoint} status ${res.status}: ${await res.text()}`);
      const body = await res.json() as { data?: { list?: unknown[]; page_info?: { total_page?: number } } };
      out.push(...((body.data?.list as Array<Record<string, unknown>>) ?? []));
      totalPages = body.data?.page_info?.total_page ?? 1;
      page++;
    }
    return out;
  };

  const [campaignRows, adgroupRows, adRows] = await Promise.all([
    fetchAll('campaign'),
    fetchAll('adgroup'),
    fetchAll('ad'),
  ]);

  const resolveStore = (campaignId: string): StoreId => {
    const key = `tiktok::${advertiserId}::${campaignId}`;
    const mapped = campaignStoreMap[key];
    return (mapped as StoreId) ?? storeId;
  };

  const campaigns: CampaignRegistryRow[] = campaignRows.map(r => toCampaignRow(resolveStore(String(r.campaign_id)), r));
  const adsets: AdsetRegistryRow[] = adgroupRows.map(r => toAdsetRow(resolveStore(String(r.campaign_id)), r));
  const ads: AdRegistryRow[] = adRows.map(r => toAdRow(resolveStore(String(r.campaign_id)), r));

  return { campaigns, adsets, ads };
}

function toCampaignRow(storeId: StoreId, r: Record<string, unknown>): CampaignRegistryRow {
  const configured = String(r.operation_status ?? '');
  const effective = String(r.secondary_status ?? '');
  return {
    store_id: storeId, platform: 'tiktok',
    campaign_id: String(r.campaign_id), name: r.campaign_name as string ?? null,
    configured_status: configured || null,
    effective_status: effective || null,
    delivery_status: deriveDelivery(effective),
    is_enabled: configured === 'ENABLE',
    is_serving: effective.includes('DELIVERY_OK'),
    first_seen_at: NULL_PLACEHOLDER, last_seen_at: NULL_PLACEHOLDER,
    platform_updated_at: null, status_changed_at: null,
    last_metrics_success_at: null, last_status_success_at: null,
    raw_status_payload: r,
    missed_seen_count: 0, is_removed: false,
  };
}

function toAdsetRow(storeId: StoreId, r: Record<string, unknown>): AdsetRegistryRow {
  return {
    ...toCampaignRow(storeId, { ...r, campaign_name: r.adgroup_name }),
    campaign_id: String(r.campaign_id),
    adset_id: String(r.adgroup_id),
    daily_budget_cad: null, lifetime_budget_cad: null,
  };
}

function toAdRow(storeId: StoreId, r: Record<string, unknown>): AdRegistryRow {
  return {
    ...toCampaignRow(storeId, { ...r, campaign_name: r.ad_name }),
    campaign_id: String(r.campaign_id),
    adset_id: String(r.adgroup_id),
    ad_id: String(r.ad_id),
  };
}

function deriveDelivery(effective: string): string | null {
  if (effective.includes('DELIVERY_OK')) return 'DELIVERING';
  if (effective.includes('CAMPAIGN_DISABLE')) return 'NOT_DELIVERING';
  if (effective.includes('PENDING')) return 'PENDING_REVIEW';
  if (effective.includes('REJECTED')) return 'REJECTED';
  if (!effective) return null;
  return 'UNKNOWN';
}
