import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Reader-side contract for the first-click (Phase 4) columns. Mirrors the
 * mock pattern in postgresReaders.test.ts (vi.mock('@/lib/supabase') with a
 * thenable query builder driven by a module-level rows holder). Asserts:
 *   1. the canonical SELECT requests every first_* column (so they are never
 *      silently dropped — a dropped column reads back undefined),
 *   2. the row map surfaces populated first-click fields onto
 *      OrderAttributionRow, and
 *   3. NULL first-click columns → null/false ("no first-click signal",
 *      explicitly NOT coerced to 'direct').
 */

// State holder the mocked client reads at call time.
let mockRows: unknown[] = [];
let mockError: { message: string } | null = null;

function setSupabaseRows(rows: unknown[]) {
  mockRows = rows;
  mockError = null;
}

vi.mock('@/lib/supabase', () => {
  const makeQuery = () => {
    const q: Record<string, unknown> = {};
    q.select = vi.fn(() => q);
    q.gte = vi.fn(() => q);
    q.lte = vi.fn(() => q);
    q.order = vi.fn(() => q);
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

import { fetchOrdersAttributionFromPostgres, ORDERS_ATTRIBUTION_SELECT } from '../postgresReaders';

const FIRST_CLICK_COLUMNS = [
  'first_touch_source',
  'first_fbclid_present',
  'first_gclid_present',
  'first_ttclid_present',
  'first_utm_source',
  'first_utm_medium',
  'first_utm_campaign',
  'first_utm_content',
  'first_utm_id',
  'first_utm_term',
  'first_seen_at',
] as const;

const fakeRows = [
  {
    date: '2026-06-02',
    store_id: 'uzoshop',
    order_id: 'o-1',
    total_cad: 100,
    source: 'google-paid',
    utm_source: 'google',
    utm_medium: 'cpc',
    utm_campaign: 'Closer',
    utm_content: 'ad-2',
    fbclid_present: false,
    gclid_present: true,
    referrer: '',
    utm_id: 'camp-2',
    utm_term: 'adset-2',
    line_items: '[]',
    first_touch_source: 'meta-paid',
    first_fbclid_present: true,
    first_gclid_present: false,
    first_ttclid_present: false,
    first_utm_source: 'facebook',
    first_utm_medium: 'cpc',
    first_utm_campaign: 'Intro',
    first_utm_content: 'ad-first-1',
    first_utm_id: 'camp-first-1',
    first_utm_term: 'adset-first-1',
    first_seen_at: '2026-06-01T10:00:00.000Z',
  },
  {
    date: '2026-06-02',
    store_id: 'uzoshop',
    order_id: 'o-2',
    total_cad: 50,
    source: 'meta-paid',
    utm_source: 'facebook',
    utm_medium: 'cpc',
    utm_campaign: 'X',
    utm_content: '',
    fbclid_present: true,
    gclid_present: false,
    referrer: '',
    utm_id: '',
    utm_term: '',
    line_items: '[]',
    // No first-click signal — all NULL.
    first_touch_source: null,
    first_fbclid_present: null,
    first_gclid_present: null,
    first_ttclid_present: null,
    first_utm_source: null,
    first_utm_medium: null,
    first_utm_campaign: null,
    first_utm_content: null,
    first_utm_id: null,
    first_utm_term: null,
    first_seen_at: null,
  },
];

beforeEach(() => {
  mockRows = [];
  mockError = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('fetchOrdersAttributionFromPostgres — first-click columns', () => {
  it('requests every first_* column in the canonical SELECT', () => {
    for (const col of FIRST_CLICK_COLUMNS) {
      expect(ORDERS_ATTRIBUTION_SELECT).toContain(col);
    }
  });

  it('surfaces populated first-click fields onto the row', async () => {
    setSupabaseRows(fakeRows);
    const rows = await fetchOrdersAttributionFromPostgres();
    const r = rows.find((x) => x.orderId === 'o-1')!;
    expect(r.firstTouchSource).toBe('meta-paid');
    expect(r.firstFbclidPresent).toBe(true);
    expect(r.firstGclidPresent).toBe(false);
    expect(r.firstTtclidPresent).toBe(false);
    expect(r.firstUtmSource).toBe('facebook');
    expect(r.firstUtmMedium).toBe('cpc');
    expect(r.firstUtmCampaign).toBe('Intro');
    expect(r.firstUtmContent).toBe('ad-first-1');
    expect(r.firstUtmId).toBe('camp-first-1');
    expect(r.firstUtmTerm).toBe('adset-first-1');
    expect(r.firstSeenAt).toBe('2026-06-01T10:00:00.000Z');
  });

  it('NULL first-click → null fields (no first-click signal, not direct)', async () => {
    setSupabaseRows(fakeRows);
    const rows = await fetchOrdersAttributionFromPostgres();
    const r = rows.find((x) => x.orderId === 'o-2')!;
    expect(r.firstTouchSource).toBeNull();
    expect(r.firstFbclidPresent).toBe(false);
    expect(r.firstGclidPresent).toBe(false);
    expect(r.firstTtclidPresent).toBe(false);
    expect(r.firstUtmSource).toBeNull();
    expect(r.firstUtmId).toBeNull();
    expect(r.firstSeenAt).toBeNull();
  });
});
