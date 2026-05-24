import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Audit fix 2026-05-24 (STA-46 + STA-47 in lib/products.ts, Phase 12.2.3).
 *
 * Pre-fix:
 *   - STA-46 (products.ts:50-67): inline DMY parseDate accepted invalid
 *     calendar dates like `31/02/2026` and silently produced `2026-02-31`
 *     (which then passed downstream lexicographic comparison). Same bug
 *     class as WR-04 that lib/dateValidation.isDate already fixed for
 *     the operator routes.
 *   - STA-47 (products.ts:110): `if (units <= 0 && revenue <= 0) continue;`
 *     dropped rows that postgresReaders.fetchProductsFromPostgres retains
 *     (line 529: `if (units <= 0 && revenue <= 0 && netRev <= 0) continue;`).
 *     Asymmetry between Sheets-reader and Postgres-reader; refund-correction
 *     rows (units=0, revenue=0, netRevenue>0) were silently dropped from
 *     the Sheets path.
 *
 * Fix:
 *   - STA-46: import `isDate` from `./dateValidation` + apply round-trip
 *     calendar validation to all three date format branches (number, ISO,
 *     DMY). Bad calendar dates return null → row skipped.
 *   - STA-47: align filter with Postgres reader at line 529:
 *     `if (units <= 0 && revenue <= 0 && (netRevenue ?? 0) <= 0) continue;`
 *
 * Consumer impact (per .planning/phases/12.2-p1-audit-fixes/12.2-03-CONSUMER-CHECK.md):
 *   - 0 runtime consumers of fetchProductsData today (Sheets-tier reader is
 *     dead code after Phase 05.7 Postgres rollout). Fix is defensive
 *     against future re-enable + shape-parity with Postgres reader.
 *   - 7 type-only consumers of ProductRow — STA-46/47 do not modify the
 *     type, so they are unaffected.
 *
 * Evidence: .planning/phases/12-codebase-audit-baseline/raw-returns/
 *   lib_state_products.json (STA-46 + STA-47).
 * Cross-ref: 12-tests-needed.md MP-34.
 */

const ORIGINAL_ENV = { ...process.env };

// State driven into the mocked google.sheets().spreadsheets.values.get().
let mockRowValues: unknown[][] = [];

// Mock googleapis so we don't actually call Google. The mock factory
// returns a sheets() factory that returns an object with
// spreadsheets.values.get() returning { data: { values: mockRowValues } }.
vi.mock('googleapis', () => {
  const sheetsFactory = () => ({
    spreadsheets: {
      values: {
        get: vi.fn(async () => ({ data: { values: mockRowValues } })),
      },
    },
  });
  // GoogleAuth class — constructor is awaited downstream, no fields read.
  class FakeGoogleAuth {
    constructor(_opts: unknown) { /* noop */ }
  }
  return {
    google: {
      sheets: sheetsFactory,
      auth: { GoogleAuth: FakeGoogleAuth },
    },
  };
});

// IMPORTANT: import AFTER the vi.mock factory above so the mocked
// googleapis is wired into products.ts at module-load time.
import { fetchProductsData } from '@/lib/products';

