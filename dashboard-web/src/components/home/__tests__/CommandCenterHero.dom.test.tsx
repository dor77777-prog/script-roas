// dashboard-web/src/components/home/__tests__/CommandCenterHero.dom.test.tsx
//
// Smoke + contract tests for <CommandCenterHero>.
//
// Horizon re-skin W3.2 (2026-06-13): the hero is now the EXACT-MATCH 6-Widget
// KPI row from the approved mockup (a single grid of the shared <Widget>
// primitive), with the Inventory (COGS) data point preserved as a 7th widget
// in the same grid and the NC-ROAS tile preserved below. These pins were
// updated from the prior 7-Card mesh hero where the change is legitimate:
//   • ONE grid (`hero-row-1`) holds the 6 mockup KPIs + the kept COGS widget.
//   • Featured card is Operating Profit ("רווח תפעולי") — NOT Net Profit
//     (Net Profit is reserved for P&L per operator request).
//   • Only the MER widget is banded (the band-gauge rule): its root + value
//     carry data-band; operating profit + the rest are brand-icon widgets.
//   • Inventory (COGS) is an informational widget — no band colouring.
//     Surfaces "מלאי · {rangeLabel}" + fmtMoneyCompact + "~X.X% מהמחזור".
//   • A null current.cpm renders "—" (no $0.00 surprise).
//   • <NetSparkline>/<MiniSparkline> remain standalone exports (the Horizon
//     Widget recipe carries no per-card spark); NetSparkline is unit-tested
//     directly here.

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  CommandCenterHero,
  NetSparkline,
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
  it('renders the 6 mockup KPI widgets + the kept COGS widget in one grid', () => {
    const { getByTestId } = render(
      <CommandCenterHero current={PERIOD_GREEN} rangeLabel="היום" />,
    );
    // Single Horizon grid (the prior `hero-row-2` is gone).
    expect(getByTestId('hero-row-1')).toBeTruthy();
    // 6 mockup widgets:
    expect(getByTestId('hero-spend')).toBeTruthy();
    expect(getByTestId('hero-revenue')).toBeTruthy();
    expect(getByTestId('hero-net-profit')).toBeTruthy(); // Operating Profit (testid retained for back-compat)
    expect(getByTestId('hero-roas')).toBeTruthy();        // MER (band-gauge)
    expect(getByTestId('hero-orders')).toBeTruthy();
    expect(getByTestId('hero-cpm')).toBeTruthy();
    // + the kept (no-info-loss) Inventory widget.
    expect(getByTestId('hero-cogs')).toBeTruthy();
  });

  it('Operating Profit widget carries the LIVE pill', () => {
    const { getByTestId } = render(
      <CommandCenterHero current={PERIOD_GREEN} rangeLabel="היום" />,
    );
    const live = getByTestId('hero-op-live');
    expect(live.textContent).toBe('LIVE');
    // The pill lives inside the operating-profit widget.
    expect(getByTestId('hero-net-profit').contains(live)).toBe(true);
  });

  it('Operating Profit is NOT banded (only MER is — the band-gauge rule)', () => {
    const { getByTestId } = render(
      <CommandCenterHero current={PERIOD_GREEN} rangeLabel="היום" />,
    );
    // Brand-icon widget, no band signal on its root.
    expect(getByTestId('hero-net-profit').getAttribute('data-band')).toBeNull();
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

  it('only the MER widget carries the band signal (data-band on the VALUE span, not the root)', () => {
    const { getByTestId } = render(
      <CommandCenterHero current={PERIOD_GREEN} rangeLabel="היום" />,
    );
    // MER (hero-roas) is the sole banded KPI. The band lives on the value SPAN —
    // the Card ROOT must NOT carry data-band, since `.glass[data-band]` is the
    // vivid store-card recipe (opacity:0 mount-entrance) that would make the KPI
    // tile invisible (fixed 2026-06-13).
    const mer = getByTestId('hero-roas');
    expect(mer.querySelector('[data-band="green"]')).not.toBeNull();
    expect(mer.getAttribute('data-band')).toBeNull();
    // The other KPI widgets are brand-icon (un-banded) widgets — no data-band anywhere.
    for (const id of [
      'hero-spend',
      'hero-revenue',
      'hero-net-profit',
      'hero-orders',
      'hero-cpm',
      'hero-cogs',
    ]) {
      expect(getByTestId(id).getAttribute('data-band')).toBeNull();
      expect(getByTestId(id).querySelector('[data-band]')).toBeNull();
    }
  });

  it('null CPM renders "—" not "$0"', () => {
    const { getByTestId } = render(
      <CommandCenterHero
        current={{ ...PERIOD_GREEN, cpm: null }}
        rangeLabel="היום"
      />,
    );
    const cpmCard = getByTestId('hero-cpm');
    // No money primitive rendered, and the em-dash placeholder is present.
    expect(cpmCard.querySelector('bdi.metric-num')).toBeNull();
    expect(cpmCard.textContent).toContain('—');
  });

  it('Featured card surfaces the eyebrow range label', () => {
    const { getByTestId } = render(
      <CommandCenterHero current={PERIOD_GREEN} rangeLabel="30 ימים" />,
    );
    expect(getByTestId('hero-net-profit').textContent).toContain('30 ימים');
  });

  it('red-band MER flips the MER widget value span to data-band="red" (operating profit stays un-banded)', () => {
    const red: CommandCenterPeriod = { ...PERIOD_GREEN, roas: 1.4 };
    const { getByTestId } = render(
      <CommandCenterHero current={red} rangeLabel="היום" />,
    );
    // Band on the value span; root carries none (see .glass[data-band] note above).
    const mer = getByTestId('hero-roas');
    expect(mer.querySelector('[data-band="red"]')).not.toBeNull();
    expect(mer.getAttribute('data-band')).toBeNull();
    // Operating profit is a brand-icon widget — never banded.
    expect(getByTestId('hero-net-profit').getAttribute('data-band')).toBeNull();
  });

  it('shows a "no comparison data" hint when comparisonUnavailable', () => {
    // A non-default baseline (e.g. "שנה שעברה") with no prior-period data must
    // say so explicitly rather than silently dropping the delta line.
    const { getByText } = render(
      <CommandCenterHero
        current={PERIOD_GREEN}
        rangeLabel="היום"
        comparisonUnavailable
        comparisonLabel="מול שנה שעברה"
      />,
    );
    expect(getByText('אין נתוני השוואה לתקופה זו')).toBeInTheDocument();
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

    it('renders fmtMoneyCompact(cogs) as the value', () => {
      const { getByTestId } = render(
        <CommandCenterHero current={PERIOD_GREEN} rangeLabel="היום" />,
      );
      const card = getByTestId('hero-cogs');
      // cogs = 2750 → "$2,750" via the shared <Money> primitive.
      expect(card.querySelector('bdi.metric-num')?.textContent).toContain('2,750');
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
      // <Money value={null}> renders the em-dash inside the metric primitive.
      expect(card.querySelector('bdi.metric-num')?.textContent).toBe('—');
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
      expect(
        getByTestId('hero-cogs').querySelector('bdi.metric-num')?.textContent,
      ).toContain('1,000');
      expect(queryByTestId('hero-cogs-subtitle')).toBeNull();
    });

    it('is informational — NOT banded (no threshold colouring on the inventory widget)', () => {
      const { getByTestId } = render(
        <CommandCenterHero current={PERIOD_GREEN} rangeLabel="היום" />,
      );
      // The Horizon Widget recipe leaves COGS as a neutral brand-icon widget.
      expect(getByTestId('hero-cogs').getAttribute('data-band')).toBeNull();
    });
  });

  // Wave D2 (refined) — <NetSparkline> casing-only legibility. The spark draws
  // in the band hue, so on a matching band the line can vanish into the tint;
  // the fix uses a neutral --plot-bg casing under-stroke ONLY (no scrim rect)
  // so the line reads on any band while the band-tinted AREA fill shows through.
  // W3.2: the Horizon Widget hero no longer embeds this spark, so the component
  // is exercised directly (it stays an export for any surface that wants it).
  describe('<NetSparkline> casing-only (no scrim)', () => {
    const SPARK = [1, 3, 2, 5, 4, 6];

    it('renders area + casing/coloured line paths and NO scrim rect', () => {
      const { container } = render(
        <NetSparkline values={SPARK} bandColorVar="var(--band-green)" />,
      );
      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();

      // NO scrim rect — the band colour/gradient must show through fully.
      expect(svg!.querySelector('rect')).toBeNull();

      // ≥3 paths: area fill + neutral casing + coloured line.
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

      // Layering order: area → casing → coloured line. The casing
      // node must precede the coloured-line node in document order.
      const nodes = Array.from(svg!.children);
      const casingIdx = nodes.indexOf(casing[0]);
      const lineIdx = nodes.indexOf(colouredLine[0]);
      expect(casingIdx).toBeGreaterThan(-1);
      expect(lineIdx).toBeGreaterThan(casingIdx);
    });

    it('omits the spark entirely when fewer than 2 points are supplied', () => {
      const { container } = render(
        <NetSparkline values={[5]} bandColorVar="var(--band-green)" />,
      );
      expect(container.querySelector('svg')).toBeNull();
    });
  });
});

