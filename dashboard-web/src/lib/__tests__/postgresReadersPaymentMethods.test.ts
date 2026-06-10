/**
 * תשלומים (Task 5) — postgresReaders.readPaymentMethodsByMonth reader-side
 * contract. Aggregates per month × store × payment category (credit / paypal
 * / other), plus a business-wide rollup.
 *
 * P0-1 (2026-06-10): the reader no longer paginate()-scans the entire
 * orders_attribution table (which silently truncated at the 50k ceiling —
 * zolplus's NEWEST orders were the dropped tail). It now calls the
 * `agg_payment_methods_monthly` RPC (migration 20260610130000), which GROUPs
 * BY month × store × RAW gateway in SQL and returns
 * `{ month, store_id, gateway, orders, revenue_cad }` rows. The regex-based
 * categorization (categorizePaymentGateway) stays in code, unchanged — the
 * RPC COALESCEs NULL gateways to '' which categorizes identically ('other').
 *
 * Asserts:
 *   1. the reader calls the agg_payment_methods_monthly RPC (no table scan),
 *   2. categorization matches categorizePaymentGateway (paypal / credit /
 *      gift_card→other / ''(NULL-coalesced)→other),
 *   3. revenue sums revenue_cad (numeric coercion via toNumber) and orders
 *      accumulate across multiple raw gateways in the same category,
 *   4. per-store buckets are keyed by store DISPLAY NAME and the business
 *      rollup is the sum across stores,
 *   5. months are returned in ascending order,
 *   6. a Supabase failure surfaces a namespaced error.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// State holder the mocked client reads at call time.
let mockRows: unknown[] = [];
let mockError: { message: string } | null = null;
const rpcCalls: { fn: string; args: unknown }[] = [];

function setRpcRows(rows: unknown[]) {
  mockRows = rows;
  mockError = null;
}

vi.mock('@/lib/supabase', () => {
  return {
    getSupabase: () => ({
      // RPC mock — records the function name, resolves with the holder state.
      rpc: vi.fn((fn: string, args?: unknown) => {
        rpcCalls.push({ fn, args });
        return Promise.resolve({ data: mockError ? null : mockRows, error: mockError });
      }),
      // .from() retained so an accidental regression back to a table scan
      // fails loudly (the chain is not thenable).
      from: vi.fn(() => {
        throw new Error('readPaymentMethodsByMonth must use the RPC, not a table scan (P0-1)');
      }),
    }),
  };
});

import { readPaymentMethodsByMonth } from '../postgresReaders';

// RPC-shaped rows: one per month × store × RAW gateway.
// 2 months × 2 stores × mixed gateways.
const fakeRows = [
  // 2025-07 — uzoshop
  { month: '2025-07', store_id: 'uzoshop', gateway: 'shopify_payments', orders: 1, revenue_cad: '100' },
  { month: '2025-07', store_id: 'uzoshop', gateway: 'paypal', orders: 1, revenue_cad: 50 },
  { month: '2025-07', store_id: 'uzoshop', gateway: 'gift_card', orders: 1, revenue_cad: '25.5' },
  // 2025-07 — zolplus
  { month: '2025-07', store_id: 'zolplus', gateway: 'stripe', orders: 1, revenue_cad: 200 },
  // NULL payment_gateway is COALESCE'd to '' by the RPC → categorizes 'other'.
  { month: '2025-07', store_id: 'zolplus', gateway: '', orders: 1, revenue_cad: 10 },
  // 2025-08 — uzoshop
  { month: '2025-08', store_id: 'uzoshop', gateway: 'PayPal Express Checkout', orders: 1, revenue_cad: 300 },
];

beforeEach(() => {
  mockRows = [];
  mockError = null;
  rpcCalls.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('readPaymentMethodsByMonth', () => {
  it('calls the agg_payment_methods_monthly RPC (replaces the full-table paginate scan — P0-1)', async () => {
    setRpcRows(fakeRows);
    await readPaymentMethodsByMonth();
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe('agg_payment_methods_monthly');
  });

  it('returns months in ascending order (even when the RPC returns them out of order)', async () => {
    setRpcRows([...fakeRows].reverse());
    const { months } = await readPaymentMethodsByMonth();
    expect(months.map((m) => m.month)).toEqual(['2025-07', '2025-08']);
  });

  it('aggregates per store × category with orders + revenueCad (revenue_cad)', async () => {
    setRpcRows(fakeRows);
    const { months } = await readPaymentMethodsByMonth();

    const july = months.find((m) => m.month === '2025-07')!;
    // uzoshop July: shopify_payments(credit,100), paypal(50), gift_card(other,25.5)
    expect(july.perStore.uzoshop.credit).toEqual({ orders: 1, revenueCad: 100 });
    expect(july.perStore.uzoshop.paypal).toEqual({ orders: 1, revenueCad: 50 });
    expect(july.perStore.uzoshop.other).toEqual({ orders: 1, revenueCad: 25.5 });
    // zolplus July: stripe(credit,200), ''(other,10).
    // Per-store buckets are keyed by DISPLAY NAME (STORE_NAME_BY_ID), not the
    // raw store_id — so the keys match data.stores / the global store filter
    // (the 2026-06-04 per-store-picker fix). zolplus → 'Zol Plus'.
    expect(july.perStore['Zol Plus'].credit).toEqual({ orders: 1, revenueCad: 200 });
    expect(july.perStore['Zol Plus'].paypal).toEqual({ orders: 0, revenueCad: 0 });
    expect(july.perStore['Zol Plus'].other).toEqual({ orders: 1, revenueCad: 10 });
    // Regression guard: NOT keyed by the raw id.
    expect(july.perStore.zolplus).toBeUndefined();
  });

  it('accumulates multiple raw gateways that fall in the same category', async () => {
    setRpcRows([
      { month: '2025-09', store_id: 'uzoshop', gateway: 'visa', orders: 2, revenue_cad: 80 },
      { month: '2025-09', store_id: 'uzoshop', gateway: 'stripe', orders: '3', revenue_cad: '120' },
    ]);
    const { months } = await readPaymentMethodsByMonth();
    const sep = months.find((m) => m.month === '2025-09')!;
    // visa + stripe both → credit; orders/revenue accumulate (string-coerced).
    expect(sep.perStore.uzoshop.credit).toEqual({ orders: 5, revenueCad: 200 });
    expect(sep.business.credit).toEqual({ orders: 5, revenueCad: 200 });
  });

  it('rolls up the business-wide totals across stores', async () => {
    setRpcRows(fakeRows);
    const { months } = await readPaymentMethodsByMonth();

    const july = months.find((m) => m.month === '2025-07')!;
    // business credit = uzoshop(100) + zolplus(200)
    expect(july.business.credit).toEqual({ orders: 2, revenueCad: 300 });
    expect(july.business.paypal).toEqual({ orders: 1, revenueCad: 50 });
    // business other = gift_card(25.5) + ''(10)
    expect(july.business.other).toEqual({ orders: 2, revenueCad: 35.5 });

    const aug = months.find((m) => m.month === '2025-08')!;
    // PayPal Express Checkout → paypal
    expect(aug.business.paypal).toEqual({ orders: 1, revenueCad: 300 });
    expect(aug.business.credit).toEqual({ orders: 0, revenueCad: 0 });
    expect(aug.perStore.uzoshop.paypal).toEqual({ orders: 1, revenueCad: 300 });
  });

  it('returns an empty months array when there are no rows', async () => {
    setRpcRows([]);
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
