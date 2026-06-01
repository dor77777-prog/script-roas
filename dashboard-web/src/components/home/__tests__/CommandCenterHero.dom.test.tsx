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
//   • Operating Profit + ROAS render .v.banded;
//     Spend / Revenue / Inventory / Orders / CPM render .v.neutral.
//   • Inventory (COGS) card uses the muted business band — informational,
//     not a status signal. Surfaces "מלאי · {rangeLabel}" + fmtMoneyCompact +
//     "~X.X% מהמחזור" subtitle.
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
  cogs: 2750, // 2750 / 10998 ≈ 25.0%
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
    expect(getByTestId('hero-cogs')).toBeTruthy();
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

  it('Operating Profit + ROAS render the .v.banded class hook', () => {
    const { container } = render(
      <CommandCenterHero current={PERIOD_GREEN} rangeLabel="היום" />,
    );
    const bandedNumbers = container.querySelectorAll('.v.banded');
    // Two banded numbers — Operating Profit + ROAS. (Inventory replaced
    // the prior Ad-spend % card, which was also banded; the inventory
    // card uses .v.neutral because it's informational, not a status
    // signal.)
    expect(bandedNumbers.length).toBe(2);
  });

  it('Spend / Revenue / Inventory / Orders / CPM render the .v.neutral class hook', () => {
    const { container } = render(
      <CommandCenterHero current={PERIOD_GREEN} rangeLabel="היום" />,
    );
    const neutralNumbers = container.querySelectorAll('.v.neutral');
    // Exactly five neutral numbers — Spend, Revenue, Inventory, Orders, CPM.
    expect(neutralNumbers.length).toBe(5);
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

  describe('Inventory (COGS) card — informational, muted band', () => {
    it('label includes "מלאי" and echoes the range label', () => {
      const { getByTestId } = render(
        <CommandCenterHero current={PERIOD_GREEN} rangeLabel="היום" />,
      );
      const card = getByTestId('hero-cogs');
      expect(card.textContent).toContain('מלאי');
      expect(card.textContent).toContain('היום');
    });

    it('renders fmtMoneyCompact(cogs) as the big number', () => {
      const { getByTestId } = render(
        <CommandCenterHero current={PERIOD_GREEN} rangeLabel="היום" />,
      );
      const card = getByTestId('hero-cogs');
      // cogs = 2750 → "$2,750"
      expect(card.querySelector('.v')?.textContent).toBe('$2,750');
    });

    it('renders the "~X.X% מהמחזור" subtitle when revenue > 0', () => {
      const { getByTestId } = render(
        <CommandCenterHero current={PERIOD_GREEN} rangeLabel="היום" />,
      );
      // 2750 / 10998 ≈ 25.0%
      const subtitle = getByTestId('hero-cogs-subtitle');
      expect(subtitle.textContent).toContain('25.0%');
      expect(subtitle.textContent).toContain('מהמחזור');
    });

    it('null cogs renders "—" + omits the subtitle (graceful missing data)', () => {
      const noCogs: CommandCenterPeriod = { ...PERIOD_GREEN, cogs: null };
      const { getByTestId, queryByTestId } = render(
        <CommandCenterHero current={noCogs} rangeLabel="היום" />,
      );
      const card = getByTestId('hero-cogs');
      expect(card.querySelector('.v')?.textContent).toBe('—');
      expect(queryByTestId('hero-cogs-subtitle')).toBeNull();
    });

    it('zero revenue omits the subtitle (no divide-by-zero) but keeps the dollar value', () => {
      const noRev: CommandCenterPeriod = {
        ...PERIOD_GREEN,
        revenue: 0,
        cogs: 1000,
      };
      const { getByTestId, queryByTestId } = render(
        <CommandCenterHero current={noRev} rangeLabel="היום" />,
      );
      expect(getByTestId('hero-cogs').querySelector('.v')?.textContent).toBe('$1,000');
      expect(queryByTestId('hero-cogs-subtitle')).toBeNull();
    });

    it('carries the muted business-band attribute (no independent threshold colouring)', () => {
      const { getByTestId } = render(
        <CommandCenterHero current={PERIOD_GREEN} rangeLabel="היום" />,
      );
      const card = getByTestId('hero-cogs');
      // Business ROAS = 2.8 → green band; muted strength.
      expect(card.getAttribute('data-band')).toBe('green');
      expect(card.getAttribute('data-band-strength')).toBe('muted');
    });
  });

  // Wave D2 — featured-card sparkline (NetSparkline) legibility hardening.
  // The featured Operating-Profit card sits on a ROAS-band gradient and the
  // spark stroke uses that SAME band hue, so on a matching band (green line
  // on a green band) the line can vanish into the tint. The fix adds a neutral
  // --plot-bg plot scrim + a neutral casing under-stroke so the line reads on
  // any band in both themes, while the band-tinted AREA fill keeps band
  // identity. The spark only renders when netSparkValues (≥2 points) is passed.
  describe('Featured-card sparkline (NetSparkline) plot scrim + casing', () => {
    const SPARK = [1, 3, 2, 5, 4, 6];

    it('renders a neutral plot scrim rect + casing/coloured line paths', () => {
      const { getByTestId } = render(
        <CommandCenterHero
          current={PERIOD_GREEN}
          rangeLabel="היום"
          netSparkValues={SPARK}
        />,
      );
      // The featured card carries the green band; its spark hue MATCHES the
      // band — exactly the P0 collision the scrim + casing protect against.
      const featured = getByTestId('hero-net-profit');
      const svg = featured.querySelector('svg');
      expect(svg).toBeTruthy();

      // Neutral scrim rect — the band-tint-free backdrop for the line.
      const scrim = svg!.querySelector('rect');
      expect(scrim).toBeTruthy();
      expect(scrim!.getAttribute('fill')).toBe('var(--plot-bg)');

      // ≥3 paths now: area fill + neutral casing + coloured line.
      const paths = svg!.querySelectorAll('path');
      expect(paths.length).toBeGreaterThanOrEqual(3);

      // Exactly one casing under-stroke in the neutral plot colour, drawn
      // BEFORE (under) the coloured line; the coloured line uses the band var.
      const casing = Array.from(paths).filter(
        (p) => p.getAttribute('stroke') === 'var(--plot-bg)',
      );
      expect(casing.length).toBe(1);
      const colouredLine = Array.from(paths).filter(
        (p) => p.getAttribute('stroke') === 'var(--band-green)',
      );
      expect(colouredLine.length).toBe(1);

      // Layering order: scrim → area → casing → coloured line. The casing
      // node must precede the coloured-line node in document order.
      const nodes = Array.from(svg!.children);
      const casingIdx = nodes.indexOf(casing[0]);
      const lineIdx = nodes.indexOf(colouredLine[0]);
      expect(casingIdx).toBeGreaterThan(-1);
      expect(lineIdx).toBeGreaterThan(casingIdx);
    });

    it('omits the spark entirely when fewer than 2 points are supplied', () => {
      const { getByTestId } = render(
        <CommandCenterHero
          current={PERIOD_GREEN}
          rangeLabel="היום"
          netSparkValues={[5]}
        />,
      );
      expect(getByTestId('hero-net-profit').querySelector('svg')).toBeNull();
    });
  });
});
