// Wave 2 (2026-06-03) — weekly cron-cohort-refresh tests.
//
// Cohort/LTV is a slow-moving strategic metric: a WEEKLY full re-aggregate of
// the Shopify Bulk order history (per store, full replace) keeps
// customer_cohort_monthly fresh without incremental double-counting. Fires
// Monday 04:00 Israel-local (DST-safe TZ prefix), off-peak.
//
// The pure orchestrator core `runCohortRefreshOnce` is extracted (mirrors
// cronTickOrchestrator's runTickOnce) so the test drives it with injected
// dependencies instead of stubbing the Inngest runtime / Shopify network /
// Supabase. The Inngest wrapper + registration are asserted separately by
// shape (cron expr + id), the same way cronWhatsapp.test.ts pins its triggers.

import { describe, it, expect, vi } from 'vitest';
import {
  cronCohortRefreshFunctions,
  runCohortRefreshOnce,
} from '../cronCohortRefresh';
import type { BulkCohortRow } from '@/lib/fetchers/shopifyBulkCohort';
import type { CohortCell } from '@/lib/cohorts/cohortAggregate';

function readCronTrigger(fn: unknown): string | undefined {
  const opts = (fn as { opts?: { triggers?: Array<{ cron?: string }> } }).opts;
  return opts?.triggers?.[0]?.cron;
}
function readFunctionId(fn: unknown): string | undefined {
  return (fn as { opts?: { id?: string } }).opts?.id;
}

describe('cron-cohort-refresh — fire-time invariants', () => {
  it('exports exactly one weekly function', () => {
    expect(cronCohortRefreshFunctions).toHaveLength(1);
  });

  it('fires weekly Monday 04:00 Israel-local (TZ-prefixed, DST-safe)', () => {
    const fn = cronCohortRefreshFunctions[0];
    const cron = readCronTrigger(fn);
    expect(cron).toContain('0 4 * * 1'); // minute 0, hour 4, Monday
    expect(cron).toMatch(/^TZ=Asia\/Jerusalem /); // DST-safe, not UTC
  });

  it('has the expected function id', () => {
    expect(readFunctionId(cronCohortRefreshFunctions[0])).toBe(
      'cron-cohort-refresh',
    );
  });
});

