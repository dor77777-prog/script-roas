import { describe, expect, it, vi } from 'vitest';
import { fetchGoogleStatusForStore } from '@/lib/fetchers/googleStatus';

describe('fetchGoogleStatusForStore()', () => {
  it('returns campaigns + adgroups + ads with status from change_status + entity follow-up', async () => {
    const searchStream = vi.fn();
    // First call: change_status query — REAL Google shape.
    //
    // CRIT-G (Phase C soak hotfix, 2026-05-30): change_status.resource_name
    // is the resource_name of THE CHANGE_STATUS itself
    // (`customers/{cid}/changeStatus/{minute_bucket-entity_type-entity_id}`),
    // not the changed campaign. The campaign's resource_name lives in
    // `change_status.campaign` (typed sibling field). Splitting
    // `resource_name` on `/` returned the composite id and produced
    // `WHERE campaign.id IN ('1780118362096495-5-22542818628')` →
    // Google rejected with `BAD_NUMBER`.
    //
    // CRIT-C: response JSON uses camelCase keys (changeStatus,
    // resourceType, lastChangeDateTime). Typed sibling fields are
    // `campaign` / `adGroup` / `adGroupAd`.
    searchStream.mockResolvedValueOnce([
      {
        changeStatus: {
          resourceType: 'CAMPAIGN',
          resourceName: 'customers/123/changeStatus/1780118362096495-5-22542818628',
          campaign: 'customers/123/campaigns/22542818628',
          lastChangeDateTime: '2026-05-30 14:00:00',
        },
      },
    ]);
    // Second call: campaign entity follow-up.
    // CRIT-C: `servingStatus` (camelCase) — GAQL stays snake_case but the
    // returned JSON object is camelCase.
    searchStream.mockResolvedValueOnce([
      { campaign: { id: '22542818628', name: 'G Campaign 1', status: 'ENABLED', servingStatus: 'SERVING' } },
    ]);
    const customer = { searchStream } as unknown as Parameters<typeof fetchGoogleStatusForStore>[0]['customer'];
    const out = await fetchGoogleStatusForStore({
      storeId: 'uzoshop',
      customer,
    });

    // The follow-up query must use the campaign id from `change_status.campaign`
    // (numeric '22542818628'), NOT the change_status composite from
    // `resource_name`. CRIT-G regression guard.
    const followUpQuery = searchStream.mock.calls[1][0].query as string;
    expect(followUpQuery).toContain("'22542818628'");
    expect(followUpQuery).not.toContain('1780118362096495');

    expect(out.campaigns).toHaveLength(1);
    expect(out.campaigns[0]).toMatchObject({
      store_id: 'uzoshop', platform: 'google',
      campaign_id: '22542818628', configured_status: 'ENABLED', effective_status: 'SERVING',
    });
  });

  it('CRIT-G: extracts AD_GROUP ids from change_status.adGroup, not from resource_name', async () => {
    const searchStream = vi.fn();
    searchStream.mockResolvedValueOnce([
      {
        changeStatus: {
          resourceType: 'AD_GROUP',
          resourceName: 'customers/123/changeStatus/1780118362096499-3-99999111',
          adGroup: 'customers/123/adGroups/77777222',
          lastChangeDateTime: '2026-05-30 14:01:00',
        },
      },
    ]);
    // Follow-up: ad_group entity
    searchStream.mockResolvedValueOnce([
      { adGroup: { id: '77777222', campaign: 'customers/123/campaigns/22542818628', name: 'AG 1', status: 'ENABLED' } },
    ]);
    const customer = { searchStream } as unknown as Parameters<typeof fetchGoogleStatusForStore>[0]['customer'];
    const out = await fetchGoogleStatusForStore({ storeId: 'uzoshop', customer });
    const followUpQuery = searchStream.mock.calls[1][0].query as string;
    expect(followUpQuery).toContain("'77777222'");
    expect(followUpQuery).not.toContain('1780118362096499');
    expect(out.adsets).toHaveLength(1);
    expect(out.adsets[0]).toMatchObject({ adset_id: '77777222', campaign_id: '22542818628' });
  });

  it('CRIT-G: extracts AD_GROUP_AD ids from change_status.adGroupAd, not from resource_name', async () => {
    const searchStream = vi.fn();
    searchStream.mockResolvedValueOnce([
      {
        changeStatus: {
          resourceType: 'AD_GROUP_AD',
          resourceName: 'customers/123/changeStatus/1780118362096500-13-88888333',
          adGroupAd: 'customers/123/adGroupAds/77777222~55555444',
          lastChangeDateTime: '2026-05-30 14:02:00',
        },
      },
    ]);
    // Follow-up: ad_group_ad entity (the GAQL filters by ad_group_ad.ad.id IN ...)
    searchStream.mockResolvedValueOnce([
      {
        campaign: { id: '22542818628' },
        adGroupAd: { adGroup: 'customers/123/adGroups/77777222', ad: { id: '55555444' }, status: 'ENABLED' },
      },
    ]);
    const customer = { searchStream } as unknown as Parameters<typeof fetchGoogleStatusForStore>[0]['customer'];
    const out = await fetchGoogleStatusForStore({ storeId: 'uzoshop', customer });
    const followUpQuery = searchStream.mock.calls[1][0].query as string;
    expect(followUpQuery).toContain("'55555444'");
    expect(followUpQuery).not.toContain('1780118362096500');
    expect(out.ads).toHaveLength(1);
    expect(out.ads[0]).toMatchObject({ ad_id: '55555444' });
  });

  // Phase G (2026-06-05) — close the Google ad-level name gap. The ad-level
  // follow-up GAQL must SELECT ad_group_ad.ad.name (mirroring the campaign
  // and ad_group name selects) and toAdRow must source the registry row's
  // `name` from that ad name. Without this the registry ad name is forced to
  // null and the full-row upsert clobbers any backfilled Google ad name.
  it('Phase G: ad-level follow-up SELECTs ad_group_ad.ad.name and the ad row name equals it', async () => {
    const searchStream = vi.fn();
    searchStream.mockResolvedValueOnce([
      {
        changeStatus: {
          resourceType: 'AD_GROUP_AD',
          resourceName: 'customers/123/changeStatus/1780118362096500-13-88888333',
          adGroupAd: 'customers/123/adGroupAds/77777222~55555444',
          lastChangeDateTime: '2026-05-30 14:02:00',
        },
      },
    ]);
    // Follow-up: ad_group_ad entity now carries the ad name (camelCase JSON).
    searchStream.mockResolvedValueOnce([
      {
        campaign: { id: '22542818628' },
        adGroupAd: {
          adGroup: 'customers/123/adGroups/77777222',
          ad: { id: '55555444', name: 'My Google Ad Name' },
          status: 'ENABLED',
        },
      },
    ]);
    const customer = { searchStream } as unknown as Parameters<typeof fetchGoogleStatusForStore>[0]['customer'];
    const out = await fetchGoogleStatusForStore({ storeId: 'uzoshop', customer });

    // The GAQL must request the ad name (the correct GAQL field is
    // ad_group_ad.ad.name — same field googleHotMetrics already selects).
    const followUpQuery = searchStream.mock.calls[1][0].query as string;
    expect(followUpQuery).toContain('ad_group_ad.ad.name');

    expect(out.ads).toHaveLength(1);
    expect(out.ads[0].ad_id).toBe('55555444');
    expect(out.ads[0].name).toBe('My Google Ad Name');
    expect(out.ads[0].name).not.toBeNull();
  });

  it('returns empty when change_status yields no rows', async () => {
    const searchStream = vi.fn().mockResolvedValue([]);
    const customer = { searchStream } as unknown as Parameters<typeof fetchGoogleStatusForStore>[0]['customer'];
    const out = await fetchGoogleStatusForStore({ storeId: 'uzoshop', customer });
    expect(out.campaigns).toHaveLength(0);
    expect(out.adsets).toHaveLength(0);
    expect(out.ads).toHaveLength(0);
  });

  it('change_status GAQL has BOTH lower AND upper bounds on last_change_date_time (avoids CHANGE_DATE_RANGE_INFINITE)', async () => {
    // Production failure observed 2026-05-30: Google rejects unbounded
    // `last_change_date_time > X` with
    //   "errorCode": { "changeStatusError": "CHANGE_DATE_RANGE_INFINITE" }
    //   "message":   "The change_status request is missing filters on
    //                 change_status.last_change_date_time or is filtering
    //                 on change_status.last_change_date_time with an
    //                 infinite range."
    // CRIT-F's prior fix added LIMIT + ORDER BY but missed the bounded-range
    // requirement.
    const searchStream = vi.fn().mockResolvedValue([]);
    const customer = { searchStream } as unknown as Parameters<typeof fetchGoogleStatusForStore>[0]['customer'];
    await fetchGoogleStatusForStore({ storeId: 'uzoshop', customer });
    const firstQuery = searchStream.mock.calls[0][0].query as string;
    // Must filter ON last_change_date_time (existing CRIT-F guarantee).
    expect(firstQuery).toMatch(/change_status\.last_change_date_time\s*>/);
    // NEW: must also have an upper bound to satisfy the bounded-range
    // requirement. We don't pin the exact operator (<= vs <) — only that
    // the field appears twice in the WHERE.
    const lcdtOccurrences = firstQuery.match(/change_status\.last_change_date_time/g) ?? [];
    expect(lcdtOccurrences.length).toBeGreaterThanOrEqual(2);
    expect(firstQuery).toMatch(/change_status\.last_change_date_time\s*<=?/);
  });

  // Phase D soak (2026-05-30) — sweep BACKFILL_UNKNOWN registry rows that
  // change_status alone can't surface (long-stable campaigns outside the
  // 24h window). Worker derives extraCampaignIds from prior registry rows
  // where configured_status='BACKFILL_UNKNOWN' and passes them in here.
  it('extraCampaignIds: includes registry sweep campaign ids in the follow-up query even when change_status returns empty', async () => {
    const searchStream = vi.fn();
    searchStream.mockResolvedValueOnce([]);
    searchStream.mockResolvedValueOnce([
      { campaign: { id: '22552655236', name: 'Long-Stable Campaign', status: 'ENABLED', servingStatus: 'SERVING' } },
    ]);
    const customer = { searchStream } as unknown as Parameters<typeof fetchGoogleStatusForStore>[0]['customer'];
    const out = await fetchGoogleStatusForStore({
      storeId: 'uzoshop',
      customer,
      extraCampaignIds: ['22552655236'],
    });
    expect(searchStream).toHaveBeenCalledTimes(2);
    const followUpQuery = searchStream.mock.calls[1][0].query as string;
    expect(followUpQuery).toContain("'22552655236'");
    expect(out.campaigns).toHaveLength(1);
    expect(out.campaigns[0]).toMatchObject({
      store_id: 'uzoshop', platform: 'google',
      campaign_id: '22552655236', configured_status: 'ENABLED', effective_status: 'SERVING',
    });
  });

  it('extraCampaignIds: deduplicates ids that already appear in change_status', async () => {
    const searchStream = vi.fn();
    searchStream.mockResolvedValueOnce([
      {
        changeStatus: {
          resourceType: 'CAMPAIGN',
          campaign: 'customers/123/campaigns/22542818628',
          lastChangeDateTime: '2026-05-30 14:00:00',
        },
      },
    ]);
    searchStream.mockResolvedValueOnce([
      { campaign: { id: '22542818628', name: 'X', status: 'ENABLED', servingStatus: 'SERVING' } },
    ]);
    const customer = { searchStream } as unknown as Parameters<typeof fetchGoogleStatusForStore>[0]['customer'];
    await fetchGoogleStatusForStore({
      storeId: 'uzoshop',
      customer,
      extraCampaignIds: ['22542818628'],
    });
    const followUpQuery = searchStream.mock.calls[1][0].query as string;
    const matches = followUpQuery.match(/'22542818628'/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it('extraCampaignIds: skips follow-up entirely when both change_status and extra ids are empty', async () => {
    const searchStream = vi.fn().mockResolvedValueOnce([]);
    const customer = { searchStream } as unknown as Parameters<typeof fetchGoogleStatusForStore>[0]['customer'];
    const out = await fetchGoogleStatusForStore({
      storeId: 'uzoshop',
      customer,
      extraCampaignIds: [],
    });
    expect(searchStream).toHaveBeenCalledTimes(1);
    expect(out.campaigns).toHaveLength(0);
  });
});
