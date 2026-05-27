import { describe, it, expect } from 'vitest';
import { reconcileWindow, type Violation } from '../reconcile';

const BASE = process.env.AUDIT_BASE_URL ?? 'https://roas-dashboard-smoky.vercel.app';
const WINDOWS = [
  { from: '2026-05-01', to: '2026-05-26' },
  { from: '2026-05-20', to: '2026-05-26' },
];
// Real storeName values as returned by the API (confirmed via Step 0 curl):
//   '360usmile', 'Zol Plus', 'uzoshop'
// 'All' is a virtual sentinel — rows are filtered client-side by byStore().
const STORES = ['All', 'uzoshop', 'Zol Plus', '360usmile'];

async function getJson(path: string): Promise<{ rows?: unknown[]; [k: string]: unknown }> {
  const r = await fetch(`${BASE}${path}`);
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
});
