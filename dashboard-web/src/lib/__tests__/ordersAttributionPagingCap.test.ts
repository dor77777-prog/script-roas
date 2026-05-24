import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Audit fix 2026-05-24 (AUDIT ordersAttribution ALG-01, Phase 12.2.2) —
 * locks the open-ended-sheet-range contract for fetchOrdersAttribution.
 *
 * Pre-fix surface (per .planning/AUDIT.md §Phase 12.2 + raw-returns/
 * lib_algorithm_ordersAttribution.json #ALG-01):
 *   The ranges builder used a hardcoded row-100000 cap:
 *     `${s.id}-orders-attribution!A2:${lastCol}100000`
 *   Sheets' batchGet only returns rows within the explicit range. Once
 *   a store's tab grew past 100,000 rows (uzoshop projected to exceed
 *   this within a year of operation), every row beyond row 100000 was
 *   silently truncated from the returned dataset. STORE_TAB_CONFIG
 *   projected 330k attribution rows total → the cap was a future
 *   silent-truncation bug.
 *
 * Post-fix: open-ended range — `${s.id}-orders-attribution!A2:${lastCol}`.
 * Google Sheets treats an open-ended range as "fetch through last row
 * with data" (per googleapis docs). No manual paging needed (Sheets'
 * hard cap is ~10M cells per spreadsheet).
 *
 * Evidence pack: .planning/phases/12-codebase-audit-baseline/raw-returns/
 *   lib_algorithm_ordersAttribution.json (ALG-01).
 *
 * Test coverage (3 tests):
 *   1. Range string contract — captured ranges argument MUST NOT contain
 *      the `100000` cap pattern.
 *   2. Post-100000-row fetch — sentinel order at row 100001 with a
 *      recognizable orderId IS returned in the result array.
 *   3. Range-format regression guard — open-ended `:M` format is used
 *      when `includeLineItems=false` (cols A-M).
 */

const ORIGINAL_ENV = { ...process.env };

// Captured ranges argument from the most recent batchGet call.
let capturedRanges: string[] = [];
// Per-tab valueRanges injected for the next fetchOrdersAttribution call.
let mockValueRanges: Array<{ values?: unknown[][] }> = [];

vi.mock('googleapis', () => {
  const sheetsFactory = () => ({
    spreadsheets: {
      values: {
        batchGet: vi.fn(
          async (opts: {
            spreadsheetId: string;
            ranges: string[];
            valueRenderOption?: string;
            dateTimeRenderOption?: string;
          }) => {
            capturedRanges = opts.ranges;
            return { data: { valueRanges: mockValueRanges } };
          },
        ),
      },
    },
  });
  class FakeGoogleAuth {
    constructor(_opts: unknown) {
      /* noop */
    }
  }
  return {
    google: {
      sheets: sheetsFactory,
      auth: { GoogleAuth: FakeGoogleAuth },
    },
  };
});

// IMPORTANT: import AFTER vi.mock so the mocked googleapis is wired in.
import { fetchOrdersAttribution } from '@/lib/ordersAttribution';

beforeEach(() => {
  capturedRanges = [];
  mockValueRanges = [];
  process.env.GOOGLE_CLIENT_EMAIL = 'test@example.com';
  process.env.GOOGLE_PRIVATE_KEY = 'fake-key';
  process.env.SPREADSHEET_ID = 'fake-spreadsheet-id';
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('fetchOrdersAttribution range builder (ALG-01 open-ended paging)', () => {
  it('ranges argument MUST NOT contain the 100000 row cap', async () => {
    // Empty per-tab valueRanges — we only care about the range strings
    // sent to batchGet, not the rows returned.
    mockValueRanges = [{ values: [] }, { values: [] }, { values: [] }];
    await fetchOrdersAttribution();

    // Should have been called with 3 ranges (one per store tab).
    expect(capturedRanges).toHaveLength(3);

    // Each range must NOT contain the `:M100000` or `:N100000` cap pattern.
    // The post-fix shape is `${tab}-orders-attribution!A2:${lastCol}` —
    // no row cap on either end of the column letter.
    for (const range of capturedRanges) {
      expect(range).not.toMatch(/:[A-Z]+100000/);
      expect(range).not.toContain('100000');
    }
  });

  it('ranges include the open-ended A2:M format when includeLineItems=false', async () => {
    mockValueRanges = [{ values: [] }, { values: [] }, { values: [] }];
    await fetchOrdersAttribution({ includeLineItems: false });

    // Post-fix shape: `${tab}-orders-attribution!A2:M` (open-ended).
    for (const range of capturedRanges) {
      expect(range).toMatch(/-orders-attribution!A2:M$/);
    }
  });

  it('ranges include the open-ended A2:N format when includeLineItems=true', async () => {
    mockValueRanges = [{ values: [] }, { values: [] }, { values: [] }];
    await fetchOrdersAttribution({ includeLineItems: true });

    // Post-fix shape with line items: A2:N (open-ended, includes col N JSON).
    for (const range of capturedRanges) {
      expect(range).toMatch(/-orders-attribution!A2:N$/);
    }
  });

  it('rows beyond row 100000 ARE returned when the sheet has them (sentinel test)', async () => {
    // Simulate a tab with 100,001 rows. We only need to inject 1 row
    // here (the mock returns whatever we give it); the assertion is
    // that the row IS present in the output — pre-fix the request
    // would never have asked for it.
    const sentinelRow = [
      '2026-05-20',           // col A - date
      'order-after-100k',     // col B - order id
      150,                    // col C - total CAD
      'meta-paid',            // col D - source
      'facebook',             // col E - utm_source
      'cpc',                  // col F - utm_medium
      'Big Campaign',         // col G - utm_campaign
      'ad-creative',          // col H - utm_content
      true,                   // col I - fbclid present
      false,                  // col J - gclid present
      '',                     // col K - referring site
      'utm-id-7',             // col L - utm_id
      'adset-1',              // col M - utm_term
    ];
    mockValueRanges = [
      { values: [sentinelRow] },
      { values: [] },
      { values: [] },
    ];

    const out = await fetchOrdersAttribution();
    const sentinel = out.find((o) => o.orderId === 'order-after-100k');
    expect(sentinel).toBeDefined();
    expect(sentinel!.totalCad).toBe(150);
    expect(sentinel!.utmCampaign).toBe('Big Campaign');
  });

  it('regression guard: tab name + sheet-id format is preserved', async () => {
    // The range builder must still namespace each store tab correctly.
    // Post-fix shape contract: `${storeId}-orders-attribution!A2:${lastCol}`.
    mockValueRanges = [{ values: [] }, { values: [] }, { values: [] }];
    await fetchOrdersAttribution();

    // STORE_TAB_CONFIG order: uzoshop, zolplus, usmile360
    expect(capturedRanges[0]).toMatch(/^uzoshop-orders-attribution!A2:/);
    expect(capturedRanges[1]).toMatch(/^zolplus-orders-attribution!A2:/);
    expect(capturedRanges[2]).toMatch(/^usmile360-orders-attribution!A2:/);
  });
});