beforeEach(() => {
  mockRowValues = [];
  process.env.GOOGLE_CLIENT_EMAIL = 'test@example.com';
  process.env.GOOGLE_PRIVATE_KEY = 'fake-key';
  process.env.SPREADSHEET_ID = 'fake-spreadsheet-id';
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

/**
 * Helper: build a row in the products-daily sheet format expected by
 * fetchProductsData (cols A-I): date, storeId, storeName, productId,
 * productTitle, units, revenue, orders, netRevenue.
 */
function row(opts: {
  date: unknown;
  storeId?: string;
  storeName?: string;
  productId?: string;
  productTitle?: string;
  units?: number;
  revenue?: number;
  orders?: number;
  netRevenue?: number | null;
}): unknown[] {
  return [
    opts.date,
    opts.storeId ?? 'uzoshop',
    opts.storeName ?? 'uzoshop',
    opts.productId ?? 'p1',
    opts.productTitle ?? 'Product 1',
    opts.units ?? 0,
    opts.revenue ?? 0,
    opts.orders ?? 0,
    opts.netRevenue ?? null,
  ];
}

describe('products.ts STA-46 calendar validation (MP-34)', () => {
  it('STA-46: invalid DMY date 31/02/2026 is REJECTED (not silently converted to 2026-02-31)', async () => {
    // Pre-fix the DMY branch produced `2026-02-31` (month=02, day=31 — not a
    // real calendar date). Post-fix: isDate rejects this, row skipped.
    mockRowValues = [row({ date: '31/02/2026', units: 5, revenue: 100 })];
    const out = await fetchProductsData();
    expect(out.find(r => r.date === '2026-02-31')).toBeUndefined();
    expect(out).toHaveLength(0);
  });

  it('STA-46: valid DMY date 15/05/2026 IS accepted and converted to 2026-05-15', async () => {
    mockRowValues = [row({ date: '15/05/2026', units: 5, revenue: 100 })];
    const out = await fetchProductsData();
    expect(out).toHaveLength(1);
    expect(out[0].date).toBe('2026-05-15');
  });

  it('STA-46: valid ISO date 2026-05-15 IS accepted', async () => {
    mockRowValues = [row({ date: '2026-05-15', units: 5, revenue: 100 })];
    const out = await fetchProductsData();
    expect(out).toHaveLength(1);
    expect(out[0].date).toBe('2026-05-15');
  });

  it('STA-46: invalid ISO date 2026-13-01 is REJECTED', async () => {
    // Defensive — ISO branch also uses isDate now.
    mockRowValues = [row({ date: '2026-13-01', units: 5, revenue: 100 })];
    const out = await fetchProductsData();
    expect(out).toHaveLength(0);
  });
});

describe('products.ts STA-47 filter symmetry with postgresReaders (MP-34)', () => {
  it('STA-47: row with units=0 AND revenue=0 BUT netRevenue>0 IS RETAINED (refund-correction row)', async () => {
    // Pre-fix the `if (units <= 0 && revenue <= 0) continue;` dropped this
    // row. Post-fix matches postgresReaders.fetchProductsFromPostgres
    // line 529 which retains it (rows with non-zero netRevenue have real
    // signal — e.g., a refund-correction backfilled into net_revenue_cad
    // after units + gross_revenue were already 0 from the original day).
    mockRowValues = [
      row({
        date: '2026-05-15',
        units: 0,
        revenue: 0,
        netRevenue: 50,
      }),
    ];
    const out = await fetchProductsData();
    expect(out).toHaveLength(1);
    expect(out[0].netRevenue).toBe(50);
    expect(out[0].units).toBe(0);
    expect(out[0].revenue).toBe(0);
  });

  it('STA-47 regression guard: row with units=0 AND revenue=0 AND netRevenue=0 IS DROPPED (truly empty)', async () => {
    mockRowValues = [
      row({
        date: '2026-05-15',
        units: 0,
        revenue: 0,
        netRevenue: 0,
      }),
    ];
    const out = await fetchProductsData();
    expect(out).toHaveLength(0);
  });

  it('STA-47 regression guard: normal sale row (units>0, revenue>0, netRevenue>0) is RETAINED', async () => {
    mockRowValues = [
      row({
        date: '2026-05-15',
        units: 5,
        revenue: 100,
        netRevenue: 80,
      }),
    ];
    const out = await fetchProductsData();
    expect(out).toHaveLength(1);
    expect(out[0].units).toBe(5);
    expect(out[0].revenue).toBe(100);
    expect(out[0].netRevenue).toBe(80);
  });

  it('STA-47 regression guard: row with null netRevenue (legacy row before column existed) AND zero units/revenue is DROPPED', async () => {
    // The `(netRevenue ?? 0) <= 0` coalesces null → 0, so the row is
    // dropped if also units=0 and revenue=0. This matches the operator-
    // correct semantic of "row has no signal anywhere".
    mockRowValues = [
      row({
        date: '2026-05-15',
        units: 0,
        revenue: 0,
        netRevenue: null,
      }),
    ];
    const out = await fetchProductsData();
    expect(out).toHaveLength(0);
  });

  it('STA-47 regression guard: row with null netRevenue but real units/revenue is RETAINED', async () => {
    // Legacy row written before the net_revenue column existed but with
    // real sales — must still surface.
    mockRowValues = [
      row({
        date: '2026-05-15',
        units: 5,
        revenue: 100,
        netRevenue: null,
      }),
    ];
    const out = await fetchProductsData();
    expect(out).toHaveLength(1);
    expect(out[0].netRevenue).toBeNull();
    expect(out[0].units).toBe(5);
  });
});
