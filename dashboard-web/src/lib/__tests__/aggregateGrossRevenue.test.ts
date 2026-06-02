import { describe, it, expect } from 'vitest';
import { aggregate } from '@/lib/analytics';

// Minimal DailyRow-shaped fixtures. grossRevenue > revenue (refunds happened).
const rows = [
  { date: '2026-06-01', storeId: 'uzoshop', storeName: 'uzoshop', revenue: 90, grossRevenue: 100, spend: 30, cogs: 25, fbSpend: 30, gaSpend: 0, ttSpend: 0, impressions: 0, roas: 3 },
  { date: '2026-06-02', storeId: 'uzoshop', storeName: 'uzoshop', revenue: 180, grossRevenue: 200, spend: 60, cogs: 50, fbSpend: 60, gaSpend: 0, ttSpend: 0, impressions: 0, roas: 3 },
] as unknown as Parameters<typeof aggregate>[0];

describe('aggregate — grossRevenue', () => {
  it('sums gross_revenue_cad into Aggregate.grossRevenue alongside net revenue', () => {
    const agg = aggregate(rows);
    expect(agg.revenue).toBe(270);       // net unchanged
    expect(agg.grossRevenue).toBe(300);  // NEW: gross summed
  });
});
