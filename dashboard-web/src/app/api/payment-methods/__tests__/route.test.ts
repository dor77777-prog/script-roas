// dashboard-web/src/app/api/payment-methods/__tests__/route.test.ts
//
// תשלומים (2026-06-03) — /api/payment-methods route. Mirrors /api/cohorts:
//   - happy path → 200 { months: PaymentMethodsMonth[], lastUpdated }
//   - reader failure → 200 { months: [], error } (degraded path, no-store)
//
// No params: the route returns the full per-month × store × category aggregate;
// the client (PaymentMethodsTab) slices by scope (business / per-store) after
// receiving the full dataset — the same contract as /api/cohorts.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/postgresReaders', () => ({
  readPaymentMethodsByMonth: vi.fn(),
}));
vi.mock('@/lib/sentry/capture', () => ({
  captureRouteError: vi.fn(),
}));

import { GET, revalidate } from '../route';
import { readPaymentMethodsByMonth } from '@/lib/postgresReaders';
import { captureRouteError } from '@/lib/sentry/capture';
import { CACHE_CONFIG } from '@/lib/cacheConfig';

function emptyTotals() {
  return {
    credit: { orders: 0, revenueCad: 0 },
    paypal: { orders: 0, revenueCad: 0 },
    other: { orders: 0, revenueCad: 0 },
  };
}

describe('/api/payment-methods (תשלומים)', () => {
  beforeEach(() => {
    (readPaymentMethodsByMonth as ReturnType<typeof vi.fn>).mockReset();
    (captureRouteError as ReturnType<typeof vi.fn>).mockReset();
  });

  it('exports revalidate matching CACHE_CONFIG.paymentMethods.revalidate', () => {
    expect(revalidate).toBe(CACHE_CONFIG.paymentMethods.revalidate);
  });

  it('returns 200 with the full months aggregate + lastUpdated on the happy path', async () => {
    const result = {
      months: [
        {
          month: '2025-07',
          perStore: { uzoshop: emptyTotals() },
          business: emptyTotals(),
        },
      ],
    };
    (readPaymentMethodsByMonth as ReturnType<typeof vi.fn>).mockResolvedValue(result);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.months).toEqual(result.months);
    expect(typeof body.lastUpdated).toBe('string');
    expect(Number.isNaN(Date.parse(body.lastUpdated))).toBe(false);
    expect(body.error).toBeUndefined();
  });

  it('calls the reader with no arguments (returns all stores)', async () => {
    (readPaymentMethodsByMonth as ReturnType<typeof vi.fn>).mockResolvedValue({ months: [] });
    await GET();
    const mock = readPaymentMethodsByMonth as ReturnType<typeof vi.fn>;
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0][0]).toBeUndefined();
  });

  it('degrades gracefully to 200 { months: [], error } on reader error', async () => {
    (readPaymentMethodsByMonth as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('connection refused'),
    );

    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json();
    expect(body.months).toEqual([]);
    expect(body.error).toBeTruthy();
    expect(typeof body.lastUpdated).toBe('string');
    expect(captureRouteError).toHaveBeenCalledTimes(1);
  });
});
