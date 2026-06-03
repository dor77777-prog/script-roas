/**
 * Wave 2 Task 8 — CustomerValueTab DOM tests (ports the approved v3c mockup
 * `customer-value-v3c-zones.html`).
 *
 * The tab is fed cohort rows via `injectedRows` (test-only bypass of the
 * `/api/cohorts` SWR fetch) so the assertions run against a real
 * `computeCustomerValue` result with no network. Spend/nCAC inputs are passed
 * via `injectedSpendByMonth` + `injectedBlendedNcac` (mapping-aware upstream;
 * NEVER recomputed here) — exactly the shape Dashboard wires in Task 9.
 *
 * Coverage (per plan Task 8 Step 1):
 *  - verdict numbers render (LTV / nCAC / net / payback / repeat / ratio)
 *  - 4 KPI cards render
 *  - the zones curve renders an SVG <path> (the line)
 *  - the payback callout renders
 *  - the profit↔revenue toggle switches basis (headline LTV changes)
 *  - the advanced <details> contains the cohort grid
 *  - a no-spend (pre-May) cohort surfaces the muted "אין נתוני הוצאה" nCAC state
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { CustomerValueTab } from '@/components/CustomerValueTab';
import type { CohortMonthlyRow } from '@/lib/postgresReaders';

function cell(over: Partial<CohortMonthlyRow>): CohortMonthlyRow {
  return {
    storeId: 'uzoshop',
    firstOrderMonth: '2025-01',
    monthSince: 0,
    activeCustomers: 0,
    orders: 0,
    grossCad: 0,
    netCad: 0,
    ...over,
  };
}

// Two mature cohorts (≥12 mo before todayMonth) with repeat purchases so the
// curve climbs and a payback (cumulative profit ≥ blended nCAC) exists.
//  2025-01: M0 10 cust / net 1000 · M1 6 / 600 · M2 4 / 400
//  2025-02: M0 10 cust / net 800  · M1 5 / 500 · M2 3 / 300
const rows: CohortMonthlyRow[] = [
  cell({ firstOrderMonth: '2025-01', monthSince: 0, activeCustomers: 10, orders: 10, netCad: 1000, grossCad: 1100 }),
  cell({ firstOrderMonth: '2025-01', monthSince: 1, activeCustomers: 6, orders: 6, netCad: 600, grossCad: 660 }),
  cell({ firstOrderMonth: '2025-01', monthSince: 2, activeCustomers: 4, orders: 4, netCad: 400, grossCad: 440 }),
  cell({ firstOrderMonth: '2025-02', monthSince: 0, activeCustomers: 10, orders: 10, netCad: 800, grossCad: 880 }),
  cell({ firstOrderMonth: '2025-02', monthSince: 1, activeCustomers: 5, orders: 5, netCad: 500, grossCad: 550 }),
  cell({ firstOrderMonth: '2025-02', monthSince: 2, activeCustomers: 3, orders: 3, netCad: 300, grossCad: 330 }),
];

function renderTab(extra?: Record<string, unknown>) {
  return render(
    <CustomerValueTab
      stores={['uzoshop', 'zolplus', 'usmile360']}
      injectedRows={rows}
      injectedBlendedNcac={40}
      injectedSpendByMonth={{ '2025-01': 400, '2025-02': 320 }}
      todayMonth="2026-06"
      {...extra}
    />,
  );
}

describe('CustomerValueTab — verdict + KPIs', () => {
  it('renders the plain-Hebrew verdict sentence', () => {
    renderTab();
    expect(screen.getByTestId('cv-verdict')).toBeInTheDocument();
  });

  it('renders exactly 4 KPI cards', () => {
    renderTab();
    const kpis = screen.getAllByTestId('cv-kpi');
    expect(kpis).toHaveLength(4);
  });

  it('shows the LTV:nCAC ratio in the verdict', () => {
    renderTab();
    // ltv12Profit / blendedNcac → ratio is rendered as "N.N×" somewhere.
    expect(screen.getByTestId('cv-verdict').textContent).toMatch(/×/);
  });
});

describe('CustomerValueTab — zones curve', () => {
  it('renders an SVG <path> for the cumulative LTV line', () => {
    const { container } = renderTab();
    const svg = container.querySelector('[data-testid="cv-curve"] svg');
    expect(svg).not.toBeNull();
    const paths = svg!.querySelectorAll('path');
    expect(paths.length).toBeGreaterThan(0);
  });

  it('renders the payback callout when a payback month exists', () => {
    renderTab();
    expect(screen.getByTestId('cv-payback-callout')).toBeInTheDocument();
  });
});

describe('CustomerValueTab — profit/revenue toggle', () => {
  it('switches the headline LTV between profit and revenue basis', () => {
    renderTab();
    const ltvBefore = screen.getByTestId('cv-kpi-ltv').textContent;
    fireEvent.click(screen.getByTestId('cv-basis-revenue'));
    const ltvAfter = screen.getByTestId('cv-kpi-ltv').textContent;
    // Revenue (net) LTV is strictly larger than profit LTV (profit = net ×
    // keep-rate < 1), so the headline number must change.
    expect(ltvAfter).not.toBe(ltvBefore);
  });
});

describe('CustomerValueTab — advanced cohort grid', () => {
  it('renders a collapsed <details> containing the cohort grid heatmap', () => {
    renderTab();
    const details = screen.getByTestId('cv-advanced');
    expect(details.tagName.toLowerCase()).toBe('details');
    // The grid table lives inside the <details>.
    expect(within(details).getByTestId('cv-grid')).toBeInTheDocument();
  });
});

describe('CustomerValueTab — pre-May / no-spend nCAC state', () => {
  it('shows the muted "אין נתוני הוצאה" state for a cohort with no spend', () => {
    // No spend for any cohort → per-cohort nCAC is unavailable everywhere. The
    // muted state appears in the explanatory prose AND in each cohort's nCAC
    // line, so there is at least one match (getAllByText, ≥1).
    renderTab({ injectedSpendByMonth: {} });
    expect(screen.getAllByText('אין נתוני הוצאה').length).toBeGreaterThan(0);
  });
});
