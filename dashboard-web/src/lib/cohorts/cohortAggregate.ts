// src/lib/cohorts/cohortAggregate.ts
export interface BulkCohortLine { orderId:string; createdAt:string; customerId:string|null; grossCad:number; netCad:number; }
export interface CohortCell {
  store_id:string; first_order_month:string; month_since:number;
  active_customers:number; orders:number; gross_cad:number; net_cad:number;
  /**
   * A6 (2026-06-04) — distinct customers of this cohort with ≥1 repeat order
   * within the 12-month window (any month_since 1..11), counted ONCE per cohort
   * and stored ONLY on the M0 row (null elsewhere) so the reader sums it once.
   * The honest "% who reorder" numerator — the old Σ active(m≥1) proxy
   * double-counts a customer active in multiple post-M0 months.
   */
  repeat_customers:number|null;
}

/** Whole calendar months from a→b ('YYYY-MM'), floored at 0. */
export function monthsBetween(a:string, b:string):number {
  const [ay,am]=a.split('-').map(Number), [by,bm]=b.split('-').map(Number);
  return Math.max(0, (by-ay)*12 + (bm-am));
}

export function aggregateCohortCells(storeId:string, lines:BulkCohortLine[], firstOrderMonthByCustomer:Map<string,string>):CohortCell[] {
  const cells = new Map<string,CohortCell & {custSet:Set<string>}>();
  // A6 — per cohort, the set of distinct customers with ≥1 in-window repeat.
  const repeatByFom = new Map<string,Set<string>>();
  for (const l of lines) {
    if (!l.customerId) continue;                 // guest → unclassifiable
    const fom = firstOrderMonthByCustomer.get(l.customerId);
    if (!fom) continue;                          // no ledger entry
    const om = String(l.createdAt).slice(0,7);
    const ms = monthsBetween(fom, om);
    // B2 (2026-06-04) — TRUE 12-month window: drop orders past month 11 instead
    // of folding months 11..N into an M11 catch-all (which inflated the
    // "12-month" LTV ~7% and produced a fake hockey-stick at the curve endpoint
    // + the retention grid's last column). Consumers already window 0..11.
    if (ms > 11) continue;
    if (ms >= 1) {
      let s = repeatByFom.get(fom);
      if (!s) { s = new Set(); repeatByFom.set(fom, s); }
      s.add(l.customerId);
    }
    const key = `${fom}|${ms}`;
    let c = cells.get(key);
    if (!c) { c = { store_id:storeId, first_order_month:fom, month_since:ms, active_customers:0, orders:0, gross_cad:0, net_cad:0, repeat_customers:null, custSet:new Set() }; cells.set(key,c); }
    c.orders += 1; c.gross_cad += l.grossCad||0; c.net_cad += l.netCad||0; c.custSet.add(l.customerId);
  }
  return [...cells.values()].map(({custSet,...c}) => ({
    ...c,
    active_customers: custSet.size,
    // Distinct repeat-customer count lives on the M0 row only (null elsewhere).
    repeat_customers: c.month_since === 0 ? (repeatByFom.get(c.first_order_month)?.size ?? 0) : null,
  }));
}
