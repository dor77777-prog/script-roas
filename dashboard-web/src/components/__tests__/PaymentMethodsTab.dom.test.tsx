/**
 * תשלומים (2026-06-03) — PaymentMethodsTab DOM tests. Ports the approved mockup
 * `docs/superpowers/mockups/2026-06-03-payment-methods/payment-methods-mockup.html`.
 *
 * The tab is fed a `PaymentMethodsByMonth` aggregate via `injectedData`
 * (test-only bypass of the `/api/payment-methods` SWR fetch) so the assertions
 * run with no network. Same injection contract as CustomerValueTab.injectedRows.
 *
 * Coverage (per plan Task 7 Step 1):
 *  - the scope toggle (business / per-store) renders
 *  - the 3 gateway summary cards (credit / paypal / other) render WITH a %
 *  - a per-month row renders credit/paypal/other orders + CAD
 *  - switching to per-store + picking a store changes the rendered totals
 *  - CAD renders via <Money> (tabular `.metric-num` <bdi>, never clipped)
 *  - the share-bar uses TOKEN colour classes (accent / chart-meta / ink-subtle),
 *    never a hardcoded colour
 *  - pre-backfill NULL-heavy data degrades gracefully (waiting-for-backfill hint)
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { PaymentMethodsTab } from '@/components/PaymentMethodsTab';
import type { PaymentMethodsByMonth } from '@/lib/postgresReaders';

// Two months, two stores, mixed gateways. Business rollup = sum over stores.
//  uzoshop  2026-05: credit 200/18000 · paypal 80/7200 · other 10/900
//  zolplus  2026-05: credit 100/9000  · paypal 40/3600 · other  5/450
//  uzoshop  2026-06: credit 120/10800 · paypal 50/4500 · other  6/540
const DATA: PaymentMethodsByMonth = {
  months: [
    {
      month: '2026-05',
      perStore: {
        uzoshop: {
          credit: { orders: 200, revenueCad: 18000 },
          paypal: { orders: 80, revenueCad: 7200 },
          other: { orders: 10, revenueCad: 900 },
        },
        zolplus: {
          credit: { orders: 100, revenueCad: 9000 },
          paypal: { orders: 40, revenueCad: 3600 },
          other: { orders: 5, revenueCad: 450 },
        },
      },
      business: {
        credit: { orders: 300, revenueCad: 27000 },
        paypal: { orders: 120, revenueCad: 10800 },
        other: { orders: 15, revenueCad: 1350 },
      },
    },
    {
      month: '2026-06',
      perStore: {
        uzoshop: {
          credit: { orders: 120, revenueCad: 10800 },
          paypal: { orders: 50, revenueCad: 4500 },
          other: { orders: 6, revenueCad: 540 },
        },
      },
      business: {
        credit: { orders: 120, revenueCad: 10800 },
        paypal: { orders: 50, revenueCad: 4500 },
        other: { orders: 6, revenueCad: 540 },
      },
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

describe('PaymentMethodsTab — per-month table', () => {
  it('renders a per-month row with credit/paypal/other orders + CAD', () => {
    renderTab();
    // Business scope (default): both months appear as rows.
    expect(screen.getByTestId('pm-row-2026-05')).toBeInTheDocument();
    expect(screen.getByTestId('pm-row-2026-06')).toBeInTheDocument();
    const may = screen.getByTestId('pm-row-2026-05');
    // Business May credit orders = 300.
    expect(may.textContent).toContain('300');
  });

  it('renders a footer total row', () => {
    renderTab();
    expect(screen.getByTestId('pm-total-row')).toBeInTheDocument();
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
  it('switching to per-store + picking a store changes the rendered May totals', () => {
    renderTab();
    const bizMay = screen.getByTestId('pm-row-2026-05').textContent ?? '';
    // Business May credit = 300 orders.
    expect(bizMay).toContain('300');

    // Switch to per-store. Store picker appears; default first store = uzoshop.
    fireEvent.click(screen.getByTestId('pm-scope-store'));
    const picker = screen.getByTestId('pm-store-picker') as HTMLSelectElement;
    fireEvent.change(picker, { target: { value: 'zolplus' } });

    const zolMay = screen.getByTestId('pm-row-2026-05').textContent ?? '';
    // zolplus May credit = 100 orders (not the business 300).
    expect(zolMay).toContain('100');
    expect(zolMay).not.toContain('300');
  });

  it('a store with no data in a month omits that month row', () => {
    renderTab();
    fireEvent.click(screen.getByTestId('pm-scope-store'));
    const picker = screen.getByTestId('pm-store-picker') as HTMLSelectElement;
    fireEvent.change(picker, { target: { value: 'zolplus' } });
    // zolplus only has 2026-05 data → the 2026-06 row is absent.
    expect(screen.queryByTestId('pm-row-2026-06')).toBeNull();
  });
});

describe('PaymentMethodsTab — pre-backfill graceful state', () => {
  it('shows a "waiting for backfill" hint when the data is mostly NULL (all-other)', () => {
    // Pre-backfill: every order falls into "other" (NULL gateway → other).
    const preBackfill: PaymentMethodsByMonth = {
      months: [
        {
          month: '2026-05',
          perStore: {
            uzoshop: {
              credit: { orders: 0, revenueCad: 0 },
              paypal: { orders: 0, revenueCad: 0 },
              other: { orders: 300, revenueCad: 27000 },
            },
          },
          business: {
            credit: { orders: 0, revenueCad: 0 },
            paypal: { orders: 0, revenueCad: 0 },
            other: { orders: 300, revenueCad: 27000 },
          },
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
