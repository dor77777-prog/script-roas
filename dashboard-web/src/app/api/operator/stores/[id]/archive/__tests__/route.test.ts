import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Self-serve stores Phase 6b — Task 1: POST /api/operator/stores/[id]/archive.
//
// SAFE / REVERSIBLE: flips ONLY the `stores` row's status -> 'archived' (plus
// archived_at = now()). NEVER touches any DATA table. ZERO REGRESSION: the live
// stores must be unaffected — getStores/loadActiveStoreIds already exclude
// archived rows, so archiving one store auto-drops it from live + crons. The
// final block here asserts that exclusion as a guard.
//
// In-memory fake of the Supabase admin client: `db` records every `stores`
// update so each test asserts EXACTLY what hit the table (and that NO other
// table is ever written).
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({
  storesUpdates: [] as Row[],
  // any write to a NON-stores table is a bug for archive (status flip only)
  otherTableWrites: [] as Array<{ table: string; row: Row }>,
  existingStoreIds: ['mystore'] as string[],
  throwOnStoresUpdate: false as boolean,
}));

vi.mock('@/lib/supabaseAdmin', () => {
  function fromTable(table: string) {
    return {
      update: (row: Row) => ({
        eq: (_col: string, _val: unknown) => {
          if (table === 'stores') {
            if (db.throwOnStoresUpdate) return Promise.resolve({ error: { message: 'boom stores' } });
            db.storesUpdates.push(row);
          } else {
            db.otherTableWrites.push({ table, row });
          }
          return Promise.resolve({ error: null });
        },
      }),
      select: (_cols: string) => ({
        eq: (col: string, val: unknown) => ({
          maybeSingle: () => {
            if (table === 'stores' && col === 'id') {
              return Promise.resolve({
                data: db.existingStoreIds.includes(String(val))
                  ? { id: val, status: 'active' }
                  : null,
                error: null,
              });
            }
            return Promise.resolve({ data: null, error: null });
          },
        }),
      }),
    };
  }
  return { getSupabaseAdmin: () => ({ from: (t: string) => fromTable(t) }) };
});

vi.mock('@/lib/sentry/capture', () => ({ captureRouteError: () => {} }));

import { POST } from '../route';

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}
function archive(id: string) {
  return POST(new Request(`http://x/api/operator/stores/${id}/archive`, { method: 'POST' }), ctx(id));
}

beforeEach(() => {
  db.storesUpdates = [];
  db.otherTableWrites = [];
  db.existingStoreIds = ['mystore'];
  db.throwOnStoresUpdate = false;
});

describe('POST /api/operator/stores/[id]/archive', () => {
  it('sets status=archived + archived_at + updated_at on the stores row (200), no other table touched', async () => {
    const res = await archive('mystore');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.store).toMatchObject({ storeId: 'mystore', status: 'archived' });
    expect(db.storesUpdates).toHaveLength(1);
    expect(db.storesUpdates[0]).toMatchObject({ status: 'archived' });
    expect(db.storesUpdates[0].archived_at).toBeTruthy();
    expect(db.storesUpdates[0].updated_at).toBeTruthy();
    // SAFE: only the stores row was touched.
    expect(db.otherTableWrites).toHaveLength(0);
  });

  it('404 when the store does not exist (no write)', async () => {
    const res = await archive('ghost');
    expect(res.status).toBe(404);
    expect(db.storesUpdates).toHaveLength(0);
    expect(db.otherTableWrites).toHaveLength(0);
  });

  it('400 for the reserved __global__ id (no write)', async () => {
    const res = await archive('__global__');
    expect(res.status).toBe(400);
    expect(db.storesUpdates).toHaveLength(0);
  });

  it('idempotent: archiving an already-archived store still returns 200', async () => {
    // first archive
    await archive('mystore');
    db.storesUpdates = [];
    // second archive (the store still exists; status flip is idempotent)
    const res = await archive('mystore');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.store).toMatchObject({ status: 'archived' });
    expect(db.storesUpdates[0]).toMatchObject({ status: 'archived' });
  });

  it('500 on a DB write error — no secret leaked', async () => {
    db.throwOnStoresUpdate = true;
    const res = await archive('mystore');
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('boom stores');
  });

  it('NEVER echoes a secret/ciphertext in the response', async () => {
    const res = await archive('mystore');
    const text = await res.text();
    expect(text).not.toContain('ciphertext');
    expect(text).not.toContain('signing_secret');
    expect(text).not.toContain('"iv"');
    expect(text).not.toContain('"tag"');
  });
});

// ---------------------------------------------------------------------------
// ZERO-REGRESSION guard: archiving removes the store from the live list + the
// cron store list. getStores() (default) and loadActiveStoreIds() must EXCLUDE
// status='archived' — so an archived store auto-drops from home/totals/goal +
// the cron loop, and restore re-adds it. (Filter lives in getStores.)
// ---------------------------------------------------------------------------
describe('archive auto-drops from live + crons (getStores/loadActiveStoreIds exclude archived)', () => {
  it('getStores() excludes archived; loadActiveStoreIds() returns only active ids', async () => {
    vi.resetModules();
    const sdb = { data: null as null | unknown[], error: null as null | { message: string } };
    vi.doMock('@/lib/supabase', () => ({
      getSupabase: () => ({ from: () => ({ select: () => Promise.resolve({ data: sdb.data, error: sdb.error }) }) }),
    }));
    const { getStores, loadActiveStoreIds } = await import('@/lib/getStores');
    sdb.data = [
      { id: 'live1', name: 'L1', brand_color: null, is_headless: false, has_tiktok: false, status: 'active', display_order: 1 },
      { id: 'gone', name: 'G', brand_color: null, is_headless: false, has_tiktok: false, status: 'archived', display_order: 2 },
      { id: 'live2', name: 'L2', brand_color: null, is_headless: false, has_tiktok: false, status: 'active', display_order: 3 },
    ];
    expect((await getStores()).map((s) => s.storeId)).toEqual(['live1', 'live2']);
    expect(await loadActiveStoreIds()).toEqual(['live1', 'live2']);
    // includeArchived opt-in still surfaces the archived store (restore path / lists)
    expect((await getStores({ includeArchived: true })).map((s) => s.storeId)).toEqual(['live1', 'gone', 'live2']);
    vi.doUnmock('@/lib/supabase');
    vi.resetModules();
  });
});
