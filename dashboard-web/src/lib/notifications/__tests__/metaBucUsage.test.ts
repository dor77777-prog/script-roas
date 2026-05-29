// dashboard-web/src/lib/notifications/__tests__/metaBucUsage.test.ts
//
// TDD tests for metaBucUsage.ts helpers:
//   - recordMetaBucUsage: upserts per (store_id, ad_account_id) composite key
//   - getMetaBucUsageForStore: reads all rows, returns MAX(pct) across rows

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recordMetaBucUsage, getMetaBucUsageForStore } from '../metaBucUsage';

// --- Mocks ----------------------------------------------------------------

const upsertCapture = vi.fn();
const selectMock = vi.fn();

vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({
    from: (_table: string) => ({
      upsert: upsertCapture,
      select: () => ({ eq: selectMock }),
    }),
  }),
}));

beforeEach(() => {
  upsertCapture.mockReset().mockResolvedValue({ error: null });
  selectMock.mockReset();
});

// Minimal snapshot fixture — all required fields
const baseSnapshot = {
  store_id: 'uzoshop',
  ad_account_id: 'act_123',
  ads_insights_call_pct: 10,
  ads_insights_cputime_pct: 20,
  ads_insights_time_pct: 30,
  ads_insights_eta_minutes: 5,
  ads_management_call_pct: 15,
  ads_management_cputime_pct: 25,
  ads_management_time_pct: 35,
  ads_management_eta_minutes: 8,
  last_url: 'https://graph.facebook.com/v20.0/insights',
} as const;

// --- Tests ----------------------------------------------------------------

describe('metaBucUsage', () => {
  // -------------------------------------------------------------------------
  // recordMetaBucUsage
  // -------------------------------------------------------------------------

  describe('recordMetaBucUsage', () => {
    it('upserts with composite key (store_id, ad_account_id)', async () => {
      await recordMetaBucUsage(baseSnapshot);

      expect(upsertCapture).toHaveBeenCalledOnce();
      expect(upsertCapture).toHaveBeenCalledWith(
        expect.objectContaining({
          store_id: 'uzoshop',
          ad_account_id: 'act_123',
        }),
        { onConflict: 'store_id,ad_account_id' },
      );
    });

    it('includes last_updated_at in the upsert payload', async () => {
      await recordMetaBucUsage(baseSnapshot);

      const [payload] = upsertCapture.mock.calls[0];
      expect(payload).toHaveProperty('last_updated_at');
      expect(typeof payload.last_updated_at).toBe('string');
      // Must be a valid ISO date string
      expect(() => new Date(payload.last_updated_at)).not.toThrow();
    });

    it('swallows Supabase errors (no propagation, console.warn called)', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      upsertCapture.mockRejectedValue(new Error('db unavailable'));

      await expect(recordMetaBucUsage(baseSnapshot)).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        '[recordMetaBucUsage] upsert failed:',
        expect.any(Error),
      );

      warnSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // getMetaBucUsageForStore
  // -------------------------------------------------------------------------

  describe('getMetaBucUsageForStore', () => {
    it('returns null when store has no rows (empty data array)', async () => {
      selectMock.mockResolvedValue({ data: [], error: null });

      const result = await getMetaBucUsageForStore('uzoshop');
      expect(result).toBeNull();
    });

    it('returns MAX across rows for all 6 pct fields', async () => {
      // Two ad accounts: account A is lower, account B is higher on all pct fields
      selectMock.mockResolvedValue({
        data: [
          {
            store_id: 'uzoshop',
            ad_account_id: 'act_A',
            ads_insights_call_pct: 40,
            ads_insights_cputime_pct: 35,
            ads_insights_time_pct: 30,
            ads_insights_eta_minutes: 10,
            ads_management_call_pct: 20,
            ads_management_cputime_pct: 15,
            ads_management_time_pct: 12,
            ads_management_eta_minutes: 3,
          },
          {
            store_id: 'uzoshop',
            ad_account_id: 'act_B',
            ads_insights_call_pct: 70,
            ads_insights_cputime_pct: 65,
            ads_insights_time_pct: 60,
            ads_insights_eta_minutes: 20,
            ads_management_call_pct: 50,
            ads_management_cputime_pct: 45,
            ads_management_time_pct: 42,
            ads_management_eta_minutes: 9,
          },
        ],
        error: null,
      });

      const result = await getMetaBucUsageForStore('uzoshop');
      expect(result).not.toBeNull();
      // All 6 pct fields should be the max from act_B
      expect(result!.max_ads_insights_call_pct).toBe(70);
      expect(result!.max_ads_insights_cputime_pct).toBe(65);
      expect(result!.max_ads_insights_time_pct).toBe(60);
      expect(result!.max_ads_management_call_pct).toBe(50);
      expect(result!.max_ads_management_cputime_pct).toBe(45);
      expect(result!.max_ads_management_time_pct).toBe(42);
    });

    it('max_eta_minutes takes MAX across BOTH BUCs AND ALL rows', async () => {
      // act_A: insights_eta=5, management_eta=30  → per-row max = 30
      // act_B: insights_eta=50, management_eta=20 → per-row max = 50
      // Expected overall max_eta_minutes = 50
      selectMock.mockResolvedValue({
        data: [
          {
            store_id: 'uzoshop',
            ad_account_id: 'act_A',
            ads_insights_call_pct: 10,
            ads_insights_cputime_pct: 10,
            ads_insights_time_pct: 10,
            ads_insights_eta_minutes: 5,
            ads_management_call_pct: 10,
            ads_management_cputime_pct: 10,
            ads_management_time_pct: 10,
            ads_management_eta_minutes: 30,
          },
          {
            store_id: 'uzoshop',
            ad_account_id: 'act_B',
            ads_insights_call_pct: 10,
            ads_insights_cputime_pct: 10,
            ads_insights_time_pct: 10,
            ads_insights_eta_minutes: 50,
            ads_management_call_pct: 10,
            ads_management_cputime_pct: 10,
            ads_management_time_pct: 10,
            ads_management_eta_minutes: 20,
          },
        ],
        error: null,
      });

      const result = await getMetaBucUsageForStore('uzoshop');
      expect(result).not.toBeNull();
      // Must cross BOTH BUCs per row, then take max across rows: max(30, 50) = 50
      expect(result!.max_eta_minutes).toBe(50);
    });

    it('includes raw rows in the result', async () => {
      const rows = [
        {
          store_id: 'uzoshop',
          ad_account_id: 'act_123',
          ads_insights_call_pct: 40,
          ads_insights_cputime_pct: 35,
          ads_insights_time_pct: 30,
          ads_insights_eta_minutes: 10,
          ads_management_call_pct: 20,
          ads_management_cputime_pct: 15,
          ads_management_time_pct: 12,
          ads_management_eta_minutes: 3,
        },
      ];
      selectMock.mockResolvedValue({ data: rows, error: null });

      const result = await getMetaBucUsageForStore('uzoshop');
      expect(result).not.toBeNull();
      expect(result!.rows).toEqual(rows);
    });

    it('swallows Supabase errors (returns null + console.warn called)', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      selectMock.mockRejectedValue(new Error('connection refused'));

      const result = await getMetaBucUsageForStore('uzoshop');
      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        '[getMetaBucUsageForStore] read failed:',
        expect.any(Error),
      );

      warnSpy.mockRestore();
    });
  });
});
