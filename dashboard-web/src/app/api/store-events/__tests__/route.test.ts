import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import * as storeMod from '@/lib/webhooks/store';
import type { StoreEventRow } from '@/lib/webhooks/store';

import { GET } from '../route';

// ---------------------------------------------------------------------------
// Read-route test. We mock the DB boundary (readRecentStoreEvents) so the suite
// stays hermetic — the route's job is shape + filter wiring + soft-fail, which
// is what we assert here.
// ---------------------------------------------------------------------------

const sampleRows: StoreEventRow[] = [
  {
    id: 'a',
    store_id: 'uzoshop',
    type: 'sale',
    amount_cad: 248,
    currency: 'CAD',
    amount_original: 248,
    product_title: 'Hair Serum',
    quantity: 2,
    customer_label: 'A׳ C׳',
    source: null,
    occurred_at: '2026-06-01T10:00:00Z',
    received_at: '2026-06-01T10:00:05Z',
  },
  {
    id: 'b',
    store_id: 'zolplus',
    type: 'refund',
    amount_cad: -59.9,
    currency: 'CAD',
    amount_original: -59.9,
    product_title: 'Salmon Set',
    quantity: 1,
    customer_label: null,
    source: null,
    occurred_at: '2026-06-01T09:00:00Z',
    received_at: '2026-06-01T09:00:02Z',
  },
];

function makeReq(query = ''): Request {
  return new Request(`https://example.com/api/store-events${query}`);
}

let readSpy: MockInstance<typeof storeMod.readRecentStoreEvents>;
let pagedSpy: MockInstance<typeof storeMod.readStoreEventsPaged>;

beforeEach(() => {
  readSpy = vi.spyOn(storeMod, 'readRecentStoreEvents').mockResolvedValue(sampleRows);
  pagedSpy = vi
    .spyOn(storeMod, 'readStoreEventsPaged')
    .mockResolvedValue({ events: sampleRows, total: 130 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/store-events', () => {
  it('returns { events, serverNow, lastReceivedAt } with the latest rows', async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      events: StoreEventRow[];
      serverNow: string;
      lastReceivedAt: string | null;
    };
    expect(body.events).toEqual(sampleRows);
    // serverNow is a valid ISO timestamp.
    expect(Number.isNaN(Date.parse(body.serverNow))).toBe(false);
    // lastReceivedAt is the newest row's received_at (rows are newest-first).
    expect(body.lastReceivedAt).toBe('2026-06-01T10:00:05Z');
  });

  it('caps the read at 50 newest-first', async () => {
    await GET(makeReq());
    expect(readSpy).toHaveBeenCalledWith({ limit: 50, storeId: undefined });
  });

  it('passes the ?store= filter through to the reader', async () => {
    await GET(makeReq('?store=uzoshop'));
    expect(readSpy).toHaveBeenCalledWith({ limit: 50, storeId: 'uzoshop' });
  });

  it('treats ?store=All as no filter', async () => {
    await GET(makeReq('?store=All'));
    expect(readSpy).toHaveBeenCalledWith({ limit: 50, storeId: undefined });
  });

  it('lastReceivedAt is null when there are no events', async () => {
    readSpy.mockResolvedValue([]);
    const res = await GET(makeReq());
    const body = (await res.json()) as { events: StoreEventRow[]; lastReceivedAt: string | null };
    expect(body.events).toEqual([]);
    expect(body.lastReceivedAt).toBeNull();
  });

  it('soft-fails to an empty feed (HTTP 200) if the reader throws', async () => {
    readSpy.mockRejectedValue(new Error('db down'));
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: StoreEventRow[]; lastReceivedAt: string | null };
    expect(body.events).toEqual([]);
    expect(body.lastReceivedAt).toBeNull();
  });

  it('does NOT touch the paged reader in the legacy (no-page) mode', async () => {
    await GET(makeReq('?store=uzoshop'));
    expect(pagedSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Activity-tab PAGED mode — engaged only when a `page` param is present. The
// legacy feed shape above must stay untouched (asserted by the no-`total`/
// no-`lastReceivedAt` checks).
// ---------------------------------------------------------------------------
describe('GET /api/store-events — paged mode (Activity tab)', () => {
  it('returns { events, total, page, pageSize, serverNow } and uses readStoreEventsPaged', async () => {
    const res = await GET(makeReq('?page=1'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      events: StoreEventRow[];
      total: number;
      page: number;
      pageSize: number;
      serverNow: string;
      lastReceivedAt?: unknown;
    };
    expect(pagedSpy).toHaveBeenCalledTimes(1);
    expect(readSpy).not.toHaveBeenCalled();
    expect(body.events).toEqual(sampleRows);
    expect(body.total).toBe(130);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(40); // default pageSize
    expect(Number.isNaN(Date.parse(body.serverNow))).toBe(false);
    // The paged shape must NOT carry the legacy feed's lastReceivedAt field.
    expect(body.lastReceivedAt).toBeUndefined();
  });

  it('defaults the window to the last 30 days when from/to are absent', async () => {
    await GET(makeReq('?page=1'));
    const arg = pagedSpy.mock.calls[0][0];
    // from is 30 calendar days before to (both YYYY-MM-DD).
    expect(arg.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(arg.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const days = (Date.parse(`${arg.to}T00:00:00Z`) - Date.parse(`${arg.from}T00:00:00Z`)) / 86_400_000;
    expect(days).toBe(30);
  });

  it('threads from/to/store/type/page/pageSize into the paged reader', async () => {
    await GET(makeReq('?page=3&pageSize=25&from=2026-05-31&to=2026-06-01&store=zolplus&type=refund'));
    expect(pagedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        from: '2026-05-31',
        to: '2026-06-01',
        storeId: 'zolplus',
        type: 'refund',
        page: 3,
        pageSize: 25,
      }),
    );
  });

  it('treats type=all and unknown types as no filter', async () => {
    await GET(makeReq('?page=1&type=all'));
    expect(pagedSpy.mock.calls[0][0].type).toBeUndefined();
    pagedSpy.mockClear();
    await GET(makeReq('?page=1&type=bogus'));
    expect(pagedSpy.mock.calls[0][0].type).toBeUndefined();
  });

  it('clamps pageSize to 100 and coerces a non-positive page to 1', async () => {
    await GET(makeReq('?page=0&pageSize=9999'));
    const arg = pagedSpy.mock.calls[0][0];
    expect(arg.page).toBe(1);
    expect(arg.pageSize).toBe(100);
  });

  it('ignores malformed from/to and falls back to the default window', async () => {
    await GET(makeReq('?page=1&from=notadate&to=alsobad'));
    const arg = pagedSpy.mock.calls[0][0];
    const days = (Date.parse(`${arg.to}T00:00:00Z`) - Date.parse(`${arg.from}T00:00:00Z`)) / 86_400_000;
    expect(days).toBe(30);
  });

  it('soft-fails to an empty page (HTTP 200) if the paged reader throws', async () => {
    pagedSpy.mockRejectedValue(new Error('db down'));
    const res = await GET(makeReq('?page=2'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: StoreEventRow[]; total: number };
    expect(body.events).toEqual([]);
    expect(body.total).toBe(0);
  });
});
