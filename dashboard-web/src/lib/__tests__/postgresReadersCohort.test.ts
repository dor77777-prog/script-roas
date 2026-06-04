/**
 * Wave 2 (Task 5) — postgresReaders.fetchCohortMonthlyFromPostgres reader-side
 * contract for the customer_cohort_monthly aggregate table.
 *
 * Mirrors the mock pattern in postgresReaders.test.ts / postgresReadersFirstClick.test.ts
 * (vi.mock('@/lib/supabase') with a thenable query builder driven by a
 * module-level rows holder + recorded .order()/.eq() calls). Asserts:
 *   1. the canonical COHORT_MONTHLY_SELECT requests every consumed column,
 *   2. a raw snake_case row maps → CohortMonthlyRow (camelCase, numerics
 *      coerced via toNumber),
 *   3. the optional { storeId } filter is pushed down as an .eq('store_id', …),
 *   4. ordering is applied (first_order_month, then month_since).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// State holder the mocked client reads at call time.
let mockRows: unknown[] = [];
let mockError: { message: string } | null = null;
const orderCalls: Array<{ column: string }> = [];
const eqCalls: Array<{ column: string; value: unknown }> = [];
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
    q.eq = vi.fn((column: string, value: unknown) => {
      eqCalls.push({ column, value });
      return q;
    });
    q.order = vi.fn((column: string) => {
      orderCalls.push({ column });
      return q;
    });
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

import { fetchCohortMonthlyFromPostgres, COHORT_MONTHLY_SELECT } from '../postgresReaders';

const COHORT_COLUMNS = [
  'store_id',
  'first_order_month',
  'month_since',
  'active_customers',
  'orders',
  'gross_cad',
  'net_cad',
] as const;

const fakeRows = [
  {
    store_id: 'uzoshop',
    first_order_month: '2025-07',
    month_since: 0,
    active_customers: 120,
    orders: 130,
    gross_cad: '12000.50', // NUMERIC may come back as string
    net_cad: 11000,
  },
  {
    store_id: 'uzoshop',
    first_order_month: '2025-07',
    month_since: 2,
    active_customers: '15', // INT may come back as string
    orders: '16',
    gross_cad: 900,
    net_cad: '850.25',
  },
];

beforeEach(() => {
  mockRows = [];
  mockError = null;
  orderCalls.length = 0;
  eqCalls.length = 0;
  selectCols.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('COHORT_MONTHLY_SELECT', () => {
  it('lists every consumed column', () => {
    for (const col of COHORT_COLUMNS) {
      expect(COHORT_MONTHLY_SELECT).toContain(col);
    }
  });
});

describe('fetchCohortMonthlyFromPostgres', () => {
  it('requests the canonical SELECT', async () => {
    setSupabaseRows(fakeRows);
    await fetchCohortMonthlyFromPostgres();
    expect(selectCols[0]).toBe(COHORT_MONTHLY_SELECT);
  });

  it('maps a raw row → CohortMonthlyRow (camelCase, numbers coerced)', async () => {
    setSupabaseRows(fakeRows);
    const rows = await fetchCohortMonthlyFromPostgres();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      storeId: 'uzoshop',
      firstOrderMonth: '2025-07',
      monthSince: 0,
      activeCustomers: 120,
      orders: 130,
      grossCad: 12000.5,
      netCad: 11000,
    });
    // String-typed numerics coerced to numbers.
    expect(rows[1].activeCustomers).toBe(15);
    expect(rows[1].orders).toBe(16);
    expect(rows[1].grossCad).toBe(900);
    expect(rows[1].netCad).toBe(850.25);
    expect(rows[1].monthSince).toBe(2);
  });

  it('maps raw store_id → display name (A1: matches the scope selector + every sibling reader)', async () => {
    // BUG (2026-06-04): the cohort reader was the ONLY reader emitting the raw
    // store_id. The scope selector + global filter use DISPLAY names
    // (data.stores = 'uzoshop' / 'Zol Plus' / '360usmile'), so scoping to
    // zolplus/usmile360 matched 0 rows → an all-zero tab for 2/3 stores.
    setSupabaseRows([
      { store_id: 'zolplus', first_order_month: '2025-07', month_since: 0, active_customers: 10, orders: 10, gross_cad: 100, net_cad: 90 },
      { store_id: 'usmile360', first_order_month: '2025-07', month_since: 0, active_customers: 5, orders: 5, gross_cad: 50, net_cad: 45 },
      { store_id: 'uzoshop', first_order_month: '2025-07', month_since: 0, active_customers: 20, orders: 20, gross_cad: 200, net_cad: 180 },
    ]);
    const rows = await fetchCohortMonthlyFromPostgres();
    expect(rows.map((r) => r.storeId)).toEqual(['Zol Plus', '360usmile', 'uzoshop']);
  });

  it('orders by first_order_month then month_since', async () => {
    setSupabaseRows(fakeRows);
    await fetchCohortMonthlyFromPostgres();
    expect(orderCalls.map((c) => c.column)).toEqual(['first_order_month', 'month_since']);
  });

  it('does NOT filter by store when storeId is omitted', async () => {
    setSupabaseRows(fakeRows);
    await fetchCohortMonthlyFromPostgres();
    expect(eqCalls).toHaveLength(0);
  });

  it('pushes down the optional store filter as .eq(store_id, …)', async () => {
    setSupabaseRows(fakeRows);
    await fetchCohortMonthlyFromPostgres({ storeId: 'zolplus' });
    expect(eqCalls).toEqual([{ column: 'store_id', value: 'zolplus' }]);
  });

  it('throws a namespaced error on a Supabase failure', async () => {
    mockError = { message: 'boom' };
    await expect(fetchCohortMonthlyFromPostgres()).rejects.toThrow(
      /postgresReaders\.fetchCohortMonthly: boom/,
    );
  });
});
