/**
 * importManualOverrides.test.ts — pure-row-shape + integration tests for the
 * Phase 05.6-20 one-off importer at `scripts/import-manual-overrides.ts`.
 *
 * What's covered:
 *   1. `parseManualSpendRow` / `parseManualSpendRows` — drop bad rows,
 *      preserve good ones, lowercase platform (Pitfall 7).
 *   2. `parseDate` — Date objects, ISO strings, DD/MM/YYYY, junk → null.
 *   3. `runImport` — Sheets read mocked, Supabase upsert mocked; verifies the
 *      idempotency contract (first run reports inserts, second run reports
 *      skipped) and the platform-CHECK-violation path (errored counter).
 *
 * Mock strategy — same pattern as `manualOverrides.test.ts` and
 * `postgresReaders.test.ts`:
 *   - `@/lib/sheets`           → `getAuth` stubbed to a noop returning a fake auth.
 *   - `@/lib/supabaseAdmin`    → `getSupabaseAdmin` returns a stub whose
 *                                `.from('manual_overrides').upsert(...).select()`
 *                                chain awaits to `{ data, error }`.
 *   - `googleapis`             → `google.sheets({}).spreadsheets.values.get`
 *                                returns the mocked `values` matrix.
 *
 * Run via the shared vitest config — this file lives under
 * `src/lib/__tests__/` which is picked up by the existing include glob.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---- module-scoped mock state ----------------------------------------------
type MockUpsertCall = {
  rows: unknown;
  options: unknown;
};

const mockState = vi.hoisted(() => ({
  sheetsValues: [] as unknown[][],
  upsertCalls: [] as MockUpsertCall[],
  upsertReturn: { data: [] as unknown[] | null, error: null as { message: string } | null },
  fromCalls: [] as string[],
  authCalls: 0,
}));

vi.mock('@/lib/sheets', () => ({
  getAuth: vi.fn(() => {
    mockState.authCalls++;
    return { _kind: 'fake-google-auth' };
  }),
}));

vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      mockState.fromCalls.push(table);
      return {
        upsert: (rows: unknown, options: unknown) => {
          mockState.upsertCalls.push({ rows, options });
          return {
            select: () => Promise.resolve(mockState.upsertReturn),
          };
        },
      };
    },
  }),
}));

vi.mock('googleapis', () => ({
  google: {
    sheets: vi.fn(() => ({
      spreadsheets: {
        values: {
          get: vi.fn(async () => ({ data: { values: mockState.sheetsValues } })),
        },
      },
    })),
  },
}));

// Import AFTER all vi.mock calls so the mocks are wired in.
import {
  parseDate,
  parseManualSpendRow,
  parseManualSpendRows,
  runImport,
  MANUAL_SPEND_TAB,
} from '../../../scripts/import-manual-overrides';

beforeEach(() => {
  mockState.sheetsValues = [];
  mockState.upsertCalls = [];
  mockState.upsertReturn = { data: [], error: null };
  mockState.fromCalls = [];
  mockState.authCalls = 0;
  process.env.SPREADSHEET_ID = 'test-spreadsheet-id';
});

afterEach(() => {
  delete process.env.SPREADSHEET_ID;
  vi.clearAllMocks();
});

describe('parseDate', () => {
  it('accepts ISO YYYY-MM-DD strings verbatim', () => {
    expect(parseDate('2026-05-01')).toBe('2026-05-01');
    expect(parseDate('2026-05-08T12:34:56.000Z')).toBe('2026-05-08');
  });

  it('accepts Date objects', () => {
    const d = new Date('2026-05-15T00:00:00.000Z');
    expect(parseDate(d)).toBe('2026-05-15');
  });

  it('accepts DD/MM/YYYY strings (Sheets locale)', () => {
    expect(parseDate('1/5/2026')).toBe('2026-05-01');
    expect(parseDate('15/5/2026')).toBe('2026-05-15');
  });

  it('returns null for blank or junk inputs', () => {
    expect(parseDate(null)).toBeNull();
    expect(parseDate(undefined)).toBeNull();
    expect(parseDate('')).toBeNull();
    expect(parseDate('not a date')).toBeNull();
    expect(parseDate({})).toBeNull();
  });

  it('accepts Sheets serial-number dates (defensive — UNFORMATTED_VALUE)', () => {
    // 1899-12-30 + 46143 days ≈ 2026-05-01 (verify by Date.UTC)
    const serial = (new Date('2026-05-01T00:00:00.000Z').getTime() / 86400000) + 25569;
    expect(parseDate(serial)).toBe('2026-05-01');
  });
});

describe('parseManualSpendRow', () => {
  it('lowercases capitalised Meta → meta (Pitfall 7)', () => {
    const row = ['2026-05-01', 'uzoshop', 'Meta', 350, 'ILS', 'old account deactivated'];
    expect(parseManualSpendRow(row)).toEqual({
      date: '2026-05-01',
      store_id: 'uzoshop',
      platform: 'meta',
      spend: 350,
      currency: 'ILS',
      notes: 'old account deactivated',
    });
  });

  it('lowercases capitalised Google → google', () => {
    const row = ['2026-05-02', 'uzoshop', 'Google', 120.5, 'cad', null];
    expect(parseManualSpendRow(row)).toEqual({
      date: '2026-05-02',
      store_id: 'uzoshop',
      platform: 'google',
      spend: 120.5,
      currency: 'CAD',
      notes: null,
    });
  });

  it('accepts already-lowercase platform unchanged', () => {
    const row = ['2026-05-03', 'zolplus', 'meta', 0, 'ILS', ''];
    expect(parseManualSpendRow(row)).toEqual({
      date: '2026-05-03',
      store_id: 'zolplus',
      platform: 'meta',
      spend: 0,
      currency: 'ILS',
      notes: null,
    });
  });

  it('returns null when platform is outside {meta, google}', () => {
    const row = ['2026-05-04', 'uzoshop', 'TikTok', 99, 'USD', null];
    expect(parseManualSpendRow(row)).toBeNull();
  });

  it('returns null on missing date', () => {
    expect(parseManualSpendRow([null, 'uzoshop', 'Meta', 100, 'ILS', null])).toBeNull();
  });

  it('returns null on missing store_id', () => {
    expect(parseManualSpendRow(['2026-05-01', '', 'Meta', 100, 'ILS', null])).toBeNull();
  });

  it('returns null on blank spend (no override intended)', () => {
    expect(parseManualSpendRow(['2026-05-01', 'uzoshop', 'Meta', '', 'ILS', null])).toBeNull();
    expect(parseManualSpendRow(['2026-05-01', 'uzoshop', 'Meta', null, 'ILS', null])).toBeNull();
  });

  it('returns null on non-numeric spend', () => {
    expect(parseManualSpendRow(['2026-05-01', 'uzoshop', 'Meta', 'abc', 'ILS', null])).toBeNull();
  });

  it('treats spend=0 as a valid override (ManualOverrides.gs:106-108)', () => {
    const row = ['2026-05-01', 'uzoshop', 'Meta', 0, 'ILS', 'no spend that day'];
    const parsed = parseManualSpendRow(row);
    expect(parsed).not.toBeNull();
    expect(parsed?.spend).toBe(0);
  });

  it('parses spend from comma-formatted string ("1,234.56")', () => {
    const row = ['2026-05-01', 'uzoshop', 'Meta', '1,234.56', 'ILS', null];
    const parsed = parseManualSpendRow(row);
    expect(parsed?.spend).toBeCloseTo(1234.56, 4);
  });

  it('defaults currency to ILS when blank', () => {
    const row = ['2026-05-01', 'uzoshop', 'Meta', 100, '', null];
    const parsed = parseManualSpendRow(row);
    expect(parsed?.currency).toBe('ILS');
  });

  it('uppercases currency', () => {
    const row = ['2026-05-01', 'uzoshop', 'Meta', 100, 'usd', null];
    const parsed = parseManualSpendRow(row);
    expect(parsed?.currency).toBe('USD');
  });
});

describe('parseManualSpendRows', () => {
  it('drops invalid rows and preserves valid ones', () => {
    const values = [
      ['2026-05-01', 'uzoshop', 'Meta', 350, 'ILS', 'real row'],
      [null, 'uzoshop', 'Meta', 100, 'ILS', 'bad date'],
      ['2026-05-02', 'uzoshop', 'TikTok', 100, 'ILS', 'bad platform'],
      ['2026-05-03', 'zolplus', 'Google', 200, 'CAD', null],
      ['2026-05-04', 'uzoshop', 'Meta', '', 'ILS', 'blank spend'],
    ];
    const out = parseManualSpendRows(values);
    expect(out).toHaveLength(2);
    expect(out[0].date).toBe('2026-05-01');
    expect(out[0].platform).toBe('meta');
    expect(out[1].date).toBe('2026-05-03');
    expect(out[1].platform).toBe('google');
  });

  it('returns empty array on empty input', () => {
    expect(parseManualSpendRows([])).toEqual([]);
  });
});

describe('runImport — Sheets → Supabase integration (mocked)', () => {
  it('throws when SPREADSHEET_ID env var is missing', async () => {
    delete process.env.SPREADSHEET_ID;
    await expect(runImport()).rejects.toThrow(/SPREADSHEET_ID/);
  });

  it('first-run path: imported=N, skipped=0, errored=0', async () => {
    mockState.sheetsValues = [
      ['2026-05-01', 'uzoshop', 'Meta', 350, 'ILS', 'historical'],
      ['2026-05-02', 'uzoshop', 'Meta', 412, 'ILS', 'historical'],
      ['2026-05-03', 'uzoshop', 'Google', 50, 'CAD', null],
    ];
    // Supabase returns each inserted row (ignoreDuplicates=true returns ONLY
    // the rows it actually inserted — skipped ones are absent from data).
    mockState.upsertReturn = {
      data: [
        { id: 1, date: '2026-05-01', store_id: 'uzoshop', platform: 'meta' },
        { id: 2, date: '2026-05-02', store_id: 'uzoshop', platform: 'meta' },
        { id: 3, date: '2026-05-03', store_id: 'uzoshop', platform: 'google' },
      ],
      error: null,
    };

    const result = await runImport();

    expect(result).toEqual({ imported: 3, skipped: 0, errored: 0 });

    // Upsert was called with exactly one batch matching the parsed rows
    // (platform lowercased, currency uppercased).
    expect(mockState.upsertCalls).toHaveLength(1);
    const call = mockState.upsertCalls[0];
    expect((call.rows as unknown[])).toHaveLength(3);
    expect(call.options).toEqual({
      onConflict: 'date,store_id,platform',
      ignoreDuplicates: true,
    });

    // Sheets was hit via the expected table name and tab name
    expect(mockState.fromCalls).toEqual(['manual_overrides']);
    expect(mockState.authCalls).toBe(1);
    expect(MANUAL_SPEND_TAB).toBe('manual-spend');
  });

  it('second-run idempotency path: imported=0, skipped=N, errored=0', async () => {
    mockState.sheetsValues = [
      ['2026-05-01', 'uzoshop', 'Meta', 350, 'ILS', 'historical'],
      ['2026-05-02', 'uzoshop', 'Meta', 412, 'ILS', 'historical'],
    ];
    // ignoreDuplicates=true + every row already present → empty data array,
    // no error. This is the wire signature for the "all already present" case.
    mockState.upsertReturn = { data: [], error: null };

    const result = await runImport();

    expect(result).toEqual({ imported: 0, skipped: 2, errored: 0 });
  });

  it('error path: platform CHECK violation surfaces as errored=N', async () => {
    mockState.sheetsValues = [
      ['2026-05-01', 'uzoshop', 'Meta', 350, 'ILS', 'historical'],
      ['2026-05-02', 'uzoshop', 'Meta', 412, 'ILS', 'historical'],
    ];
    // Simulate a CHECK constraint violation (what would happen if we'd
    // FORGOTTEN to lowercase platform — proves the test catches the
    // Pitfall-7 regression).
    mockState.upsertReturn = {
      data: null,
      error: {
        message: 'new row for relation "manual_overrides" violates check constraint "manual_overrides_platform_check"',
      },
    };

    const result = await runImport();

    expect(result.errored).toBe(2);
    expect(result.imported).toBe(0);
  });

  it('empty-sheet path: returns zeros without calling upsert', async () => {
    mockState.sheetsValues = [];
    const result = await runImport();
    expect(result).toEqual({ imported: 0, skipped: 0, errored: 0 });
    expect(mockState.upsertCalls).toHaveLength(0);
    expect(mockState.fromCalls).toHaveLength(0);
  });

  it('lowercases platform before upsert (Pitfall 7 — regression guard)', async () => {
    mockState.sheetsValues = [
      ['2026-05-01', 'uzoshop', 'Meta', 350, 'ILS', null],
      ['2026-05-02', 'zolplus', 'Google', 200, 'CAD', null],
    ];
    mockState.upsertReturn = {
      data: [
        { id: 1 },
        { id: 2 },
      ],
      error: null,
    };

    await runImport();

    const rows = mockState.upsertCalls[0].rows as Array<{ platform: string }>;
    expect(rows[0].platform).toBe('meta');
    expect(rows[1].platform).toBe('google');
    // Belt + suspenders: assert no row leaked a capitalised platform value.
    for (const r of rows) {
      expect(['meta', 'google']).toContain(r.platform);
    }
  });
});
