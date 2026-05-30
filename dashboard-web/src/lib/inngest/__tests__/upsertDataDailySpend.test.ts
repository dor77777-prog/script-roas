import { describe, expect, it, vi } from 'vitest';
import { upsertDataDailySpend } from '@/lib/inngest/upsertDataDailySpend';

function mockAdmin() {
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn().mockReturnValue({ upsert });
  return {
    admin: { from } as unknown as Parameters<typeof upsertDataDailySpend>[0]['admin'],
    spies: { from, upsert },
  };
}

describe('upsertDataDailySpend', () => {
  it('Meta: writes fb_spend_cad + fb_impressions when both non-null', async () => {
    const { admin, spies } = mockAdmin();
    await upsertDataDailySpend({
      admin,
      storeId: 'uzoshop',
      date: '2026-05-30',
      platform: 'meta',
      spendCad: 123.45,
      impressions: 6789,
    });
    expect(spies.from).toHaveBeenCalledWith('data_daily');
    expect(spies.upsert).toHaveBeenCalledWith(
      { date: '2026-05-30', store_id: 'uzoshop', fb_spend_cad: 123.45, fb_impressions: 6789 },
      { onConflict: 'date,store_id' },
    );
  });

  it('Google: writes ga_spend_cad + ga_impressions', async () => {
    const { admin, spies } = mockAdmin();
    await upsertDataDailySpend({
      admin,
      storeId: 'uzoshop',
      date: '2026-05-30',
      platform: 'google',
      spendCad: 200,
      impressions: 1000,
    });
    expect(spies.upsert).toHaveBeenCalledWith(
      { date: '2026-05-30', store_id: 'uzoshop', ga_spend_cad: 200, ga_impressions: 1000 },
      { onConflict: 'date,store_id' },
    );
  });

  it('TikTok: writes tt_spend_cad + tt_impressions', async () => {
    const { admin, spies } = mockAdmin();
    await upsertDataDailySpend({
      admin,
      storeId: 'uzoshop',
      date: '2026-05-30',
      platform: 'tiktok',
      spendCad: 50,
      impressions: 500,
    });
    expect(spies.upsert).toHaveBeenCalledWith(
      { date: '2026-05-30', store_id: 'uzoshop', tt_spend_cad: 50, tt_impressions: 500 },
      { onConflict: 'date,store_id' },
    );
  });

  it('OMITS spend column when spendCad === null (preserves prior value)', async () => {
    const { admin, spies } = mockAdmin();
    await upsertDataDailySpend({
      admin,
      storeId: 'uzoshop',
      date: '2026-05-30',
      platform: 'meta',
      spendCad: null,
      impressions: 6789,
    });
    expect(spies.upsert).toHaveBeenCalledWith(
      { date: '2026-05-30', store_id: 'uzoshop', fb_impressions: 6789 },
      { onConflict: 'date,store_id' },
    );
  });

  it('OMITS impressions column when impressions === null', async () => {
    const { admin, spies } = mockAdmin();
    await upsertDataDailySpend({
      admin,
      storeId: 'uzoshop',
      date: '2026-05-30',
      platform: 'meta',
      spendCad: 100,
      impressions: null,
    });
    expect(spies.upsert).toHaveBeenCalledWith(
      { date: '2026-05-30', store_id: 'uzoshop', fb_spend_cad: 100 },
      { onConflict: 'date,store_id' },
    );
  });

  it('SKIPS the UPSERT call entirely when both spendCad and impressions are null', async () => {
    const { admin, spies } = mockAdmin();
    await upsertDataDailySpend({
      admin,
      storeId: 'uzoshop',
      date: '2026-05-30',
      platform: 'meta',
      spendCad: null,
      impressions: null,
    });
    expect(spies.upsert).not.toHaveBeenCalled();
  });

  it('throws when Supabase returns an error', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: { message: 'RLS denied' } });
    const from = vi.fn().mockReturnValue({ upsert });
    const admin = { from } as never;
    await expect(
      upsertDataDailySpend({
        admin,
        storeId: 'uzoshop',
        date: '2026-05-30',
        platform: 'meta',
        spendCad: 100,
        impressions: 1000,
      }),
    ).rejects.toThrow(/RLS denied/);
  });
});
