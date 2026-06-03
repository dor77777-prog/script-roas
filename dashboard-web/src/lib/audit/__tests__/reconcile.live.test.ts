import { describe, it, expect } from 'vitest';
import { reconcileWindow, type Violation } from '../reconcile';
import { netAdjustFactor } from '@/lib/home/revenueBasis';
import {
  computeNewCustomerMetrics,
  type FirstOrderInput,
} from '@/lib/home/newCustomerMetrics';

const BASE = process.env.AUDIT_BASE_URL ?? 'https://roas-dashboard-smoky.vercel.app';
const WINDOWS = [
  { from: '2026-05-01', to: '2026-05-26' },
  { from: '2026-05-20', to: '2026-05-26' },
];
// Real storeName values as returned by the API (confirmed via Step 0 curl):
//   '360usmile', 'Zol Plus', 'uzoshop'
// 'All' is a virtual sentinel — rows are filtered client-side by byStore().
const STORES = ['All', 'uzoshop', 'Zol Plus', '360usmile'];

// Cache-buster: the API routes use Next.js ISR (`revalidate=60`) keyed by full
// URL. Right after a backfill, the same URL can serve a stale snapshot (cached
// mid-write), producing false cross-source violations. A unique `_cb` param per
// run forces a cache miss → fresh Supabase read. Without this the harness can
// report stale-cache false-positives for minutes after any write.
const CB = `_cb=${Date.now()}-${Math.random().toString(36).slice(2)}`;
function bust(path: string): string {
  return path.includes('?') ? `${path}&${CB}` : `${path}?${CB}`;
}

