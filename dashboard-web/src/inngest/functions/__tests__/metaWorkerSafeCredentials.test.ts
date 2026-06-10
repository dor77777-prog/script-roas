// dashboard-web/src/inngest/functions/__tests__/metaWorkerSafeCredentials.test.ts
//
// P1-12 (2026-06-10): metaWorker.safeCredentials previously swallowed
// credential-resolution errors UNCONDITIONALLY (returning empty-string creds
// + a zero FX stub) — in production that drove an unguarded Graph batch with
// an empty access_token instead of surfacing the misconfig. The fix gates the
// swallow on process.env.VITEST, mirroring googleWorker.safeCustomer +
// tiktokWorker.safeAccount exactly:
//   - vitest: swallow (unit tests stub fetchStatus and never use real creds)
//   - production: rethrow → status-branch catch → transient_error ×3 →
//     Inngest retry.
//
// This file mocks the metaAccountConfig resolvers to THROW so we can assert
// both sides of the gate without env vars or network.

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/fetchers/metaAccountConfig', () => ({
  getAdAccountIdForStore: vi.fn(async () => {
    throw new Error('Missing Meta ad account id for uzoshop.');
  }),
  getMetaAccessTokenForStore: vi.fn(async () => {
    throw new Error('Missing Meta access token for uzoshop.');
  }),
  getFxCadAdapterForStore: vi.fn(async () => async () => 1),
  isMetaConfiguredForStoreAsync: vi.fn(async () => true),
}));

import { runMetaWorkerJob } from '@/inngest/functions/metaWorker';

const NOW_ISO = '2026-06-10T14:30:42.000Z';

function baseInput(overrides: Partial<Parameters<typeof runMetaWorkerJob>[0]> = {}) {
  return {
    jobData: { store_id: 'uzoshop' as const, scope: 'status' as const, tick_id: 'T', staleness_seconds: 900, budget_pct_estimate: 12 },
    bucProbe: async () => ({ pct: 12, etaMinutes: 0 }),
    fetchStatus: vi.fn().mockResolvedValue({
      campaigns: [], adsets: [], ads: [],
      bucUsage: {
        ads_insights_call_pct: 1, ads_insights_cputime_pct: 1, ads_insights_time_pct: 1, ads_insights_eta_minutes: 0,
        ads_management_call_pct: 1, ads_management_cputime_pct: 1, ads_management_time_pct: 1, ads_management_eta_minutes: 0,
      },
    }),
    loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
    upsertRegistry: vi.fn(),
    insertStatusEvents: vi.fn(),
    recordFreshness: vi.fn(),
    upsertBuc: vi.fn(),
    isMetaConfigured: () => true,
    nowIso: NOW_ISO,
    ...overrides,
  };
}

const ORIGINAL_VITEST = process.env.VITEST;

afterEach(() => {
  if (ORIGINAL_VITEST === undefined) delete process.env.VITEST;
  else process.env.VITEST = ORIGINAL_VITEST;
});

describe('metaWorker safeCredentials — P1-12 VITEST-gated error swallow', () => {
  it('production (VITEST unset): credential failure RETHROWS → transient_error ×3, fetchStatus never called', async () => {
    delete process.env.VITEST;
    const input = baseInput();
    await expect(runMetaWorkerJob(input)).rejects.toThrow(/Missing Meta ad account id/);
    // The fetch was never driven with empty creds…
    expect(input.fetchStatus).not.toHaveBeenCalled();
    // …and the status-branch catch surfaced the failure to the panel.
    const rec = input.recordFreshness as ReturnType<typeof vi.fn>;
    const transient = rec.mock.calls.filter((c) => c[0].status === 'transient_error');
    expect(transient.map((c) => c[0].scope).sort()).toEqual(['ad_status', 'adset_status', 'campaign_status']);
    expect(rec.mock.calls.some((c) => c[0].status === 'success')).toBe(false);
  });

  it('vitest (VITEST set): credential failure is swallowed → synthetic creds → stubbed fetch path completes with success', async () => {
    process.env.VITEST = 'true';
    const input = baseInput();
    await runMetaWorkerJob(input);
    expect(input.fetchStatus).toHaveBeenCalled();
    const rec = input.recordFreshness as ReturnType<typeof vi.fn>;
    const success = rec.mock.calls.filter((c) => c[0].status === 'success');
    expect(success.map((c) => c[0].scope).sort()).toEqual(['ad_status', 'adset_status', 'campaign_status']);
  });
});
