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
  it('caps month_since at 11', () => {
    const lines2 = [{ orderId:'9', createdAt:'2027-09-01', customerId:'c1', grossCad:10, netCad:10 }]; // 26 months → 11
    const cells = aggregateCohortCells('uzoshop', lines2, fom);
    expect(cells[0].month_since).toBe(11);
  });
});
