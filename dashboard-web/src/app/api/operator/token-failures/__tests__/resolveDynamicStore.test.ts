// 2026-06-11 (MT-0, multi-tenant readiness audit) — regression pins for the
// token_failures hardcoded-3-store bug.
//
// The bug had three layers: a DB CHECK (store_id IN the 3 founding stores —
// dropped by migration 20260611120000), a hardcoded validStores list in this
// route's POST (a 4th store's failure rows could never be resolved from the
// operator console), and a narrow TokenFailureStore union whose `as` casts
// let dynamic store ids through TS only to die on the DB CHECK at runtime —
// silently, because alerting errors are deliberately swallowed.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const resolveTokenFailure = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock('@/lib/notifications/tokenFailures', () => ({
  resolveTokenFailure: (...args: unknown[]) => resolveTokenFailure(...args),
}));
vi.mock('@/lib/sentry/capture', () => ({ captureRouteError: vi.fn() }));

describe('operator token-failures resolve — dynamic (self-serve) store ids', () => {
  beforeEach(() => {
    resolveTokenFailure.mockClear();
  });

  it('resolves a failure row for a store that is NOT one of the 3 founding stores', async () => {
    const { POST } = await import('../route');
    const res = await POST(
      new Request('http://test/api/operator/token-failures', {
        method: 'POST',
        body: JSON.stringify({
          action: 'resolve',
          provider: 'meta',
          store_id: 'brand-new-wizard-store',
          operation: 'access_token',
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(resolveTokenFailure).toHaveBeenCalledWith(
      'meta',
      'brand-new-wizard-store',
      'access_token',
    );
  });

  it('still rejects an empty store_id and unknown providers', async () => {
    const { POST } = await import('../route');
    const empty = await POST(
      new Request('http://test/api/operator/token-failures', {
        method: 'POST',
        body: JSON.stringify({ action: 'resolve', provider: 'meta', store_id: '', operation: 'x' }),
      }),
    );
    expect(empty.status).toBe(400);
    const badProvider = await POST(
      new Request('http://test/api/operator/token-failures', {
        method: 'POST',
        body: JSON.stringify({ action: 'resolve', provider: 'nope', store_id: 's', operation: 'x' }),
      }),
    );
    expect(badProvider.status).toBe(400);
    expect(resolveTokenFailure).not.toHaveBeenCalled();
  });

  it('source pins: no hardcoded store list in the route, TokenFailureStore is string, migration exists', () => {
    const route = readFileSync(resolve(__dirname, '..', 'route.ts'), 'utf8');
    expect(route).not.toMatch(/validStores/);
    expect(route).not.toMatch(/'uzoshop'/);

    const lib = readFileSync(
      resolve(__dirname, '../../../../../lib/notifications/tokenFailures.ts'),
      'utf8',
    );
    expect(lib).toMatch(/export type TokenFailureStore = string;/);

    const migration = readFileSync(
      resolve(
        __dirname,
        '../../../../../../../supabase/migrations/20260611120000_token_failures_drop_store_check.sql',
      ),
      'utf8',
    );
    expect(migration).toMatch(/DROP CONSTRAINT/);
    expect(migration).toMatch(/token_failures_store_id_nonempty/);
  });
});
