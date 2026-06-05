// dashboard-web/src/lib/fetchers/googleStatus.ts
//
// Phase C — Google Ads status discovery via change_status. Returns
// changed campaign/adgroup/ad ids + full status rows for each.
//
// CRIT-C note: GAQL queries themselves remain snake_case (GAQL is
// case-sensitive snake_case), but the Google Ads JSON API returns
// camelCase keys — see googleAds.ts:479-489 for the canonical shape:
//   r.changeStatus.resourceType / lastChangeDateTime
//   r.changeStatus.campaign / .adGroup / .adGroupAd (per-type entity refs)
//   r.adGroup, r.adGroupAd.ad, metrics.costMicros, metrics.conversionsValue
// Snake-case lookups silently return undefined → empty result sets.
//
// CRIT-G note (Phase C soak hotfix, 2026-05-30):
// `change_status.resource_name` is the resource_name of THE CHANGE_STATUS
// itself (`customers/{cid}/changeStatus/{minute_bucket-entity_type-entity_id}`),
// NOT the changed campaign/adGroup/ad. Splitting it on `/` and popping
// returned a composite id like `1780118362096495-5-22542818628` which
// Google rejected at the follow-up step with `BAD_NUMBER`. The fix is to
// SELECT and read the typed sibling fields (`change_status.campaign`,
// `change_status.ad_group`, `change_status.ad_group_ad`) which each
// carry the proper resource_name of the changed entity.

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
  /**
   * Phase D soak (2026-05-30) — campaign ids the worker wants the
   * follow-up SELECT to include even if change_status didn't surface
   * them in the last 24h. Used to sweep registry rows that are still
   * at the BACKFILL_UNKNOWN sentinel because the campaign has been
   * stable longer than the change_status window.
   *
   * Without this, a long-stable campaign that was inserted by Phase D
   * migration backfill stays at BACKFILL_UNKNOWN forever — the worker
   * never re-queries it.
   */
  extraCampaignIds?: string[];
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
  // CRIT-F: GAQL does NOT support `LAST_24_HOURS` as a date-range constant
  // — only LAST_7_DAYS / LAST_14_DAYS / LAST_30_DAYS for the LAST_* family.
  // For sub-day windows, compare last_change_date_time with a datetime
  // literal formatted 'YYYY-MM-DD HH:MM:SS'.
  //
  // CRIT-F-2 (Phase C soak, 2026-05-30): a single-sided `>` filter is
  // rejected by Google as `CHANGE_DATE_RANGE_INFINITE` ("The change_status
  // request … is filtering on change_status.last_change_date_time with an
  // infinite range."). The bounded-range requirement is specific to the
  // change_status resource — both lower AND upper bounds are required.
  // We use NOW as the upper bound so the window is exactly the same 24h
  // the cutoff defined. Per Google docs, change_status queries should also
  // LIMIT 10000 and ORDER BY last_change_date_time DESC so the most recent
  // changes are processed first.
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const cutoffIso = formatGaqlDateTime(cutoff);
  const upperIso = formatGaqlDateTime(new Date());
  // CRIT-G: select the typed entity references (change_status.campaign,
  // change_status.ad_group, change_status.ad_group_ad) so the parsing
  // loop can extract the entity_id from the changed resource's name —
  // not from the change_status's own composite resource_name.
  const changeRows = await customer.searchStream({
    query: `
      SELECT change_status.resource_type,
             change_status.campaign,
             change_status.ad_group,
             change_status.ad_group_ad,
             change_status.last_change_date_time
        FROM change_status
       WHERE change_status.last_change_date_time > '${cutoffIso}'
         AND change_status.last_change_date_time <= '${upperIso}'
         AND change_status.resource_type IN ('CAMPAIGN', 'AD_GROUP', 'AD_GROUP_AD')
       ORDER BY change_status.last_change_date_time DESC
       LIMIT 10000
    `,
  });

  const campaignIds = new Set<string>();
  const adgroupIds = new Set<string>();
  const adIds = new Set<string>();
  for (const r of changeRows) {
    // CRIT-C: JSON response uses camelCase keys (changeStatus, resourceType,
    // campaign, adGroup, adGroupAd). Snake-case here would silently return
    // undefined.
    // CRIT-G: read the entity_id from the per-type typed field
    // (change_status.campaign / .adGroup / .adGroupAd), NOT from
    // change_status.resource_name (that's the change_status's own
    // composite name and would produce BAD_NUMBER on the follow-up).
    const cs = (r as { changeStatus?: Record<string, unknown> }).changeStatus;
    if (!cs) continue;
    const type = cs.resourceType as string;
    const entityResource =
      type === 'CAMPAIGN'    ? (cs.campaign as string | undefined)
      : type === 'AD_GROUP'   ? (cs.adGroup as string | undefined)
      : type === 'AD_GROUP_AD' ? (cs.adGroupAd as string | undefined)
      : undefined;
    const tail = entityResource?.split('/').pop();
    if (!tail) continue;
    if (type === 'CAMPAIGN') campaignIds.add(tail);
    if (type === 'AD_GROUP') adgroupIds.add(tail);
    if (type === 'AD_GROUP_AD') {
      // ad_group_ad resource_name ends with `<adGroupId>~<adId>` per
      // Google Ads API convention. The numeric `ad.id` is the segment
      // after the tilde; passing the full composite would fail
      // `WHERE ad_group_ad.ad.id IN (...)` at the follow-up step.
      const adId = tail.split('~').pop();
      if (adId) adIds.add(adId);
    }
  }

  // Phase D soak (2026-05-30) — merge in any extra ids the worker wants
  // swept (registry rows still at BACKFILL_UNKNOWN because the campaign
  // hasn't changed in the change_status 24h window). Set semantics dedupe
  // against change_status hits automatically.
  if (input.extraCampaignIds) {
    for (const id of input.extraCampaignIds) {
      if (id) campaignIds.add(id);
    }
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
      // Phase G (2026-06-05): also SELECT ad_group_ad.ad.name (mirrors the
      // campaign/ad_group name selects above; same field googleHotMetrics
      // uses) so the registry ad row carries the live ad name instead of
      // null — otherwise the full-row upsert clobbers backfilled names.
      query: `SELECT campaign.id, ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad_group, ad_group_ad.status FROM ad_group_ad WHERE ad_group_ad.ad.id IN (${ids})`,
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
  // Phase G (2026-06-05): the ad name lives on the inner `ad` object
  // (ad_group_ad.ad.name, camelCase `ad.name` in the JSON response), NOT on
  // the ad_group_ad row itself. toCampaignRow reads `aga.name` which is
  // absent here → it would force the registry name to null and the full-row
  // upsert would clobber any backfilled ad name. Source it from `ad.name`.
  return {
    ...toCampaignRow(storeId, aga),
    campaign_id: campaignId,
    adset_id: adgroupId,
    ad_id: String(adInner.id ?? ''),
    name: (adInner.name as string | undefined) ?? null,
  };
}

function deriveDelivery(effective: string): string | null {
  if (effective === 'SERVING') return 'DELIVERING';
  if (effective === 'PENDING') return 'PENDING_REVIEW';
  if (effective === 'ENDED' || effective === 'NONE') return 'NOT_DELIVERING';
  if (!effective) return null;
  return 'UNKNOWN';
}

/**
 * CRIT-F — Format a JS Date as the GAQL datetime literal expected by
 * change_status.last_change_date_time comparisons: 'YYYY-MM-DD HH:MM:SS'
 * in UTC. Google's GAQL parser does not accept ISO-8601 with 'T' or 'Z'
 * separators for this column type.
 */
function formatGaqlDateTime(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}
