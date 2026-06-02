// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { queryByText } from '@testing-library/dom';
import { PnLBreakdown } from '@/components/PnLBreakdown';
import { TRANSACTION_FEES_RATE } from '@/lib/costs';
import type { Aggregate } from '@/lib/analytics';

afterEach(() => cleanup());

// current.cogs / revenue = the effective rate. With cogs=3000, revenue=10000
// the prose must say 30.0% (NOT the hardcoded 25%).
const AGG: Aggregate = {
  revenue: 10000, grossRevenue: 10000, spend: 2000, fbSpend: 1500, gaSpend: 500, ttSpend: 0,
  roas: 5, grossProfit: 8000, cogs: 3000, netProfit: 4350,
  transactionFees: 650, fixedCosts: 0, salaries: 0, storeCount: 1, daysCovered: 1,
  trueNetProfit: 4350, trueMargin: 0.435, rowCount: 1,
};

describe('PnLBreakdown warning prose (2026-06-02)', () => {
  it('shows the ACTUAL effective COGS % (30.0%) not the hardcoded 25%', () => {
    const { container } = render(
      <PnLBreakdown current={AGG} storeNames={['uzoshop']} rangeFrom="2026-05-01" rangeTo="2026-05-31" />,
    );
    // Expand to reveal the warning + line detail. The panel defaults open,
    // so the expand control may already be in its collapse state — only
    // click it if the "show full breakdown" label is present.
    const expand = queryByText(container, /הצג פירוט מלא/);
    if (expand) fireEvent.click(expand);
    const text = container.textContent ?? '';
    expect(text).toContain('30.0%');
    expect(text).toContain(`${(TRANSACTION_FEES_RATE * 100).toFixed(1)}%`); // 6.5%
    // The stale literal "COGS (25%)" must be gone.
    expect(text).not.toContain('COGS (25%)');
  });
});
