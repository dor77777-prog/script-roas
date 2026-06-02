// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent, queryByText } from '@testing-library/react';
import { PnLBreakdown } from '@/components/PnLBreakdown';
import type { Aggregate } from '@/lib/analytics';

afterEach(() => cleanup());

const AGG: Aggregate = {
  revenue: 10000, spend: 2000, fbSpend: 1500, gaSpend: 500, ttSpend: 0,
  roas: 5, grossProfit: 8000, cogs: 2500, netProfit: 4850,
  transactionFees: 650, fixedCosts: 0, storeCount: 1, daysCovered: 1,
  trueNetProfit: 4850, trueMargin: 0.485, rowCount: 1,
};

describe('PnLBreakdown ad-spend note MER (2026-06-02)', () => {
  it('the ad-spend line note reads "MER 5.00" (not "ROAS 5.00")', () => {
    const { container } = render(
      <PnLBreakdown current={AGG} storeNames={['uzoshop']} rangeFrom="2026-05-01" rangeTo="2026-05-31" />,
    );
    // The full breakdown defaults to open; only click the "show" toggle when collapsed.
    const expandToggle = queryByText(container, /הצג פירוט מלא/);
    if (expandToggle) fireEvent.click(expandToggle);
    const text = container.textContent ?? '';
    expect(text).toContain('MER 5.00');
    expect(text).not.toMatch(/· ROAS 5\.00/);
  });
});
