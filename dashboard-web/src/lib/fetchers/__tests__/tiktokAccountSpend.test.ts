import { describe, expect, it, vi } from 'vitest';
import { fetchTikTokAccountSpendForDates } from '@/lib/fetchers/tiktokAccountSpend';

describe('fetchTikTokAccountSpendForDates', () => {
  it('one report call returns per-day spend + impressions for the advertiser', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        message: 'OK',
        data: {
          list: [
            { dimensions: { stat_time_day: '2026-05-28 00:00:00' }, metrics: { spend: '50.00',  impressions: '500'  } },
            { dimensions: { stat_time_day: '2026-05-29 00:00:00' }, metrics: { spend: '75.50',  impressions: '750'  } },
            { dimensions: { stat_time_day: '2026-05-30 00:00:00' }, metrics: { spend: '125.25', impressions: '1250' } },
          ],
        },
      }),
      text: async () => '',
    });
    const rows = await fetchTikTokAccountSpendForDates({
      advertiserId: '1234567890',
      accessToken: 'TOK',
      accountCurrency: 'USD',
      dates: ['2026-05-28', '2026-05-29', '2026-05-30'],
      fetcher: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const url = fetchImpl.mock.calls[0][0] as string;
    expect(url).toContain('/report/integrated/get/');
    expect(url).toContain('data_level=AUCTION_ADVERTISER');
    expect(url).toContain('start_date=2026-05-28');
    expect(url).toContain('end_date=2026-05-30');
    expect(url).toContain(encodeURIComponent('"stat_time_day"'));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ date: '2026-05-28', spend: 50, currency: 'USD', impressions: 500 });
    expect(rows[2]).toMatchObject({ date: '2026-05-30', spend: 125.25, currency: 'USD', impressions: 1250 });
  });

  it('TikTok-envelope error (code !== 0) throws with message + code', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        code: 40105,
        message: 'access token invalid',
        data: {},
      }),
      text: async () => '',
    });
    await expect(fetchTikTokAccountSpendForDates({
      advertiserId: '1234567890',
      accessToken: 'BAD',
      accountCurrency: 'USD',
      dates: ['2026-05-30'],
      fetcher: fetchImpl as unknown as typeof fetch,
    })).rejects.toThrow(/code=40105.*access token invalid/);
  });

  it('returns empty array when data.list is missing or empty', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, message: 'OK', data: { list: [] } }),
      text: async () => '',
    });
    const rows = await fetchTikTokAccountSpendForDates({
      advertiserId: '1234567890',
      accessToken: 'TOK',
      accountCurrency: 'USD',
      dates: ['2026-05-30'],
      fetcher: fetchImpl as unknown as typeof fetch,
    });
    expect(rows).toEqual([]);
  });

  it('extracts YYYY-MM-DD from stat_time_day which TikTok returns with " 00:00:00" suffix', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        message: 'OK',
        data: { list: [{ dimensions: { stat_time_day: '2026-05-30 00:00:00' }, metrics: { spend: '10', impressions: '1' } }] },
      }),
      text: async () => '',
    });
    const rows = await fetchTikTokAccountSpendForDates({
      advertiserId: '1234567890',
      accessToken: 'TOK',
      accountCurrency: 'USD',
      dates: ['2026-05-30'],
      fetcher: fetchImpl as unknown as typeof fetch,
    });
    expect(rows[0].date).toBe('2026-05-30');
  });
});
