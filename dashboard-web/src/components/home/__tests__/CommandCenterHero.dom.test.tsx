// dashboard-web/src/components/home/__tests__/CommandCenterHero.dom.test.tsx
//
// Task 3.1 — smoke + contract tests for <CommandCenterHero>.
//
// Pins:
//   • 2 rows, 3 cards each (6 hero cards total — never more, never less).
//   • Net Profit card is banded (data-band attribute matches the band the
//     same ROAS picks via useRoasBandGradient).
//   • Net Profit + ROAS render .v.banded; Spend/Revenue/Orders/CPM render
//     .v.neutral. The CSS rules in globals.css depend on these class hooks
//     to flip the big-number colour — a refactor that loses them silently
//     blanks the typography.
//   • A null current.cpm renders "—" (no $0.00 surprise).

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import {
  CommandCenterHero,
  type CommandCenterPeriod,
} from '@/components/home/CommandCenterHero';

const PERIOD_GREEN: CommandCenterPeriod = {
  roas: 2.8,         // 2.7 ≤ ROAS < 3.0 → green band
  netProfit: 4847,
  revenue: 10998,
  spend: 3924,
  cpm: 8.92,
  orders: 188,
};

describe('<CommandCenterHero>', () => {
  it('renders 6 hero cards across 2 rows', () => {
    const { getByTestId } = render(
      <CommandCenterHero current={PERIOD_GREEN} rangeLabel="היום" />,
    );
    expect(getByTestId('hero-row-1')).toBeTruthy();
    expect(getByTestId('hero-row-2')).toBeTruthy();
    expect(getByTestId('hero-net-profit')).toBeTruthy();
    expect(getByTestId('hero-spend')).toBeTruthy();
    expect(getByTestId('hero-revenue')).toBeTruthy();
    expect(getByTestId('hero-roas')).toBeTruthy();
    expect(getByTestId('hero-orders')).toBeTruthy();
    expect(getByTestId('hero-cpm')).toBeTruthy();
  });

  it('Net Profit card carries data-band="green" for a green-band ROAS', () => {
    const { getByTestId } = render(
      <CommandCenterHero current={PERIOD_GREEN} rangeLabel="היום" />,
    );
    expect(getByTestId('hero-net-profit').getAttribute('data-band')).toBe('green');
  });

  it('Net Profit + ROAS render the .v.banded class hook', () => {
    const { container } = render(
      <CommandCenterHero current={PERIOD_GREEN} rangeLabel="היום" />,
    );
    const bandedNumbers = container.querySelectorAll('.v.banded');
    // Exactly two banded numbers — Net Profit (row 1) + ROAS (row 2).
    expect(bandedNumbers.length).toBe(2);
  });

  it('Spend / Revenue / Orders / CPM render the .v.neutral class hook', () => {
    const { container } = render(
      <CommandCenterHero current={PERIOD_GREEN} rangeLabel="היום" />,
    );
    const neutralNumbers = container.querySelectorAll('.v.neutral');
    // Exactly four neutral numbers — Spend, Revenue, Orders, CPM.
    expect(neutralNumbers.length).toBe(4);
  });

  it('null CPM renders "—" not "$0"', () => {
    const { getByTestId } = render(
      <CommandCenterHero
        current={{ ...PERIOD_GREEN, cpm: null }}
        rangeLabel="היום"
      />,
    );
    const cpmCard = getByTestId('hero-cpm');
    const big = cpmCard.querySelector('.v');
    expect(big?.textContent).toBe('—');
  });

  it('Net Profit card surfaces the eyebrow range label', () => {
    const { getByTestId } = render(
      <CommandCenterHero current={PERIOD_GREEN} rangeLabel="30 ימים" />,
    );
    expect(getByTestId('hero-net-profit').textContent).toContain('30 ימים');
  });

  it('red-band ROAS flips both Net Profit AND ROAS to data-band="red"', () => {
    const red: CommandCenterPeriod = { ...PERIOD_GREEN, roas: 1.4 };
    const { getByTestId } = render(
      <CommandCenterHero current={red} rangeLabel="היום" />,
    );
    expect(getByTestId('hero-net-profit').getAttribute('data-band')).toBe('red');
    expect(getByTestId('hero-roas').getAttribute('data-band')).toBe('red');
  });
});
