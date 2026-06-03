// src/lib/cohorts/cohortAggregate.ts
export interface BulkCohortLine { orderId:string; createdAt:string; customerId:string|null; grossCad:number; netCad:number; }
export interface CohortCell { store_id:string; first_order_month:string; month_since:number; active_customers:number; orders:number; gross_cad:number; net_cad:number; }

/** Whole calendar months from a→b ('YYYY-MM'), floored at 0. */
export function monthsBetween(a:string, b:string):number {
  const [ay,am]=a.split('-').map(Number), [by,bm]=b.split('-').map(Number);
  return Math.max(0, (by-ay)*12 + (bm-am));
}

export function aggregateCohortCells(storeId:string, lines:BulkCohortLine[], firstOrderMonthByCustomer:Map<string,string>):CohortCell[] {
  const cells = new Map<string,CohortCell & {custSet:Set<string>}>();
  for (const l of lines) {
    if (!l.customerId) continue;                 // guest → unclassifiable
    const fom = firstOrderMonthByCustomer.get(l.customerId);
    if (!fom) continue;                          // no ledger entry
    const om = String(l.createdAt).slice(0,7);
    const ms = Math.min(11, monthsBetween(fom, om));
    const key = `${fom}|${ms}`;
    let c = cells.get(key);
    if (!c) { c = { store_id:storeId, first_order_month:fom, month_since:ms, active_customers:0, orders:0, gross_cad:0, net_cad:0, custSet:new Set() }; cells.set(key,c); }
    c.orders += 1; c.gross_cad += l.grossCad||0; c.net_cad += l.netCad||0; c.custSet.add(l.customerId);
  }
  return [...cells.values()].map(({custSet,...c}) => ({ ...c, active_customers: custSet.size }));
}
