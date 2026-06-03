// dashboard-web/src/app/api/cohorts/__tests__/route.test.ts
//
// Wave 2 (2026-06-03) — /api/cohorts route. Mirrors /api/orders-attribution:
//   - happy path → 200 { rows: CohortMonthlyRow[], lastUpdated }
//   - reader failure → 200 { rows: [], error } (degraded path, no-store)
//
// No store/range params: the route returns ALL stores' cohort rows; the
// client slices by store (same contract as /api/orders-attribution).

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/postgresReaders', () => ({
  fetchCohortMonthlyFromPostgres: vi.fn(),
}));
vi.mock('@/lib/sentry/capture', () => ({
  captureRouteError: vi.fn(),
}));

import { GET } from '../route';
import { fetchCohortMonthlyFromPostgres } from '@/lib/postgresReaders';
import { captureRouteError } from '@/lib/sentry/capture';

function baseRow(storeId: string, firstOrderMonth: string, monthSince: number) {
  return {
    storeId,
    firstOrderMonth,
    monthSince,
    activeCustomers: 10,
    orders: 12,
    grossCad: 1000,
    netCad: 900,
  };
}

describe('/api/cohorts (Wave 2)', () => {
  beforeEach(() => {
    (fetchCohortMonthlyFromPostgres as ReturnType<typeof vi.fn>).mockReset();
    (captureRouteError as ReturnType<typeof vi.fn>).mockReset();
  });

  it('returns 200 with all stores\' rows + lastUpdated on the happy path', async () => {
    const rows = [
      baseRow('uzoshop', '2025-07', 0),
      baseRow('uzoshop', '2025-07', 1),
      baseRow('zolplus', '2025-08', 0),
    ];
    (fetchCohortMonthlyFromPostgres as ReturnType<typeof vi.fn>).mockResolvedValue(rows);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toEqual(rows);
    expect(typeof body.lastUpdated).toBe('string');
    expect(Number.isNaN(Date.parse(body.lastUpdated))).toBe(false);
    expect(body.error).toBeUndefined();
  });

  it('calls the reader with no store filter (returns all stores)', async () => {
    (fetchCohortMonthlyFromPostgres as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await GET();
    // No store param plumbed — reader called with no args (all stores).
    const mock = fetchCohortMonthlyFromPostgres as ReturnType<typeof vi.fn>;
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0][0]).toBeUndefined();
  });

  it('degrades gracefully to 200 { rows: [], error } on reader error', async () => {
    (fetchCohortMonthlyFromPostgres as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('connection refused'),
    );

    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json();
    expect(body.rows).toEqual([]);
    expect(body.error).toBeTruthy();
    expect(typeof body.lastUpdated).toBe('string');
    expect(captureRouteError).toHaveBeenCalledTimes(1);
  });
});
