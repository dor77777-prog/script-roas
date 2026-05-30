import { describe, expect, it, vi } from 'vitest';
import { fetchGoogleAccountSpendForDates } from '@/lib/fetchers/googleAccountSpend';

describe('fetchGoogleAccountSpendForDates', () => {
  it('one GAQL query returns one row per date in BETWEEN range', async () => {
    const searchStream = vi.fn().mockResolvedValue([
      { customer: { currencyCode: 'CAD' }, metrics: { costMicros: '50000000', impressions: '1000' }, segments: { date: '2026-05-28' } },
      { customer: { currencyCode: 'CAD' }, metrics: { costMicros: '75000000', impressions: '1500' }, segments: { date: '2026-05-29' } },
      { customer: { currencyCode: 'CAD' }, metrics: { costMicros: '25000000', impressions: '500'  }, segments: { date: '2026-05-30' } },
    ]);
    const customer = { searchStream } as Parameters<typeof fetchGoogleAccountSpendForDates>[0]['customer'];
    const rows = await fetchGoogleAccountSpendForDates({
      customer,
      dates: ['2026-05-28', '2026-05-29', '2026-05-30'],
    });
    expect(searchStream).toHaveBeenCalledOnce();
    const query = searchStream.mock.calls[0][0].query as string;
    expect(query).toContain('FROM customer');
    expect(query).toContain('metrics.cost_micros');
    expect(query).toContain('metrics.impressions');
    expect(query).toContain("BETWEEN '2026-05-28' AND '2026-05-30'");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ date: '2026-05-28', spend: 50, currency: 'CAD', impressions: 1000 });
    expect(rows[1]).toMatchObject({ date: '2026-05-29', spend: 75, currency: 'CAD', impressions: 1500 });
    expect(rows[2]).toMatchObject({ date: '2026-05-30', spend: 25, currency: 'CAD', impressions: 500 });
  });

  it('returns empty array when the GAQL response is empty', async () => {
    const searchStream = vi.fn().mockResolvedValue([]);
    const customer = { searchStream } as Parameters<typeof fetchGoogleAccountSpendForDates>[0]['customer'];
    const rows = await fetchGoogleAccountSpendForDates({
      customer,
      dates: ['2026-05-30'],
    });
    expect(rows).toEqual([]);
  });

  it('uses the MIN date as BETWEEN-lower and MAX date as BETWEEN-upper (handles unsorted input)', async () => {
    const searchStream = vi.fn().mockResolvedValue([]);
    const customer = { searchStream } as Parameters<typeof fetchGoogleAccountSpendForDates>[0]['customer'];
    await fetchGoogleAccountSpendForDates({
      customer,
      dates: ['2026-05-30', '2026-05-28', '2026-05-29'],
    });
    const query = searchStream.mock.calls[0][0].query as string;
    expect(query).toContain("BETWEEN '2026-05-28' AND '2026-05-30'");
  });
});
