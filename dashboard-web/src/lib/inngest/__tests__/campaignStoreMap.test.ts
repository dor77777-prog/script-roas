// dashboard-web/src/lib/inngest/__tests__/campaignStoreMap.test.ts
//
// Phase A.5 — TDD tests for the server-side campaign-store-map reader.
// Runs under node config; no DOM needed.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadCampaignStoreMapFromSupabase } from '../campaignStoreMap';

const maybeSingleMock = vi.fn();

vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: maybeSingleMock,
        }),
      }),
    }),
  }),
}));

beforeEach(() => maybeSingleMock.mockReset().mockResolvedValue({ data: null }));

describe('loadCampaignStoreMapFromSupabase', () => {
  it('returns the JSONB value as a string-to-string map', async () => {
    maybeSingleMock.mockResolvedValue({
      data: { value: { camp_aaa: 'uzoshop', camp_bbb: 'store2' } },
    });

    const result = await loadCampaignStoreMapFromSupabase();

    expect(result).toEqual({ camp_aaa: 'uzoshop', camp_bbb: 'store2' });
  });

  it('returns {} when no row exists', async () => {
    maybeSingleMock.mockResolvedValue({ data: null });

    const result = await loadCampaignStoreMapFromSupabase();

    expect(result).toEqual({});
  });

  it('filters non-string values defensively', async () => {
    maybeSingleMock.mockResolvedValue({
      data: {
        value: {
          camp_valid: 'uzoshop',
          camp_number: 42,
          camp_null: null,
          camp_obj: { nested: true },
          camp_arr: ['a', 'b'],
          camp_bool: false,
        },
      },
    });

    const result = await loadCampaignStoreMapFromSupabase();

    expect(result).toEqual({ camp_valid: 'uzoshop' });
  });

  it('returns {} on Supabase error (swallows + console.warn)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Using mockReturnValueOnce so the rejection is NOT created at mock-setup
    // time (which causes Node 25 to fire unhandledRejection before the await
    // can claim it).  The rejected promise is constructed lazily inside
    // Promise.resolve().then(), which attaches it to the microtask queue
    // AFTER the call site already has a reference to the outer awaited chain.
    maybeSingleMock.mockReturnValueOnce(
      Promise.resolve().then(() => { throw new Error('network timeout'); }),
    );

    const result = await loadCampaignStoreMapFromSupabase();

    expect(result).toEqual({});
    expect(warnSpy).toHaveBeenCalledWith(
      '[loadCampaignStoreMapFromSupabase] read failed:',
      expect.any(Error),
    );

    warnSpy.mockRestore();
  });
});