describe('runCohortRefreshOnce()', () => {
  // Two stores, each with their own bulk rows + ledger first-order-months.
  const bulkByStore: Record<string, BulkCohortRow[]> = {
    uzoshop: [
      { orderId: '1', createdAt: '2025-07-05T10:00:00Z', customerId: 'c1', grossNative: 100, refundNative: 10, currency: 'CAD' }, // c1 M0, net 90
      { orderId: '2', createdAt: '2025-09-05T10:00:00Z', customerId: 'c1', grossNative: 50, refundNative: 0, currency: 'CAD' }, // c1 M2, net 50
      { orderId: '3', createdAt: '2025-07-09T10:00:00Z', customerId: 'c2', grossNative: 80, refundNative: 0, currency: 'CAD' }, // c2 M0, net 80
      { orderId: '4', createdAt: '2025-08-15T10:00:00Z', customerId: null, grossNative: 30, refundNative: 0, currency: 'CAD' }, // guest → skipped
    ],
    zolplus: [
      { orderId: '9', createdAt: '2025-10-01T10:00:00Z', customerId: 'z1', grossNative: 60, refundNative: 0, currency: 'CAD' }, // z1 M0
    ],
  };
  const fomByStore: Record<string, Map<string, string>> = {
    uzoshop: new Map([['c1', '2025-07'], ['c2', '2025-07']]),
    zolplus: new Map([['z1', '2025-10']]),
  };

  function makeDeps() {
    const fetchBulkRows = vi.fn(
      async (store: string): Promise<BulkCohortRow[]> => bulkByStore[store] ?? [],
    );
    const loadFirstOrderMonths = vi.fn(
      async (store: string): Promise<Map<string, string>> => fomByStore[store] ?? new Map(),
    );
    const replaceCohortCells = vi.fn(
      async (_store: string, _cells: CohortCell[]): Promise<void> => undefined,
    );
    // identity CAD converter (all rows already CAD here)
    const cadConvert = vi.fn(
      async (amount: number, _currency: string, _dateStr: string): Promise<number | null> =>
        amount,
    );
    return { fetchBulkRows, loadFirstOrderMonths, replaceCohortCells, cadConvert };
  }

  it('refreshes every store: bulk → cadConvert → aggregate → full replace', async () => {
    const deps = makeDeps();
    const result = await runCohortRefreshOnce({
      stores: ['uzoshop', 'zolplus'],
      ...deps,
    });

    // Each store fetched + replaced exactly once.
    expect(deps.fetchBulkRows).toHaveBeenCalledTimes(2);
    expect(deps.loadFirstOrderMonths).toHaveBeenCalledTimes(2);
    expect(deps.replaceCohortCells).toHaveBeenCalledTimes(2);

    // uzoshop cells: 2025-07 M0 (c1+c2) + 2025-07 M2 (c1). Guest excluded.
    const uzoCall = deps.replaceCohortCells.mock.calls.find((c) => c[0] === 'uzoshop');
    expect(uzoCall).toBeDefined();
    const uzoCells = uzoCall![1];
    const get = (m: string, ms: number) =>
      uzoCells.find((c) => c.first_order_month === m && c.month_since === ms);
    expect(get('2025-07', 0)).toMatchObject({ active_customers: 2, orders: 2, gross_cad: 180, net_cad: 170 });
    expect(get('2025-07', 2)).toMatchObject({ active_customers: 1, orders: 1, net_cad: 50 });
    expect(uzoCells.every((c) => c.store_id === 'uzoshop')).toBe(true);

    // zolplus cells: 2025-10 M0 (z1).
    const zolCall = deps.replaceCohortCells.mock.calls.find((c) => c[0] === 'zolplus');
    const zolCells = zolCall![1];
    expect(zolCells).toHaveLength(1);
    expect(zolCells[0]).toMatchObject({ store_id: 'zolplus', first_order_month: '2025-10', month_since: 0, active_customers: 1 });

    expect(result.refreshed).toBe(2);
    expect(result.failures).toHaveLength(0);
  });

  it('omits a line when FX conversion returns null (stale > wrong)', async () => {
    const deps = makeDeps();
    // Fail conversion only for the gross/refund of order 2 (the M2 line).
    deps.cadConvert.mockImplementation(
      async (amount: number, _currency: string, _dateStr: string) =>
        amount === 50 ? null : amount,
    );
    await runCohortRefreshOnce({ stores: ['uzoshop'], ...deps });
    const uzoCells = deps.replaceCohortCells.mock.calls[0][1];
    // M2 line dropped → only the 2025-07 M0 cell survives.
    expect(uzoCells.find((c) => c.month_since === 2)).toBeUndefined();
    expect(uzoCells.find((c) => c.month_since === 0)).toBeDefined();
  });

  it('soft-fails per store: one store error does not abort the others', async () => {
    const deps = makeDeps();
    deps.fetchBulkRows.mockImplementation(async (store: string) => {
      if (store === 'uzoshop') throw new Error('bulk export 500');
      return bulkByStore[store] ?? [];
    });
    const result = await runCohortRefreshOnce({
      stores: ['uzoshop', 'zolplus'],
      ...deps,
    });
    // zolplus still replaced despite uzoshop failing.
    expect(deps.replaceCohortCells).toHaveBeenCalledTimes(1);
    expect(deps.replaceCohortCells.mock.calls[0][0]).toBe('zolplus');
    expect(result.refreshed).toBe(1);
    expect(result.failures).toEqual([
      expect.objectContaining({ store: 'uzoshop' }),
    ]);
  });
});
