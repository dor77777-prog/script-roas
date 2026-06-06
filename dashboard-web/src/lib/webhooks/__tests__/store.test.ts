import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as supabaseAdminMod from '@/lib/supabaseAdmin';
import {
  lookupStoreByShopDomain,
  lookupStoreByCartToken,
  insertStoreEvent,
  readRecentStoreEvents,
  readStoreEventsPaged,
} from '../store';
import type { NormalizedStoreEvent } from '../normalizeShopifyEvent';

// ---------------------------------------------------------------------------
// Supabase admin mock — a thin recorder for the query chains the readers/writer
// use. Each test seeds the result the terminal call should resolve with.
// ---------------------------------------------------------------------------
function makeAdminMock() {
  const calls: Array<{ table: string; op: string; arg?: unknown; options?: unknown }> = [];
  let selectResult: { data: unknown; error: unknown } = { data: null, error: null };
  let upsertResult: { data: unknown; error: unknown } = { data: null, error: null };
  let listResult: { data: unknown; error: unknown } = { data: null, error: null };
  let pagedResult: { data: unknown; error: unknown; count: number | null } = {
    data: null,
    error: null,
    count: null,
  };

  // readRecentStoreEvents builds: .select(cols).order(col,{ascending}).limit(n)
  // with an OPTIONAL .eq('store_id', …) inserted before .order. We model the
  // chain as a thenable builder so both shapes (with/without .eq) resolve to the
  // same `listResult`, and every link is recorded for assertions.
  function listBuilder(table: string) {
    const builder = {
      eq: vi.fn((col: string, val: unknown) => {
        calls.push({ table, op: 'list.eq', arg: { col, val } });
        return builder;
      }),
      order: vi.fn((col: string, options?: unknown) => {
        calls.push({ table, op: 'list.order', arg: col, options });
        return builder;
      }),
      limit: vi.fn((n: number) => {
        calls.push({ table, op: 'list.limit', arg: n });
        return Promise.resolve(listResult);
      }),
    };
    return builder;
  }

  // readStoreEventsPaged builds:
  //   .select(cols, { count: 'exact' })
  //     [.eq('store_id', …)] [.eq('type', …)]
  //     .gte('received_at', from).lte('received_at', to)
  //     .order('received_at', { ascending:false }).range(lo, hi)
  // → resolves to { data, error, count }. Every link is recorded.
  function pagedBuilder(table: string) {
    const builder = {
      eq: vi.fn((col: string, val: unknown) => {
        calls.push({ table, op: 'paged.eq', arg: { col, val } });
        return builder;
      }),
      gte: vi.fn((col: string, val: unknown) => {
        calls.push({ table, op: 'paged.gte', arg: { col, val } });
        return builder;
      }),
      lte: vi.fn((col: string, val: unknown) => {
        calls.push({ table, op: 'paged.lte', arg: { col, val } });
        return builder;
      }),
      order: vi.fn((col: string, options?: unknown) => {
        calls.push({ table, op: 'paged.order', arg: col, options });
        return builder;
      }),
      range: vi.fn((lo: number, hi: number) => {
        calls.push({ table, op: 'paged.range', arg: { lo, hi } });
        return Promise.resolve(pagedResult);
      }),
    };
    return builder;
  }

  const admin = {
    from: vi.fn((table: string) => ({
      select: vi.fn((cols?: unknown, options?: { count?: string }) => {
        // The paged reader signals itself by passing { count: 'exact' } as the
        // SELECT options. Route it to the paged builder so its gte/lte/range
        // chain is recorded; everything else stays on the lookup/list shape.
        if (options && options.count === 'exact') {
          calls.push({ table, op: 'paged.select', options });
          void cols;
          return pagedBuilder(table);
        }
        // Lookups use .select(<3-col string>).eq(...).maybeSingle(); the list
        // reader uses .select(<col string>).order(...).limit(...). We expose
        // BOTH `.eq().maybeSingle()` and `.order()/.limit()` off the same object
        // so a single select() mock serves every caller.
        const sel = {
          eq: vi.fn((col: string, val: unknown) => {
            // Disambiguate: the maybeSingle path is the lookup readers; the
            // order/limit path is the list reader's optional store filter.
            const lb = listBuilder(table);
            return {
              maybeSingle: vi.fn(() => {
                calls.push({ table, op: 'select.eq', arg: { col, val } });
                calls.push({ table, op: 'maybeSingle' });
                return Promise.resolve(selectResult);
              }),
              order: (...a: unknown[]) => {
                calls.push({ table, op: 'list.eq', arg: { col, val } });
                return (lb.order as (...x: unknown[]) => unknown)(...a);
              },
            };
          }),
          order: (...a: unknown[]) =>
            (listBuilder(table).order as (...x: unknown[]) => unknown)(...a),
        };
        void cols;
        return sel;
      }),
      upsert: vi.fn((rows: unknown, options?: unknown) => {
        calls.push({ table, op: 'upsert', arg: rows, options });
        return Promise.resolve(upsertResult);
      }),
    })),
  };

  return {
    admin,
    calls,
    setSelectResult: (r: { data: unknown; error: unknown }) => {
      selectResult = r;
    },
    setUpsertResult: (r: { data: unknown; error: unknown }) => {
      upsertResult = r;
    },
    setListResult: (r: { data: unknown; error: unknown }) => {
      listResult = r;
    },
    setPagedResult: (r: { data: unknown; error: unknown; count: number | null }) => {
      pagedResult = r;
    },
  };
}

