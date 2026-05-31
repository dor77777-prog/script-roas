// dashboard-web/src/components/home/__tests__/CommandCenterHero.dom.test.tsx
//
// Task 3.1 — smoke + contract tests for <CommandCenterHero>.
//
// Pins:
//   • Row 1 (3 cards) + Row 2 (4 cards) = 7 hero cards total.
//   • Featured card is Operating Profit ("רווח תפעולי") — NOT Net Profit
//     (Net Profit is reserved for P&L per operator request, since the
//     hero strip only contextualises ad-spend & inventory).
//   • Operating Profit card is banded by business ROAS (same hue as the
//     ROAS tile so the two hero numbers visually agree).
//   • Operating Profit + ROAS + Ad-spend % render .v.banded;
//     Spend/Revenue/Orders/CPM render .v.neutral.
//   • Ad-spend ÷ Revenue card carries its OWN band — 25% target.
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
  operatingProfit: 5500, // revenue − adSpend − cogs ≈ 10998 − 3924 − ~1575
  revenue: 10998,
  spend: 3924,
  cpm: 8.92,
  orders: 188,
  // 3924 / 10998 ≈ 35.7% → ad-spend band = red
  adSpendPctOfRevenue: 3924 / 10998,
};

describe('<CommandCenterHero>', () => {
  it('renders 7 hero cards across 2 rows (3 + 4)', () => {
    const { getByTestId } = render(
      <CommandCenterHero current={PERIOD_GREEN} rangeLabel="היום" />,
    );
    expect(getByTestId('hero-row-1')).toBeTruthy();
    expect(getByTestId('hero-row-2')).toBeTruthy();
    expect(getByTestId('hero-net-profit')).toBeTruthy(); // Operating Profit (testid retained for back-compat)
    expect(getByTestId('hero-spend')).toBeTruthy();
    expect(getByTestId('hero-revenue')).toBeTruthy();
    expect(getByTestId('hero-roas')).toBeTruthy();
    expect(getByTestId('hero-ad-spend-pct')).toBeTruthy();
    expect(getByTestId('hero-orders')).toBeTruthy();
    expect(getByTestId('hero-cpm')).toBeTruthy();
  });

  it('Featured card carries data-band="green" for a green-band ROAS', () => {
    const { getByTestId } = render(
      <CommandCenterHero current={PERIOD_GREEN} rangeLabel="היום" />,
    );
    expect(getByTestId('hero-net-profit').getAttribute('data-band')).toBe('green');
  });

  it('Featured card label is "רווח תפעולי" (operating profit), NOT "רווח נטו"', () => {
    const { getByTestId } = render(
      <CommandCenterHero current={PERIOD_GREEN} rangeLabel="היום" />,
    );
    const featured = getByTestId('hero-net-profit');
    expect(featured.textContent).toContain('רווח תפעולי');
    expect(featured.textContent).not.toContain('רווח נטו');
  });

  it('Featured card renders operatingProfit (not the legacy netProfit field)', () => {
    const { getByTestId } = render(
      <CommandCenterHero current={PERIOD_GREEN} rangeLabel="היום" />,
    );
    const featured = getByTestId('hero-net-profit');
    // operatingProfit = 5500 → "$5,500"; netProfit was 4847 → must NOT leak.
    expect(featured.textContent).toContain('$5,500');
    expect(featured.textContent).not.toContain('$4,847');
  });

  it('Operating Profit + ROAS + Ad-spend% render the .v.banded class hook', () => {
    const { container } = render(
      <CommandCenterHero current={PERIOD_GREEN} rangeLabel="היום" />,
    );
    const bandedNumbers = container.querySelectorAll('.v.banded');
    // Three banded numbers — Operating Profit, ROAS, Ad-spend %.
    expect(bandedNumbers.length).toBe(3);
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

  it('Featured card surfaces the eyebrow range label', () => {
    const { getByTestId } = render(
      <CommandCenterHero current={PERIOD_GREEN} rangeLabel="30 ימים" />,
    );
    expect(getByTestId('hero-net-profit').textContent).toContain('30 ימים');
  });

  it('red-band ROAS flips both Operating Profit AND ROAS to data-band="red"', () => {
    const red: CommandCenterPeriod = { ...PERIOD_GREEN, roas: 1.4 };
    const { getByTestId } = render(
      <CommandCenterHero current={red} rangeLabel="היום" />,
    );
    expect(getByTestId('hero-net-profit').getAttribute('data-band')).toBe('red');
    expect(getByTestId('hero-roas').getAttribute('data-band')).toBe('red');
  });

  describe('Ad-spend % card — independent 25% target band', () => {
    it('ratio ≤ 25% → data-band="green" (efficient)', () => {
      const efficient: CommandCenterPeriod = {
        ...PERIOD_GREEN,
        adSpendPctOfRevenue: 0.20, // 20%
      };
      const { getByTestId } = render(
        <CommandCenterHero current={efficient} rangeLabel="היום" />,
      );
      expect(getByTestId('hero-ad-spend-pct').getAttribute('data-band')).toBe('green');
    });

    it('25% < ratio ≤ 30% → data-band="orange" (warning)', () => {
      const warn: CommandCenterPeriod = {
        ...PERIOD_GREEN,
        adSpendPctOfRevenue: 0.27, // 27%
      };
      const { getByTestId } = render(
        <CommandCenterHero current={warn} rangeLabel="היום" />,
      );
      expect(getByTestId('hero-ad-spend-pct').getAttribute('data-band')).toBe('orange');
    });

    it('ratio > 30% → data-band="red" (overspend)', () => {
      const over: CommandCenterPeriod = {
        ...PERIOD_GREEN,
        adSpendPctOfRevenue: 0.35, // 35%
      };
      const { getByTestId } = render(
        <CommandCenterHero current={over} rangeLabel="היום" />,
      );
      expect(getByTestId('hero-ad-spend-pct').getAttribute('data-band')).toBe('red');
    });

    it('null ratio → data-band="gray" + value renders "—"', () => {
      const noRev: CommandCenterPeriod = {
        ...PERIOD_GREEN,
        adSpendPctOfRevenue: null,
      };
      const { getByTestId } = render(
        <CommandCenterHero current={noRev} rangeLabel="היום" />,
      );
      const card = getByTestId('hero-ad-spend-pct');
      expect(card.getAttribute('data-band')).toBe('gray');
      expect(card.querySelector('.v')?.textContent).toBe('—');
    });

    it('formats the ratio as "%.1f%" (e.g. 0.197 → "19.7%")', () => {
      const p: CommandCenterPeriod = {
        ...PERIOD_GREEN,
        adSpendPctOfRevenue: 0.197,
      };
      const { getByTestId } = render(
        <CommandCenterHero current={p} rangeLabel="היום" />,
      );
      expect(getByTestId('hero-ad-spend-pct').querySelector('.v')?.textContent).toBe('19.7%');
    });
  });
});
