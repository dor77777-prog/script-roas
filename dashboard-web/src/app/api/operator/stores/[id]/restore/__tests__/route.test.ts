import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Self-serve stores Phase 6b — Task 1: POST /api/operator/stores/[id]/restore.
//
// SAFE / REVERSIBLE: flips ONLY the `stores` row's status -> 'active' (and
// archived_at -> null). NEVER touches any DATA table. Restore re-adds the store
// to the live list + crons (getStores/loadActiveStoreIds include active rows).
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({
  storesUpdates: [] as Row[],
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
                  ? { id: val, status: 'archived' }
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
function restore(id: string) {
  return POST(new Request(`http://x/api/operator/stores/${id}/restore`, { method: 'POST' }), ctx(id));
}

beforeEach(() => {
  db.storesUpdates = [];
  db.otherTableWrites = [];
  db.existingStoreIds = ['mystore'];
  db.throwOnStoresUpdate = false;
});

describe('POST /api/operator/stores/[id]/restore', () => {
  it('sets status=active + archived_at=null + updated_at on the stores row (200), no other table touched', async () => {
    const res = await restore('mystore');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.store).toMatchObject({ storeId: 'mystore', status: 'active' });
    expect(db.storesUpdates).toHaveLength(1);
    expect(db.storesUpdates[0]).toMatchObject({ status: 'active', archived_at: null });
    expect(db.storesUpdates[0].updated_at).toBeTruthy();
    expect(db.otherTableWrites).toHaveLength(0);
  });

  it('404 when the store does not exist (no write)', async () => {
    const res = await restore('ghost');
    expect(res.status).toBe(404);
    expect(db.storesUpdates).toHaveLength(0);
    expect(db.otherTableWrites).toHaveLength(0);
  });

  it('400 for the reserved __global__ id (no write)', async () => {
    const res = await restore('__global__');
    expect(res.status).toBe(400);
    expect(db.storesUpdates).toHaveLength(0);
  });

  it('idempotent: restoring an already-active store still returns 200', async () => {
    await restore('mystore');
    db.storesUpdates = [];
    const res = await restore('mystore');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.store).toMatchObject({ status: 'active' });
    expect(db.storesUpdates[0]).toMatchObject({ status: 'active', archived_at: null });
  });

  it('500 on a DB write error — no secret leaked', async () => {
    db.throwOnStoresUpdate = true;
    const res = await restore('mystore');
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('boom stores');
  });

  it('NEVER echoes a secret/ciphertext in the response', async () => {
    const res = await restore('mystore');
    const text = await res.text();
    expect(text).not.toContain('ciphertext');
    expect(text).not.toContain('signing_secret');
    expect(text).not.toContain('"iv"');
    expect(text).not.toContain('"tag"');
  });
});