let mock: ReturnType<typeof makeAdminMock>;

beforeEach(() => {
  mock = makeAdminMock();
  vi.spyOn(supabaseAdminMod, 'getSupabaseAdmin').mockReturnValue(
    mock.admin as unknown as ReturnType<typeof supabaseAdminMod.getSupabaseAdmin>,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('lookupStoreByShopDomain', () => {
  it('returns the routing row when the shop is known', async () => {
    mock.setSelectResult({
      data: { store_id: 'uzoshop', signing_secret: 'shpss_x', enabled: true },
      error: null,
    });
    const out = await lookupStoreByShopDomain('uzoshop.myshopify.com');
    expect(out).toEqual({ store_id: 'uzoshop', signing_secret: 'shpss_x', enabled: true });
    expect(mock.calls).toContainEqual({
      table: 'store_webhooks',
      op: 'select.eq',
      arg: { col: 'shop_domain', val: 'uzoshop.myshopify.com' },
    });
  });

  it('returns null when the shop is unknown', async () => {
    mock.setSelectResult({ data: null, error: null });
    const out = await lookupStoreByShopDomain('nope.myshopify.com');
    expect(out).toBeNull();
  });

  it('returns null when the query errors', async () => {
    mock.setSelectResult({ data: null, error: { message: 'boom' } });
    const out = await lookupStoreByShopDomain('uzoshop.myshopify.com');
    expect(out).toBeNull();
  });
});

describe('lookupStoreByCartToken', () => {
  it('returns the routing row for a known token', async () => {
    mock.setSelectResult({
      data: { store_id: 'zolplus', allowed_origins: ['https://zolplus.com'], enabled: true },
      error: null,
    });
    const out = await lookupStoreByCartToken('tok_123');
    expect(out).toEqual({
      store_id: 'zolplus',
      allowed_origins: ['https://zolplus.com'],
      enabled: true,
    });
    expect(mock.calls).toContainEqual({
      table: 'store_webhooks',
      op: 'select.eq',
      arg: { col: 'cart_public_token', val: 'tok_123' },
    });
  });

  it('returns null for an unknown token', async () => {
    mock.setSelectResult({ data: null, error: null });
    expect(await lookupStoreByCartToken('tok_bad')).toBeNull();
  });

  it('surfaces the disabled flag for a known-but-disabled token (route drops it)', async () => {
    mock.setSelectResult({
      data: { store_id: 'uzoshop', allowed_origins: [], enabled: false },
      error: null,
    });
    const out = await lookupStoreByCartToken('tok_off');
    expect(out).toEqual({ store_id: 'uzoshop', allowed_origins: [], enabled: false });
  });

  it('returns null when the query errors (soft-fail → route ack+drops)', async () => {
    mock.setSelectResult({ data: null, error: { message: 'boom' } });
    expect(await lookupStoreByCartToken('tok_123')).toBeNull();
  });
});

describe('insertStoreEvent', () => {
  const event: NormalizedStoreEvent = {
    store_id: 'uzoshop',
    type: 'sale',
    amount_cad: 70,
    currency: 'USD',
    amount_original: 50,
    product_title: 'Blue Widget',
    quantity: 2,
    customer_label: 'A׳ C׳',
    source: 'direct',
    occurred_at: '2026-06-01T10:00:00Z',
    dedupe_key: 'webhook:wh-1',
    raw: { id: 555 },
  };

  it('upserts with ignoreDuplicates on the dedupe_key conflict target', async () => {
    mock.setUpsertResult({ data: [{ id: 'uuid-1' }], error: null });
    await insertStoreEvent(event);
    const upsertCall = mock.calls.find((c) => c.op === 'upsert');
    expect(upsertCall).toBeDefined();
    expect(upsertCall!.table).toBe('store_events');
    expect(upsertCall!.arg).toEqual(event);
    expect(upsertCall!.options).toMatchObject({
      onConflict: 'dedupe_key',
      ignoreDuplicates: true,
    });
  });

  it('is idempotent — a duplicate dedupe_key resolves without throwing', async () => {
    // ignoreDuplicates upsert returns no error on conflict; the helper must not throw.
    mock.setUpsertResult({ data: [], error: null });
    await expect(insertStoreEvent(event)).resolves.not.toThrow();
  });
});

describe('readRecentStoreEvents (Phase 3, Task B)', () => {
  const rows = [
    { id: 'a', store_id: 'uzoshop', type: 'sale', amount_cad: 70, received_at: '2026-06-01T10:00:00Z' },
    { id: 'b', store_id: 'zolplus', type: 'refund', amount_cad: -35, received_at: '2026-06-01T09:00:00Z' },
  ];

  it('reads the latest N events newest-first (received_at DESC) with the limit applied', async () => {
    mock.setListResult({ data: rows, error: null });
    const out = await readRecentStoreEvents({ limit: 50 });
    expect(out).toEqual(rows);
    expect(mock.calls).toContainEqual({ table: 'store_events', op: 'list.limit', arg: 50 });
    const orderCall = mock.calls.find((c) => c.op === 'list.order');
    expect(orderCall).toBeDefined();
    expect(orderCall!.arg).toBe('received_at');
    expect(orderCall!.options).toMatchObject({ ascending: false });
  });

  it('applies a store_id filter when storeId is given', async () => {
    mock.setListResult({ data: [rows[0]], error: null });
    const out = await readRecentStoreEvents({ limit: 50, storeId: 'uzoshop' });
    expect(out).toEqual([rows[0]]);
    expect(mock.calls).toContainEqual({
      table: 'store_events',
      op: 'list.eq',
      arg: { col: 'store_id', val: 'uzoshop' },
    });
  });

  it('does NOT add a store_id filter when storeId is omitted', async () => {
    mock.setListResult({ data: rows, error: null });
    await readRecentStoreEvents({ limit: 50 });
    expect(mock.calls.some((c) => c.op === 'list.eq')).toBe(false);
  });

  it('returns [] (never throws) on a query error so the read route soft-fails', async () => {
    mock.setListResult({ data: null, error: { message: 'boom' } });
    const out = await readRecentStoreEvents({ limit: 50 });
    expect(out).toEqual([]);
  });

  it('returns [] when there are no rows yet', async () => {
    mock.setListResult({ data: null, error: null });
    expect(await readRecentStoreEvents({ limit: 50 })).toEqual([]);
  });
});

describe('readStoreEventsPaged (Activity tab)', () => {
  const rows = [
    { id: 'a', store_id: 'uzoshop', type: 'sale', amount_cad: 248, received_at: '2026-06-01T10:00:00Z' },
    { id: 'b', store_id: 'zolplus', type: 'refund', amount_cad: -59.9, received_at: '2026-06-01T09:00:00Z' },
  ];

  it('selects with an exact count, orders received_at DESC, and ranges by page', async () => {
    mock.setPagedResult({ data: rows, error: null, count: 130 });
    const out = await readStoreEventsPaged({
      from: '2026-05-02',
      to: '2026-06-01',
      page: 1,
      pageSize: 40,
    });
    expect(out).toEqual({ events: rows, total: 130 });
    // SELECT carried { count: 'exact' } so total is the FULL filtered count.
    expect(mock.calls).toContainEqual({
      table: 'store_events',
      op: 'paged.select',
      options: { count: 'exact' },
    });
    const orderCall = mock.calls.find((c) => c.op === 'paged.order');
    expect(orderCall).toBeDefined();
    expect(orderCall!.arg).toBe('received_at');
    expect(orderCall!.options).toMatchObject({ ascending: false });
    // page 1, pageSize 40 → range(0, 39).
    expect(mock.calls).toContainEqual({
      table: 'store_events',
      op: 'paged.range',
      arg: { lo: 0, hi: 39 },
    });
  });

  it('computes the range offset for a later page (page 3, pageSize 40 → range 80..119)', async () => {
    mock.setPagedResult({ data: rows, error: null, count: 130 });
    await readStoreEventsPaged({ from: '2026-05-02', to: '2026-06-01', page: 3, pageSize: 40 });
    expect(mock.calls).toContainEqual({
      table: 'store_events',
      op: 'paged.range',
      arg: { lo: 80, hi: 119 },
    });
  });

  it('applies the from/to window as gte/lte on received_at (to is end-of-day inclusive)', async () => {
    mock.setPagedResult({ data: rows, error: null, count: 2 });
    await readStoreEventsPaged({ from: '2026-05-31', to: '2026-06-01', page: 1, pageSize: 40 });
    const gte = mock.calls.find((c) => c.op === 'paged.gte');
    const lte = mock.calls.find((c) => c.op === 'paged.lte');
    expect(gte).toBeDefined();
    expect(lte).toBeDefined();
    expect((gte!.arg as { col: string }).col).toBe('received_at');
    // from → start of that day (00:00).
    expect((gte!.arg as { val: string }).val).toMatch(/^2026-05-31T00:00:00/);
    expect((lte!.arg as { col: string }).col).toBe('received_at');
    // to → end of that day so same-day rows are included.
    expect((lte!.arg as { val: string }).val).toMatch(/^2026-06-01T23:59:59/);
  });

  it('filters by store_id when storeId is given', async () => {
    mock.setPagedResult({ data: [rows[0]], error: null, count: 1 });
    await readStoreEventsPaged({
      from: '2026-05-02',
      to: '2026-06-01',
      storeId: 'uzoshop',
      page: 1,
      pageSize: 40,
    });
    expect(mock.calls).toContainEqual({
      table: 'store_events',
      op: 'paged.eq',
      arg: { col: 'store_id', val: 'uzoshop' },
    });
  });

  it('filters by type when type is given', async () => {
    mock.setPagedResult({ data: rows, error: null, count: 2 });
    await readStoreEventsPaged({
      from: '2026-05-02',
      to: '2026-06-01',
      type: 'refund',
      page: 1,
      pageSize: 40,
    });
    expect(mock.calls).toContainEqual({
      table: 'store_events',
      op: 'paged.eq',
      arg: { col: 'type', val: 'refund' },
    });
  });

  it('does NOT add a type filter when type is omitted', async () => {
    mock.setPagedResult({ data: rows, error: null, count: 2 });
    await readStoreEventsPaged({ from: '2026-05-02', to: '2026-06-01', page: 1, pageSize: 40 });
    expect(mock.calls.some((c) => c.op === 'paged.eq' && (c.arg as { col: string }).col === 'type')).toBe(false);
  });

  it('soft-fails to { events: [], total: 0 } on a query error', async () => {
    mock.setPagedResult({ data: null, error: { message: 'boom' }, count: null });
    const out = await readStoreEventsPaged({ from: '2026-05-02', to: '2026-06-01', page: 1, pageSize: 40 });
    expect(out).toEqual({ events: [], total: 0 });
  });

  it('returns total 0 when count is null but no error', async () => {
    mock.setPagedResult({ data: [], error: null, count: null });
    const out = await readStoreEventsPaged({ from: '2026-05-02', to: '2026-06-01', page: 1, pageSize: 40 });
    expect(out).toEqual({ events: [], total: 0 });
  });
});
