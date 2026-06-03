/**
 * תשלומים (Task 5) — postgresReaders.readPaymentMethodsByMonth reader-side
 * contract. Aggregates orders_attribution rows per month × store × payment
 * category (credit / paypal / other), plus a business-wide rollup.
 *
 * Mirrors the mock pattern in postgresReadersCohort.test.ts
 * (vi.mock('@/lib/supabase') with a thenable query builder driven by a
 * module-level rows holder + recorded .select() call). Asserts:
 *   1. the canonical PAYMENT_METHODS_SELECT requests every consumed column,
 *   2. categorization matches categorizePaymentGateway (paypal / credit /
 *      gift_card→other / NULL→other),
 *   3. revenue sums total_cad (numeric coercion via toNumber),
 *   4. per-store buckets are keyed by store_id and the business rollup is the
 *      sum across stores,
 *   5. months are returned in ascending order,
 *   6. a Supabase failure surfaces a namespaced error.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// State holder the mocked client reads at call time.
let mockRows: unknown[] = [];
let mockError: { message: string } | null = null;
const selectCols: string[] = [];

function setSupabaseRows(rows: unknown[]) {
  mockRows = rows;
  mockError = null;
}

vi.mock('@/lib/supabase', () => {
  const makeQuery = () => {
    const q: Record<string, unknown> = {};
    q.select = vi.fn((cols: string) => {
      selectCols.push(cols);
      return q;
    });
    q.eq = vi.fn(() => q);
    q.order = vi.fn(() => q);
    q.gte = vi.fn(() => q);
    q.lte = vi.fn(() => q);
    q.range = vi.fn(() => q);
    q.then = (
      resolve: (v: { data: unknown[] | null; error: { message: string } | null }) => unknown,
    ) => Promise.resolve({ data: mockError ? null : mockRows, error: mockError }).then(resolve);
    return q;
  };
  return {
    getSupabase: () => ({
      from: vi.fn(() => makeQuery()),
    }),
  };
});

import { readPaymentMethodsByMonth, PAYMENT_METHODS_SELECT } from '../postgresReaders';

const PAYMENT_METHODS_COLUMNS = ['store_id', 'date', 'total_cad', 'payment_gateway'] as const;

// 2 months × 2 stores × mixed gateways.
const fakeRows = [
  // 2025-07 — uzoshop
  { store_id: 'uzoshop', date: '2025-07-03', total_cad: '100', payment_gateway: 'shopify_payments' },
  { store_id: 'uzoshop', date: '2025-07-10', total_cad: 50, payment_gateway: 'paypal' },
  { store_id: 'uzoshop', date: '2025-07-15', total_cad: '25.5', payment_gateway: 'gift_card' },
  // 2025-07 — zolplus
  { store_id: 'zolplus', date: '2025-07-20', total_cad: 200, payment_gateway: 'stripe' },
  { store_id: 'zolplus', date: '2025-07-22', total_cad: 10, payment_gateway: null }, // NULL → other
  // 2025-08 — uzoshop
  { store_id: 'uzoshop', date: '2025-08-01', total_cad: 300, payment_gateway: 'PayPal Express Checkout' },
];

beforeEach(() => {
  mockRows = [];
  mockError = null;
  selectCols.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('PAYMENT_METHODS_SELECT', () => {
  it('lists every consumed column', () => {
    for (const col of PAYMENT_METHODS_COLUMNS) {
      expect(PAYMENT_METHODS_SELECT).toContain(col);
    }
  });
});

describe('readPaymentMethodsByMonth', () => {
  it('requests the canonical SELECT', async () => {
    setSupabaseRows(fakeRows);
    await readPaymentMethodsByMonth();
    expect(selectCols[0]).toBe(PAYMENT_METHODS_SELECT);
  });

  it('returns months in ascending order', async () => {
    setSupabaseRows(fakeRows);
    const { months } = await readPaymentMethodsByMonth();
    expect(months.map((m) => m.month)).toEqual(['2025-07', '2025-08']);
  });

  it('aggregates per store × category with orders + revenueCad (total_cad)', async () => {
    setSupabaseRows(fakeRows);
    const { months } = await readPaymentMethodsByMonth();

    const july = months.find((m) => m.month === '2025-07')!;
    // uzoshop July: shopify_payments(credit,100), paypal(50), gift_card(other,25.5)
    expect(july.perStore.uzoshop.credit).toEqual({ orders: 1, revenueCad: 100 });
    expect(july.perStore.uzoshop.paypal).toEqual({ orders: 1, revenueCad: 50 });
    expect(july.perStore.uzoshop.other).toEqual({ orders: 1, revenueCad: 25.5 });
    // zolplus July: stripe(credit,200), null(other,10)
    expect(july.perStore.zolplus.credit).toEqual({ orders: 1, revenueCad: 200 });
    expect(july.perStore.zolplus.paypal).toEqual({ orders: 0, revenueCad: 0 });
    expect(july.perStore.zolplus.other).toEqual({ orders: 1, revenueCad: 10 });
  });

  it('rolls up the business-wide totals across stores', async () => {
    setSupabaseRows(fakeRows);
    const { months } = await readPaymentMethodsByMonth();

    const july = months.find((m) => m.month === '2025-07')!;
    // business credit = uzoshop(100) + zolplus(200)
    expect(july.business.credit).toEqual({ orders: 2, revenueCad: 300 });
    expect(july.business.paypal).toEqual({ orders: 1, revenueCad: 50 });
    // business other = gift_card(25.5) + null(10)
    expect(july.business.other).toEqual({ orders: 2, revenueCad: 35.5 });

    const aug = months.find((m) => m.month === '2025-08')!;
    // PayPal Express Checkout → paypal
    expect(aug.business.paypal).toEqual({ orders: 1, revenueCad: 300 });
    expect(aug.business.credit).toEqual({ orders: 0, revenueCad: 0 });
    expect(aug.perStore.uzoshop.paypal).toEqual({ orders: 1, revenueCad: 300 });
  });

  it('returns an empty months array when there are no rows', async () => {
    setSupabaseRows([]);
    const { months } = await readPaymentMethodsByMonth();
    expect(months).toEqual([]);
  });

  it('throws a namespaced error on a Supabase failure', async () => {
    mockError = { message: 'boom' };
    await expect(readPaymentMethodsByMonth()).rejects.toThrow(
      /postgresReaders\.readPaymentMethodsByMonth: boom/,
    );
  });
});
