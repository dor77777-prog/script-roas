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
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
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

  it('renders a RED badge (not amber) for a genuinely bad LTV:nCAC ratio (<2×)', () => {
    // A very high blended nCAC drives the ratio below 2 → tone "bad".
    const { container } = renderTab({ injectedBlendedNcac: 9999 });
    const verdict = container.querySelector('[data-testid="cv-verdict"]');
    expect(verdict).not.toBeNull();
    const badge = verdict!.querySelector('[data-testid="cv-ratio-badge"]');
    expect(badge).not.toBeNull();
    // Bad ratio → red badge tokens, never the amber warning tokens.
    expect(badge!.className).toContain('text-status-redFg');
    expect(badge!.className).not.toContain('text-status-warningFg');
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

  it('fills the payback callout pill with the AA-safe accent-btn token (white-on-accent fails AA)', () => {
    const { container } = renderTab();
    const callout = container.querySelector('[data-testid="cv-payback-callout"]');
    expect(callout).not.toBeNull();
    const rect = callout!.querySelector('rect');
    expect(rect).not.toBeNull();
    // --accent is reserved for rings/glows/links (white on it is only 3.86:1
    // dark / 2.96:1 light → below AA). The text-bearing pill MUST use the
    // deepened --accent-btn (white = 5.33:1 dark / 4.66:1 light, AA-verified).
    expect(rect!.getAttribute('fill')).toBe('var(--accent-btn)');
  });
});

describe('CustomerValueTab — payback zone-split coherence', () => {
  // The zone split must sit where the VISIBLE curve crosses break-even. The
  // headline paybackMonths is always profit-derived, so on the revenue (net)
  // basis it must NOT be forced onto the net curve (net ≥ profit → net crosses
  // earlier). The tab passes paybackMonths only in profit basis; net basis
  // lets the curve derive its own crossing from the net points it is drawing.
  //
  // Fixture tuned so profit pays back LATER than net: a flat-ish curve whose
  // net crosses the nCAC line a month before profit does.
  const splitRows: CohortMonthlyRow[] = [
    cell({ firstOrderMonth: '2025-01', monthSince: 0, activeCustomers: 10, orders: 10, netCad: 600, grossCad: 660 }),
    cell({ firstOrderMonth: '2025-01', monthSince: 1, activeCustomers: 5, orders: 5, netCad: 300, grossCad: 330 }),
    cell({ firstOrderMonth: '2025-01', monthSince: 2, activeCustomers: 4, orders: 4, netCad: 250, grossCad: 275 }),
    cell({ firstOrderMonth: '2025-01', monthSince: 3, activeCustomers: 3, orders: 3, netCad: 200, grossCad: 220 }),
  ];

  function calloutMonth(container: HTMLElement): string | null {
    const callout = container.querySelector('[data-testid="cv-payback-callout"]');
    const texts = callout?.querySelectorAll('text');
    if (!texts) return null;
    // The 2nd <text> in the callout reads "חודש N".
    return texts[1]?.textContent ?? null;
  }

  it('uses a basis-coherent payback split (net crosses earlier than profit)', () => {
    const { container } = render(
      <CustomerValueTab
        stores={['uzoshop']}
        injectedRows={splitRows}
        injectedBlendedNcac={75}
        injectedSpendByMonth={{ '2025-01': 750 }}
        todayMonth="2026-06"
      />,
    );
    // Profit basis (default): split at the profit-payback month.
    const profitMonth = calloutMonth(container);
    fireEvent.click(screen.getByTestId('cv-basis-revenue'));
    const netMonth = calloutMonth(container);
    // Both must render a callout. Net crosses break-even strictly EARLIER than
    // profit (net ≥ profit), so the net split must sit to the LEFT of the
    // profit split — proving the net basis is NOT forced onto the profit-derived
    // payback month.
    expect(profitMonth).toMatch(/חודש/);
    expect(netMonth).toMatch(/חודש/);
    const profN = Number(profitMonth!.replace(/[^\d.]/g, ''));
    const netN = Number(netMonth!.replace(/[^\d.]/g, ''));
    expect(netN).toBeLessThan(profN);
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

describe('CustomerValueTab — LTV explainer is a rich tooltip (Phase 3a)', () => {
  // The ~400-char LTV explainer (the longest tooltip in the app) was promoted
  // from a plain-string simple bubble to variant="rich" + a title. On a fine
  // pointer that opens a Radix Popover (role="dialog", mode B) — never a
  // role="tooltip" — and preserves the EXACT body text (no info loss).
  it('opens a role=dialog (not a tooltip) carrying the full explainer text', async () => {
    renderTab();
    // The ⓘ-style trigger keeps its accessible label on desktop.
    const trigger = screen.getByLabelText('הסבר על העקומה');
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog');
    // Title + a distinctive mid-string body fragment both render verbatim.
    expect(dialog).toHaveTextContent('על מה זה מתבסס');
    expect(dialog).toHaveTextContent('קו עלות-הגיוס (nCAC) הוא הבלנדי');
    // Rich content must NEVER be a role="tooltip".
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('Esc closes the explainer dialog', async () => {
    renderTab();
    fireEvent.click(screen.getByLabelText('הסבר על העקומה'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
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
