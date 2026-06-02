import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PnLBreakdown } from '@/components/PnLBreakdown';
import type { Aggregate } from '@/lib/analytics';

function agg(over: Partial<Aggregate>): Aggregate {
  return {
    revenue: 48920, spend: 16840, fbSpend: 0, gaSpend: 0, ttSpend: 0, roas: 2.9,
    grossProfit: 48920 - 16840, cogs: 13208, netProfit: 48920 - 16840 - 13208,
    transactionFees: 3180, fixedCosts: 1290, storeCount: 3, daysCovered: 18,
    salaries: 3424, trueNetProfit: 48920 - 16840 - 13208 - 3180 - 1290 - 3424,
    trueMargin: (48920 - 16840 - 13208 - 3180 - 1290 - 3424) / 48920, rowCount: 18,
    ...over,
  };
}

describe('PnLBreakdown — salaries line', () => {
  it('renders a "משכורות" cascade line with the salaries amount', () => {
    render(<PnLBreakdown current={agg({})} storeNames={['uzoshop']} rangeFrom="2026-06-01" rangeTo="2026-06-30" rows={[]} />);
    const line = screen.getByTestId('pnl-line-salaries');
    expect(line).toBeTruthy();
    expect(line.textContent).toContain('משכורות');
  });

  it('the salaries line is absent when salaries is 0', () => {
    render(<PnLBreakdown current={agg({ salaries: 0, trueNetProfit: 48920 - 16840 - 13208 - 3180 - 1290 })} storeNames={['uzoshop']} rangeFrom="2026-06-01" rangeTo="2026-06-30" rows={[]} />);
    expect(screen.queryByTestId('pnl-line-salaries')).toBeNull();
  });

  it('keeps every prior cascade line (no info loss): refunds line still renders when present', () => {
    // a refund row drives the presentational "החזרים בתקופה" line
    const rows = [{
      date: '2026-06-10', storeId: 'uzoshop', storeName: 'uzoshop',
      fbSpend: 0, gaSpend: 0, ttSpend: 0, totalSpend: 0, revenue: 1000,
      roas: 0, grossProfit: 1000, cogs: 0, netProfit: 1000, hasCogs: true,
      grossRevenue: 1500, refundDeduction: 500,
      fbImpressions: null, gaImpressions: null, ttImpressions: null,
    }];
    render(<PnLBreakdown current={agg({})} storeNames={['uzoshop']} rangeFrom="2026-06-01" rangeTo="2026-06-30" rows={rows} />);
    // both the refunds line and the salaries line coexist
    expect(screen.getByText('החזרים בתקופה')).toBeTruthy();
    expect(screen.getByTestId('pnl-line-salaries')).toBeTruthy();
  });
});