async function getJson(path: string): Promise<{ rows?: unknown[]; [k: string]: unknown }> {
  const r = await fetch(`${BASE}${bust(path)}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json() as Promise<{ rows?: unknown[] }>;
}

// AUDIT_LIVE gates this so normal `npm test` / pre-push never hit prod.
describe.skipIf(!process.env.AUDIT_LIVE)('LIVE reconciliation against production', () => {
  it('every (window × store) is self-consistent', { timeout: 180_000 }, async () => {
    const allViolations: Array<{ window: string; store: string; v: Violation[] }> = [];
    for (const w of WINDOWS) {
      for (const store of STORES) {
        const storeQ = `&store=${store === 'All' ? 'All' : encodeURIComponent(store)}`;
        // /api/data does not support store filtering — all stores are always returned;
        // byStore() handles per-store slicing client-side.
        const [data, campaigns, products, orders] = await Promise.all([
          // All four routes parse `from`/`to` via parseRangeParams (NOT range.from/range.to).
          // Using range.from previously fell through to a silent default 90-day window — since the
          // P1-2 fix those routes now return 400, which is why correct param names are required here.
          getJson(`/api/data?from=${w.from}&to=${w.to}`),
          getJson(`/api/campaigns?from=${w.from}&to=${w.to}${storeQ}`),
          getJson(`/api/products?from=${w.from}&to=${w.to}${storeQ}`),
          getJson(`/api/orders-attribution?from=${w.from}&to=${w.to}${storeQ}`),
        ]);
        const byStore = <T extends { storeName?: string }>(rows: T[]): T[] =>
          store === 'All' ? rows : rows.filter(r => r.storeName === store);
        const v = reconcileWindow({
          // Field names confirmed via Step 0:
          // data rows: fbSpend, gaSpend, ttSpend, totalSpend, revenue, roas, storeName, date ✓
          dataRows: byStore((data.rows ?? []) as any[]),
          // product rows: revenue, netRevenue, orders, storeName, date ✓
          productRows: byStore((products.rows ?? []) as any[]),
          // campaign rows: platform, spend (not spendCad), storeName, date ✓
          campaignRows: byStore((campaigns.rows ?? []) as any[]),
          // orders rows: totalCad (confirmed — not `total`), storeName, date ✓
          ordersRows: byStore((orders.rows ?? []) as any[]).map((o: any) => ({
            date: o.date,
            storeName: o.storeName,
            totalCad: o.totalCad,
          })),
        });
        if (v.length) allViolations.push({ window: `${w.from}..${w.to}`, store, v });
      }
    }
    for (const { window, store, v } of allViolations) {
      console.error(`\n[${window}] [${store}] ${v.length} violation(s):`);
      for (const x of v) console.error(`  - ${x.label}: ${x.detail}`);
    }
    expect(allViolations.flatMap(a => a.v)).toEqual([]);
  });

  // INV-NC-BASIS (Wave 1): the dashboard NC-ROAS revenue must sit on the NET
  // basis — i.e. gross first-order revenue (immutable orders_attribution.total_cad)
  // re-based by the store/period net÷gross factor (netAdjustFactor). Since net ≤
  // gross in the real world, the factor is ≤ 1, so the dashboard NC revenue must
  // never EXCEED the raw gross sum of first-order total_cad. If a future change
  // regresses NC-ROAS back to a gross pass-through (factor not applied) or applies
  // the inverse gross÷net factor (> 1), this assertion fails loudly per window×store.
  //
  // We reproduce the exact dashboard path: data_daily net/gross → netAdjustFactor →
  // computeNewCustomerMetrics(firstOrderRows, spend, store, factor).ncRevenue, then
  // compare against the un-adjusted gross sum of first-order total_cad. A tiny
  // epsilon absorbs FX/float rounding so a genuinely-net result never false-flags.
  it('NC-ROAS revenue uses the net-adj basis (never gross pass-through)', { timeout: 180_000 }, async () => {
    const EPS = 0.01; // accounting epsilon — guards float/FX rounding, not a real gross overshoot
    const failures: Array<{ window: string; store: string; detail: string }> = [];
    for (const w of WINDOWS) {
      for (const store of STORES) {
        const storeQ = `&store=${store === 'All' ? 'All' : encodeURIComponent(store)}`;
        // /api/data is store-agnostic (all stores returned, sliced client-side);
        // /api/orders-attribution likewise returns all stores. We slice by store
        // below, mirroring byStore() in the reconcile test above.
        const [data, orders] = await Promise.all([
          getJson(`/api/data?from=${w.from}&to=${w.to}`),
          getJson(`/api/orders-attribution?from=${w.from}&to=${w.to}${storeQ}`),
        ]);
        const byStore = <T extends { storeName?: string }>(rows: T[]): T[] =>
          store === 'All' ? rows : rows.filter(r => r.storeName === store);

        // Net-adj factor from data_daily: Σ revenue_cad (net) ÷ Σ gross_revenue_cad.
        const dataRows = byStore((data.rows ?? []) as Array<{ storeName?: string; revenue?: number; grossRevenue?: number }>);
        const net = dataRows.reduce((a, r) => a + (Number.isFinite(r.revenue) ? (r.revenue as number) : 0), 0);
        const gross = dataRows.reduce((a, r) => a + (Number.isFinite(r.grossRevenue) ? (r.grossRevenue as number) : 0), 0);
        const { factor, degraded } = netAdjustFactor(net, gross);

        // First-order rows in the same window/store, mapped to the adapter shape.
        const orderRows = byStore((orders.rows ?? []) as Array<{
          storeName?: string; totalCad?: number; isFirstOrder?: boolean | null;
        }>);
        const firstOrderRows: FirstOrderInput[] = orderRows.map(o => ({
          storeName: String(o.storeName ?? ''),
          totalCad: Number(o.totalCad ?? 0),
          isFirstOrder: o.isFirstOrder ?? null,
        }));

        // Raw gross sum of first-order total_cad (what a regression would pass through).
        const grossNcSum = firstOrderRows
          .filter(r => r.isFirstOrder === true)
          .reduce((a, r) => a + (Number.isFinite(r.totalCad) ? r.totalCad : 0), 0);

        // Dashboard path. spend is irrelevant to ncRevenue, so pass 0.
        const scope = store === 'All' ? undefined : store;
        const { ncRevenue } = computeNewCustomerMetrics(firstOrderRows, 0, scope, factor);

        // Nothing to check when there is no first-order revenue in the window.
        if (grossNcSum <= 0) continue;

        if (ncRevenue > grossNcSum + EPS) {
          failures.push({
            window: `${w.from}..${w.to}`,
            store,
            detail:
              `ncRevenue ${ncRevenue.toFixed(2)} > grossNcSum ${grossNcSum.toFixed(2)} ` +
              `(net-adj factor ${factor.toFixed(4)}${degraded ? ' [degraded]' : ''}; ` +
              `net ${net.toFixed(2)} / gross ${gross.toFixed(2)}) — ` +
              `NC-ROAS revenue is NOT net-adj-based (regressed to gross pass-through or inverse factor)`,
          });
        }
      }
    }
    for (const f of failures) console.error(`\n[${f.window}] [${f.store}] ${f.detail}`);
    expect(failures).toEqual([]);
  });
});
