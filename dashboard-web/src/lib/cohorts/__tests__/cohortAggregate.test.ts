import { describe, it, expect } from 'vitest';
import { aggregateCohortCells, monthsBetween } from '@/lib/cohorts/cohortAggregate';

describe('monthsBetween', () => {
  it('counts whole calendar months, floors at 0', () => {
    expect(monthsBetween('2025-07', '2025-07')).toBe(0);
    expect(monthsBetween('2025-07', '2025-09')).toBe(2);
    expect(monthsBetween('2025-07', '2026-07')).toBe(12);
    expect(monthsBetween('2025-09', '2025-07')).toBe(0); // never negative
  });
});

describe('aggregateCohortCells', () => {
  const fom = new Map([['c1','2025-07'],['c2','2025-07'],['c3','2025-08']]);
  const lines = [
    { orderId:'1', createdAt:'2025-07-05', customerId:'c1', grossCad:100, netCad:90 }, // c1 M0
    { orderId:'2', createdAt:'2025-09-05', customerId:'c1', grossCad:50,  netCad:50 }, // c1 M2
    { orderId:'3', createdAt:'2025-07-09', customerId:'c2', grossCad:80,  netCad:80 }, // c2 M0
    { orderId:'4', createdAt:'2025-08-01', customerId:'c3', grossCad:60,  netCad:55 }, // c3 M0
    { orderId:'5', createdAt:'2025-08-15', customerId:'g',  grossCad:30,  netCad:30 }, // guest → skipped
  ];
  it('buckets by first-order-month × months-since with distinct customers', () => {
    const cells = aggregateCohortCells('uzoshop', lines, fom);
    const get = (m: string, ms: number) => cells.find(c => c.first_order_month===m && c.month_since===ms);
    expect(get('2025-07',0)).toMatchObject({ active_customers:2, orders:2, gross_cad:180, net_cad:170 });
    expect(get('2025-07',2)).toMatchObject({ active_customers:1, orders:1, net_cad:50 });
    expect(get('2025-08',0)).toMatchObject({ active_customers:1, orders:1, net_cad:55 });
    expect(cells.every(c => c.store_id==='uzoshop')).toBe(true);
    // guest order excluded
    expect(cells.reduce((s,c)=>s+c.orders,0)).toBe(4);
  });
  it('A6: repeat_customers = distinct in-window repeaters, on the M0 row only', () => {
    const cells = aggregateCohortCells('uzoshop', lines, fom);
    const get = (m: string, ms: number) => cells.find(c => c.first_order_month===m && c.month_since===ms);
    // c1 (cohort 2025-07) re-ordered at M2 → one distinct repeater; c2/c3 did not.
    expect(get('2025-07',0)!.repeat_customers).toBe(1);
    expect(get('2025-08',0)!.repeat_customers).toBe(0);
    // Non-M0 rows carry null (the count is stored once, on M0).
    expect(get('2025-07',2)!.repeat_customers).toBeNull();
  });
  it('B2: drops orders past month 11 (true 12-month window, no all-time catch-all)', () => {
    const within = [{ orderId:'8', createdAt:'2026-06-01', customerId:'c1', grossCad:10, netCad:10 }]; // exactly M11
    const beyond = [{ orderId:'9', createdAt:'2027-09-01', customerId:'c1', grossCad:10, netCad:10 }]; // 26 months → dropped
    expect(aggregateCohortCells('uzoshop', within, fom).find(c => c.month_since===11)).toBeDefined();
    expect(aggregateCohortCells('uzoshop', beyond, fom)).toHaveLength(0);
  });
});
