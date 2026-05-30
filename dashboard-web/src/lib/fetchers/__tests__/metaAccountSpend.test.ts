import { describe, expect, it, vi } from 'vitest';
import { fetchMetaAccountSpendForDates } from '@/lib/fetchers/metaAccountSpend';

describe('fetchMetaAccountSpendForDates', () => {
  it('one Graph API call returns array of {date, spend, currency, impressions} per date in range', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { date_start: '2026-05-28', date_stop: '2026-05-28', spend: '100.50', impressions: '5000', account_currency: 'ILS' },
          { date_start: '2026-05-29', date_stop: '2026-05-29', spend: '200.00', impressions: '8000', account_currency: 'ILS' },
          { date_start: '2026-05-30', date_stop: '2026-05-30', spend: '50.25',  impressions: '3000', account_currency: 'ILS' },
        ],
      }),
      text: async () => '',
    });
    const rows = await fetchMetaAccountSpendForDates({
      adAccountId: '12345',
      accessToken: 'TOK',
      dates: ['2026-05-28', '2026-05-29', '2026-05-30'],
      fetcher: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = fetchImpl.mock.calls[0][0] as string;
    expect(url).toContain('act_12345/insights');
    expect(url).toContain('level=account');
    expect(url).toContain('time_increment=1');
    expect(url).toContain(encodeURIComponent('"since":"2026-05-28"'));
    expect(url).toContain(encodeURIComponent('"until":"2026-05-30"'));
    expect(url).toContain('fields=spend%2Cimpressions%2Caccount_currency');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ date: '2026-05-28', spend: 100.50, currency: 'ILS', impressions: 5000 });
    expect(rows[2]).toMatchObject({ date: '2026-05-30', spend: 50.25, currency: 'ILS', impressions: 3000 });
  });

  it('returns empty array when the API returns no rows (early in day, no spend yet)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
      text: async () => '',
    });
    const rows = await fetchMetaAccountSpendForDates({
      adAccountId: '12345',
      accessToken: 'TOK',
      dates: ['2026-05-30'],
      fetcher: fetchImpl as unknown as typeof fetch,
    });
    expect(rows).toEqual([]);
  });

  it('throws on HTTP error with body snippet', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
      text: async () => '{"error":{"message":"Invalid OAuth access token"}}',
    });
    await expect(fetchMetaAccountSpendForDates({
      adAccountId: '12345',
      accessToken: 'BAD',
      dates: ['2026-05-30'],
      fetcher: fetchImpl as unknown as typeof fetch,
    })).rejects.toThrow(/401/);
  });

  it('uses the lexicographically MIN date as since and MAX as until (handles unsorted input)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
      text: async () => '',
    });
    await fetchMetaAccountSpendForDates({
      adAccountId: '12345',
      accessToken: 'TOK',
      dates: ['2026-05-30', '2026-05-28', '2026-05-29'],
      fetcher: fetchImpl as unknown as typeof fetch,
    });
    const url = fetchImpl.mock.calls[0][0] as string;
    expect(url).toContain(encodeURIComponent('"since":"2026-05-28"'));
    expect(url).toContain(encodeURIComponent('"until":"2026-05-30"'));
  });
});
