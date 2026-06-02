/**
 * Phase 3 — postgresReaders.fetchOrdersAttribution must read the 3 new
 * first-order columns into OrderAttributionRow.
 *
 * Pins:
 *   1. The SELECT string includes customer_id, order_created_at, is_first_order.
 *   2. The row map projects them: customerId (string|null),
 *      orderCreatedAt (string|null), isFirstOrder (boolean|null — NULL stays
 *      null, never coerced to false → guest/unflagged rows are honestly
 *      "unknown", not "returning").
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const selectSpy = vi.hoisted(() => vi.fn());
const rowData = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    from: () => ({
      select: (cols: string) => {
        selectSpy(cols);
        const q = {
          gte: () => q,
          lte: () => q,
          range: () => Promise.resolve({ data: rowData.rows, error: null }),
          then: (res: (v: { data: unknown; error: null }) => void) =>
            res({ data: rowData.rows, error: null }),
        };
        return q;
      },
    }),
  }),
}));

import { fetchOrdersAttributionFromPostgres } from '@/lib/postgresReaders';

beforeEach(() => {
  selectSpy.mockClear();
  rowData.rows = [
    {
      date: '2026-05-01', store_id: 'uzoshop', order_id: 'o-1', total_cad: 80,
      source: 'meta-paid', utm_source: null, utm_medium: null, utm_campaign: null,
      utm_content: null, fbclid_present: false, gclid_present: false, referrer: null,
      utm_id: null, utm_term: null, line_items: null,
      customer_id: '778899', order_created_at: '2026-05-01T09:30:00-04:00', is_first_order: true,
    },
    {
      date: '2026-05-01', store_id: 'uzoshop', order_id: 'o-2', total_cad: 40,
      source: 'direct', utm_source: null, utm_medium: null, utm_campaign: null,
      utm_content: null, fbclid_present: false, gclid_present: false, referrer: null,
      utm_id: null, utm_term: null, line_items: null,
      customer_id: null, order_created_at: '2026-05-01T11:00:00-04:00', is_first_order: null,
    },
  ];
});

afterEach(() => vi.clearAllMocks());

describe('fetchOrdersAttributionFromPostgres — first-order columns', () => {
  it('SELECT string requests the 3 new columns', async () => {
    await fetchOrdersAttributionFromPostgres();
    const cols = String(selectSpy.mock.calls[0][0]);
    expect(cols).toContain('customer_id');
    expect(cols).toContain('order_created_at');
    expect(cols).toContain('is_first_order');
  });

  it('maps customerId / orderCreatedAt / isFirstOrder; NULL stays null', async () => {
    const rows = await fetchOrdersAttributionFromPostgres();
    expect(rows).toHaveLength(2);

    expect(rows[0].customerId).toBe('778899');
    expect(rows[0].orderCreatedAt).toBe('2026-05-01T09:30:00-04:00');
    expect(rows[0].isFirstOrder).toBe(true);

    expect(rows[1].customerId).toBeNull();
    expect(rows[1].isFirstOrder).toBeNull(); // NOT false — unclassifiable
  });
});