describe('<CommandCenterHero> — NC-ROAS / nCAC subordinate tile', () => {
  const NC = { ncRoas: 2.1, nCac: 38, ncOrders: 12, returningOrders: 3, unclassifiableShare: 0.18, confidence: 'ok' as const };

  it('renders the subordinate tile when newCustomer is provided', () => {
    const { getByTestId } = render(
      <CommandCenterHero current={PERIOD_GREEN} rangeLabel="היום" newCustomer={NC} />,
    );
    const tile = getByTestId('hero-nc-roas');
    expect(tile).toBeTruthy();
    // "different question" label — distinct from the main "ROAS" tile.
    expect(tile.textContent).toContain('שאלה אחרת');
    expect(tile.textContent).toContain('2.10'); // NC-ROAS value
    expect(tile.textContent).toContain('$38');  // nCAC value
  });

  it('subordinate tile carries its OWN band (ncRoas=2.1 → orange), not the hero MER band (roas=2.8 → green)', () => {
    const { getByTestId } = render(
      <CommandCenterHero current={PERIOD_GREEN} rangeLabel="היום" newCustomer={NC} />,
    );
    // hero MER widget stays green (driven by current.roas = 2.8). The MER tile is a
    // <Widget>, so its band lives on the VALUE span — the Card root carries no
    // data-band (the `.glass[data-band]` opacity:0 recipe would hide a KPI Widget;
    // fixed 2026-06-13). The NC tile below is a real banded <Card band=…> which DOES
    // wire up data-mounted, so it legitimately keeps data-band on its root.
    const mer = getByTestId('hero-roas');
    expect(mer.querySelector('[data-band="green"]')).not.toBeNull();
    expect(mer.getAttribute('data-band')).toBeNull();
    // subordinate tile is orange (driven by its own ncRoas = 2.1), on the Card root.
    expect(getByTestId('hero-nc-roas').getAttribute('data-band')).toBe('orange');
  });

  it('does NOT render the subordinate tile when newCustomer is omitted (back-compat)', () => {
    const { queryByTestId } = render(
      <CommandCenterHero current={PERIOD_GREEN} rangeLabel="היום" />,
    );
    expect(queryByTestId('hero-nc-roas')).toBeNull();
  });

  it('surfaces the unclassifiable share', () => {
    const { getByTestId } = render(
      <CommandCenterHero current={PERIOD_GREEN} rangeLabel="היום" newCustomer={NC} />,
    );
    expect(getByTestId('hero-nc-roas').textContent).toContain('18%');
  });
});

