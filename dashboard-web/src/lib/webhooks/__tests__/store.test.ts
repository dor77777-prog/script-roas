import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as supabaseAdminMod from '@/lib/supabaseAdmin';
import {
  lookupStoreByShopDomain,
  lookupStoreByCartToken,
  insertStoreEvent,
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

  const admin = {
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn((col: string, val: unknown) => {
          calls.push({ table, op: 'select.eq', arg: { col, val } });
          return {
            maybeSingle: vi.fn(() => {
              calls.push({ table, op: 'maybeSingle' });
              return Promise.resolve(selectResult);
            }),
          };
        }),
      })),
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
