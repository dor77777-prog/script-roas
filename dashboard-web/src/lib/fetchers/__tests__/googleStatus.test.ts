import { describe, expect, it, vi } from 'vitest';
import { fetchGoogleStatusForStore } from '@/lib/fetchers/googleStatus';

describe('fetchGoogleStatusForStore()', () => {
  it('returns campaigns + adgroups + ads with status from change_status + entity follow-up', async () => {
    const searchStream = vi.fn();
    // First call: change_status query.
    // CRIT-C: response JSON uses camelCase keys (changeStatus,
    // resourceType, resourceName, lastChangeDateTime).
    searchStream.mockResolvedValueOnce([
      { campaign: { id: 'GC1' }, changeStatus: { resourceType: 'CAMPAIGN', resourceName: 'customers/123/campaigns/GC1', lastChangeDateTime: '2026-05-30 14:00:00' } },
    ]);
    // Second call: campaign entity follow-up.
    // CRIT-C: `servingStatus` (camelCase) — GAQL stays snake_case but the
    // returned JSON object is camelCase.
    searchStream.mockResolvedValueOnce([
      { campaign: { id: 'GC1', name: 'G Campaign 1', status: 'ENABLED', servingStatus: 'SERVING' } },
    ]);
    const customer = { searchStream } as unknown as Parameters<typeof fetchGoogleStatusForStore>[0]['customer'];
    const out = await fetchGoogleStatusForStore({
      storeId: 'uzoshop',
      customer,
    });
    expect(out.campaigns).toHaveLength(1);
    expect(out.campaigns[0]).toMatchObject({
      store_id: 'uzoshop', platform: 'google',
      campaign_id: 'GC1', configured_status: 'ENABLED', effective_status: 'SERVING',
    });
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
});