describe('<CommandCenterHero> — NC-ROAS net-adj label + confidence gate', () => {
  it('shows the "net (refund-adj)" qualifier on the NC-ROAS tile', () => {
    render(
      <CommandCenterHero
        current={PERIOD_GREEN}
        rangeLabel="היום"
        newCustomer={{ ncRoas: 3, ncOrders: 2, returningOrders: 3, nCac: 30, unclassifiableShare: 0.05, confidence: 'ok' }}
      />,
    );
    expect(screen.getByText(/refund-adj|נטו/i)).toBeInTheDocument();
  });

  it('confidence=low → renders a low-confidence badge', () => {
    render(
      <CommandCenterHero
        current={PERIOD_GREEN}
        rangeLabel="היום"
        newCustomer={{ ncRoas: 3, ncOrders: 2, returningOrders: 3, nCac: 30, unclassifiableShare: 0.3, confidence: 'low' }}
      />,
    );
    expect(screen.getByText(/ביטחון נמוך/)).toBeInTheDocument();
  });

  it('confidence=suppressed → hides the ratio, shows not-enough-data', () => {
    render(
      <CommandCenterHero
        current={PERIOD_GREEN}
        rangeLabel="היום"
        newCustomer={{ ncRoas: 3, ncOrders: 2, returningOrders: 3, nCac: 30, unclassifiableShare: 0.6, confidence: 'suppressed' }}
      />,
    );
    expect(screen.queryByText('3.00')).not.toBeInTheDocument();
    expect(screen.getByText(/לא מספיק דאטה/)).toBeInTheDocument();
  });
});
