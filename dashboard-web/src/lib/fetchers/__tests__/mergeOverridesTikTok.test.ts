import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the FX layer so the merge is deterministic (USD→CAD = 1.4).
vi.mock('@/lib/fetchers/fx', () => ({
  getFxRate: vi.fn(async () => 1.4),
}));

// Mock the supabase admin client so the override lookup returns canned rows.
let cannedRows: Array<Record<string, unknown>> = [];
vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => Promise.resolve({ data: cannedRows, error: null }),
        }),
      }),
    }),
  }),
}));

import { mergeOverridesFromSupabase } from '@/lib/fetchers/manualOverrides';

beforeEach(() => {
  cannedRows = [];
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('mergeOverridesFromSupabase — TikTok branch (2026-06-02)', () => {
  it('passes through the fetched tt spend (CAD) when no tiktok override exists', async () => {
    const r = await mergeOverridesFromSupabase({
      storeId: 'uzoshop',
      date: '2026-05-20',
      metaSpend: { spend: 0, currency: 'CAD' },
      googleSpend: { spend: 0, currency: 'CAD' },
      tiktokSpend: { spend: 100, currency: 'CAD' },
    });
    expect(r.ttSpendCad).toBe(100);
    expect(r.overridesApplied.tiktok).toBe(false);
  });

  it('REPLACES tt spend with the override (USD→CAD) for the keyed store only', async () => {
    cannedRows = [{ date: '2026-05-20', store_id: 'uzoshop', platform: 'tiktok', spend: 200, currency: 'USD' }];
    const r = await mergeOverridesFromSupabase({
      storeId: 'uzoshop',
      date: '2026-05-20',
      metaSpend: { spend: 0, currency: 'CAD' },
      googleSpend: { spend: 0, currency: 'CAD' },
      tiktokSpend: { spend: 999, currency: 'CAD' }, // ignored — overridden
    });
    expect(r.ttSpendCad).toBe(280); // 200 USD * 1.4
    expect(r.overridesApplied.tiktok).toBe(true);
  });

  it('totalSpendCad includes the tiktok override', async () => {
    cannedRows = [{ date: '2026-05-20', store_id: 'uzoshop', platform: 'tiktok', spend: 100, currency: 'CAD' }];
    const r = await mergeOverridesFromSupabase({
      storeId: 'uzoshop',
      date: '2026-05-20',
      metaSpend: { spend: 50, currency: 'CAD' },
      googleSpend: { spend: 25, currency: 'CAD' },
      tiktokSpend: { spend: 0, currency: 'CAD' },
    });
    expect(r.totalSpendCad).toBe(175); // 50 + 25 + 100
  });

  it('tiktokSpend is optional — omitting it yields ttSpendCad 0', async () => {
    const r = await mergeOverridesFromSupabase({
      storeId: 'zolplus',
      date: '2026-05-20',
      metaSpend: { spend: 10, currency: 'CAD' },
      googleSpend: { spend: 0, currency: 'CAD' },
    });
    expect(r.ttSpendCad).toBe(0);
    expect(r.overridesApplied.tiktok).toBe(false);
    expect(r.totalSpendCad).toBe(10);
  });
});
