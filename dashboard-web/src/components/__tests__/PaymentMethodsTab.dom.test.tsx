/**
 * תשלומים (2026-06-03) — PaymentMethodsTab DOM tests. Ports the approved mockup
 * `docs/superpowers/mockups/2026-06-03-payment-methods/payment-methods-mockup.html`.
 *
 * The tab is fed a `PaymentMethodsByMonth` aggregate via `injectedData`
 * (test-only bypass of the `/api/payment-methods` SWR fetch) so the assertions
 * run with no network. Same injection contract as CustomerValueTab.injectedRows.
 *
 * Coverage:
 *  - the scope toggle (business / per-store) renders
 *  - the 3 gateway summary cards (credit / paypal / other) render WITH a %
 *  - the all-history summary strip aggregates ACROSS all months for the scope
 *  - CAD renders via <Money> (tabular `.metric-num` <bdi>, never clipped)
 *  - the share-bar uses TOKEN colour classes (accent / chart-meta / ink-subtle),
 *    never a hardcoded colour
 *  - pre-backfill NULL-heavy data degrades gracefully (waiting-for-backfill hint)
 *
 * BY-YEAR ACCORDION (2026-06-04 restructure — replaces the flat month table):
 *  - one collapsible row per YEAR (DESC), each carrying the year's aggregate
 *  - the most-recent year is expanded by default; older years collapsed
 *  - expanding a year reveals sub-rows at the chosen GRANULARITY
 *  - the granularity toggle (חודש / רבעון / שליש) re-groups every year's sub-rows
 *  - the footer grand-total row stays
 *  - the pure grouping helpers (groupByYear / periodKey / periodLabel) are
 *    unit-tested directly
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import {
  PaymentMethodsTab,
  groupMonthsByYear,
  periodKey,
  periodLabel,
} from '@/components/PaymentMethodsTab';
import type {
  PaymentMethodsByMonth,
  PaymentCategoryTotals,
} from '@/lib/postgresReaders';

const bucket = (orders: number, revenueCad: number) => ({ orders, revenueCad });
const totals = (
  c: [number, number],
  p: [number, number],
  o: [number, number],
): PaymentCategoryTotals => ({
  credit: bucket(c[0], c[1]),
  paypal: bucket(p[0], p[1]),
  other: bucket(o[0], o[1]),
});

// Two months, two stores, mixed gateways. Business rollup = sum over stores.
//  uzoshop  2026-05: credit 200/18000 · paypal 80/7200 · other 10/900
//  zolplus  2026-05: credit 100/9000  · paypal 40/3600 · other  5/450
//  uzoshop  2026-06: credit 120/10800 · paypal 50/4500 · other  6/540
const DATA: PaymentMethodsByMonth = {
  months: [
    {
      month: '2026-05',
      perStore: {
        uzoshop: totals([200, 18000], [80, 7200], [10, 900]),
        zolplus: totals([100, 9000], [40, 3600], [5, 450]),
      },
      business: totals([300, 27000], [120, 10800], [15, 1350]),
    },
    {
      month: '2026-06',
      perStore: {
        uzoshop: totals([120, 10800], [50, 4500], [6, 540]),
      },
      business: totals([120, 10800], [50, 4500], [6, 540]),
    },
  ],
};

// Multi-year fixture for the accordion: 2024, 2025, 2026 — spanning quarters
// and thirds so granularity regrouping is observable.
//  2024-02 (Q1 / T1), 2024-07 (Q3 / T2)
//  2025-11 (Q4 / T3)
//  2026-02 (Q1 / T1), 2026-05 (Q2 / T2), 2026-06 (Q2 / T2)
const MULTI_YEAR: PaymentMethodsByMonth = {
  months: [
    {
      month: '2024-02',
      perStore: { uzoshop: totals([10, 1000], [4, 400], [1, 100]) },
      business: totals([10, 1000], [4, 400], [1, 100]),
    },
    {
      month: '2024-07',
      perStore: { uzoshop: totals([20, 2000], [6, 600], [2, 200]) },
      business: totals([20, 2000], [6, 600], [2, 200]),
    },
    {
      month: '2025-11',
      perStore: { uzoshop: totals([30, 3000], [8, 800], [3, 300]) },
      business: totals([30, 3000], [8, 800], [3, 300]),
    },
    {
      month: '2026-02',
      perStore: { uzoshop: totals([40, 4000], [10, 1000], [4, 400]) },
      business: totals([40, 4000], [10, 1000], [4, 400]),
    },
    {
      month: '2026-05',
      perStore: { uzoshop: totals([50, 5000], [12, 1200], [5, 500]) },
      business: totals([50, 5000], [12, 1200], [5, 500]),
    },
    {
      month: '2026-06',
      perStore: { uzoshop: totals([60, 6000], [14, 1400], [6, 600]) },
      business: totals([60, 6000], [14, 1400], [6, 600]),
    },
  ],
};

function renderTab(extra?: Record<string, unknown>) {
  return render(
    <PaymentMethodsTab
      stores={['uzoshop', 'zolplus', 'usmile360']}
      injectedData={DATA}
      {...extra}
    />,
  );
}

function renderMultiYear(extra?: Record<string, unknown>) {
  return render(
    <PaymentMethodsTab
      stores={['uzoshop', 'zolplus', 'usmile360']}
      injectedData={MULTI_YEAR}
      {...extra}
    />,
  );
}

// ---------------------------------------------------------------------------
// Pure grouping helpers — unit tests (no DOM).
// ---------------------------------------------------------------------------
describe('PaymentMethodsTab — pure grouping helpers', () => {
  it('groupMonthsByYear buckets month-rows into DESC years with year aggregates', () => {
    const rows = MULTI_YEAR.months.map((m) => ({
      month: m.month,
      totals: m.business,
    }));
    const years = groupMonthsByYear(rows);
    // 2026, 2025, 2024 — descending.
    expect(years.map((y) => y.year)).toEqual(['2026', '2025', '2024']);
    // 2024 aggregate credit = 10 + 20 = 30 orders, 1000 + 2000 = 3000 CAD.
    const y2024 = years.find((y) => y.year === '2024')!;
    expect(y2024.totals.credit.orders).toBe(30);
    expect(y2024.totals.credit.revenueCad).toBe(3000);
    // 2026 aggregate credit = 40 + 50 + 60 = 150 orders.
    const y2026 = years.find((y) => y.year === '2026')!;
    expect(y2026.totals.credit.orders).toBe(150);
    // each year carries its member month rows.
    expect(y2026.rows.map((r) => r.month).sort()).toEqual([
      '2026-02',
      '2026-05',
      '2026-06',
    ]);
  });

  it('periodKey maps a month to year / quarter / third buckets', () => {
    expect(periodKey('2026-02', 'month')).toBe('2026-02');
    // Feb → Q1, May/Jun → Q2, Jul → Q3, Nov → Q4.
    expect(periodKey('2026-02', 'quarter')).toBe('2026-Q1');
    expect(periodKey('2026-05', 'quarter')).toBe('2026-Q2');
    expect(periodKey('2026-07', 'quarter')).toBe('2026-Q3');
    expect(periodKey('2025-11', 'quarter')).toBe('2025-Q4');
    // thirds = 4 months each: Jan-Apr=T1, May-Aug=T2, Sep-Dec=T3.
    expect(periodKey('2026-02', 'third')).toBe('2026-T1');
    expect(periodKey('2026-05', 'third')).toBe('2026-T2');
    expect(periodKey('2026-07', 'third')).toBe('2026-T2');
    expect(periodKey('2025-11', 'third')).toBe('2025-T3');
  });

  it('periodLabel renders the Hebrew period label', () => {
    expect(periodLabel('2026-05', 'month')).toMatch(/2026/);
    expect(periodLabel('2026-Q2', 'quarter')).toContain('2026');
    expect(periodLabel('2026-Q2', 'quarter')).toMatch(/2|רבעון|Q/);
    expect(periodLabel('2026-T1', 'third')).toContain('2026');
    expect(periodLabel('2026-T1', 'third')).toMatch(/שליש|1/);
  });
});

describe('PaymentMethodsTab — scope toggle + summary cards', () => {
  it('renders the business / per-store scope toggle', () => {
    renderTab();
    expect(screen.getByTestId('pm-scope-business')).toBeInTheDocument();
    expect(screen.getByTestId('pm-scope-store')).toBeInTheDocument();
  });

  it('renders 3 gateway summary cards, each carrying a % share', () => {
    renderTab();
    const cards = screen.getAllByTestId('pm-summary-card');
    // credit / paypal / other (the wide totals card is a separate testid).
    expect(cards).toHaveLength(3);
    for (const c of cards) {
      expect(c.textContent).toMatch(/%/);
    }
  });

  it('the all-history summary strip aggregates across ALL months for the scope', () => {
    renderTab();
    // Business total orders across both months = 300+120+15+120+50+6 = 611.
    const totalCard = screen.getByTestId('pm-summary-total');
    expect(totalCard.textContent).toContain('611');
  });

  it('renders CAD via <Money> (tabular .metric-num bdi, never clipped)', () => {
    const { container } = renderTab();
    const moneyEls = container.querySelectorAll('bdi.metric-num');
    expect(moneyEls.length).toBeGreaterThan(0);
    // No clipping/truncation utilities on the money cells.
    for (const el of moneyEls) {
      expect(el.className).not.toContain('truncate');
    }
  });
});

describe('PaymentMethodsTab — by-year accordion', () => {
  it('renders one collapsible row per year, DESC, each with the year aggregate', () => {
    renderMultiYear();
    expect(screen.getByTestId('pm-year-2026')).toBeInTheDocument();
    expect(screen.getByTestId('pm-year-2025')).toBeInTheDocument();
    expect(screen.getByTestId('pm-year-2024')).toBeInTheDocument();
    // The 2024 year summary shows its aggregate credit count = 30.
    const y2024 = screen.getByTestId('pm-year-2024');
    expect(y2024.textContent).toContain('30');
  });

  it('expands the most-recent year by default; older years collapsed', () => {
    renderMultiYear();
    const y2026 = screen.getByTestId('pm-year-row-2026') as HTMLDetailsElement;
    const y2024 = screen.getByTestId('pm-year-row-2024') as HTMLDetailsElement;
    expect(y2026.open).toBe(true);
    expect(y2024.open).toBe(false);
  });

  it('the expanded current year reveals month sub-rows (default granularity = month)', () => {
    renderMultiYear();
    // 2026 is open by default → its three month sub-rows render.
    expect(screen.getByTestId('pm-period-2026-02')).toBeInTheDocument();
    expect(screen.getByTestId('pm-period-2026-05')).toBeInTheDocument();
    expect(screen.getByTestId('pm-period-2026-06')).toBeInTheDocument();
  });

  it('renders a footer grand-total row', () => {
    renderMultiYear();
    expect(screen.getByTestId('pm-total-row')).toBeInTheDocument();
  });
});

describe('PaymentMethodsTab — granularity toggle re-groups sub-rows', () => {
  it('switching to quarter groups 2026 sub-rows into Q1 / Q2', () => {
    renderMultiYear();
    // default month sub-rows present.
    expect(screen.getByTestId('pm-period-2026-05')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('pm-gran-quarter'));
    // 2026: Feb→Q1, May+Jun→Q2.
    expect(screen.getByTestId('pm-period-2026-Q1')).toBeInTheDocument();
    expect(screen.getByTestId('pm-period-2026-Q2')).toBeInTheDocument();
    // the month sub-rows are gone (regrouped).
    expect(screen.queryByTestId('pm-period-2026-05')).toBeNull();
    // Q2 aggregates May credit 50 + Jun credit 60 = 110 orders.
    expect(screen.getByTestId('pm-period-2026-Q2').textContent).toContain('110');
  });

  it('switching to third groups 2026 sub-rows into T1 / T2', () => {
    renderMultiYear();
    fireEvent.click(screen.getByTestId('pm-gran-third'));
    // 2026: Feb→T1, May+Jun→T2.
    expect(screen.getByTestId('pm-period-2026-T1')).toBeInTheDocument();
    expect(screen.getByTestId('pm-period-2026-T2')).toBeInTheDocument();
    expect(screen.queryByTestId('pm-period-2026-Q2')).toBeNull();
    expect(screen.queryByTestId('pm-period-2026-05')).toBeNull();
  });

  it('only periods that have data render (no empty quarter/third sub-rows)', () => {
    renderMultiYear();
    fireEvent.click(screen.getByTestId('pm-gran-quarter'));
    // 2026 has no Q3/Q4 data → those sub-rows are absent.
    expect(screen.queryByTestId('pm-period-2026-Q3')).toBeNull();
    expect(screen.queryByTestId('pm-period-2026-Q4')).toBeNull();
  });
});

describe('PaymentMethodsTab — share bar uses token colours', () => {
  it('paints credit=accent, paypal=chart-meta(blue), other=ink-subtle — never a hex', () => {
    const { container } = renderTab();
    const bar = container.querySelector('[data-testid="pm-summary-sharebar"]');
    expect(bar).not.toBeNull();
    const html = bar!.innerHTML;
    expect(html).toContain('bg-accent');
    expect(html).toContain('bg-chart-meta');
    expect(html).toContain('bg-ink-subtle');
    // No raw colour literal leaked into the bar markup.
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });
});

describe('PaymentMethodsTab — scope switch changes the numbers', () => {
  it('switching to per-store + picking a store changes the year aggregate', () => {
    renderTab();
    // Business 2026 year credit = 300 (May) + 120 (Jun) = 420 orders.
    const bizYear = screen.getByTestId('pm-year-2026').textContent ?? '';
    expect(bizYear).toContain('420');

    // Switch to per-store. Store picker appears; pick zolplus.
    fireEvent.click(screen.getByTestId('pm-scope-store'));
    const picker = screen.getByTestId('pm-store-picker') as HTMLSelectElement;
    fireEvent.change(picker, { target: { value: 'zolplus' } });

    // zolplus only has May credit = 100 orders (not 420).
    const zolYear = screen.getByTestId('pm-year-2026').textContent ?? '';
    expect(zolYear).toContain('100');
    expect(zolYear).not.toContain('420');
  });

  it('a store with data in only some months omits the empty period sub-rows', () => {
    renderTab();
    fireEvent.click(screen.getByTestId('pm-scope-store'));
    const picker = screen.getByTestId('pm-store-picker') as HTMLSelectElement;
    fireEvent.change(picker, { target: { value: 'zolplus' } });
    // zolplus only has 2026-05 data → the 2026-06 month sub-row is absent.
    expect(screen.queryByTestId('pm-period-2026-06')).toBeNull();
    expect(screen.getByTestId('pm-period-2026-05')).toBeInTheDocument();
  });
});

describe('PaymentMethodsTab — pre-backfill graceful state', () => {
  it('shows a "waiting for backfill" hint when the data is mostly NULL (all-other)', () => {
    // Pre-backfill: every order falls into "other" (NULL gateway → other).
    const preBackfill: PaymentMethodsByMonth = {
      months: [
        {
          month: '2026-05',
          perStore: { uzoshop: totals([0, 0], [0, 0], [300, 27000]) },
          business: totals([0, 0], [0, 0], [300, 27000]),
        },
      ],
    };
    renderTab({ injectedData: preBackfill });
    expect(screen.getByTestId('pm-backfill-hint')).toBeInTheDocument();
  });

  it('renders an empty state when there are no months at all', () => {
    renderTab({ injectedData: { months: [] } as PaymentMethodsByMonth });
    expect(screen.getByTestId('pm-empty')).toBeInTheDocument();
  });
});

describe('PaymentMethodsTab — note credit (numbers from Shopify)', () => {
  it('renders the Shopify-source note', () => {
    renderTab();
    const note = screen.getByTestId('pm-note');
    expect(within(note).getByText(/Shopify/)).toBeInTheDocument();
  });
});
