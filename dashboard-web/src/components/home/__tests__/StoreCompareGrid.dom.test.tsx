// dashboard-web/src/components/home/__tests__/StoreCompareGrid.dom.test.tsx
//
// <StoreCompareGrid> — the comparative-analysis card below the per-store row.
// One <TableRow> per store; columns חנות · הוצאה · הכנסה · ROAS · CPM · AOV ·
// הזמנות. The ROAS cell is a band-coloured pill whose band is classified
// through the SINGLE SOURCE OF TRUTH `bandForRoas` (lib/roasBands.ts: <2 red /
// <2.7 orange / <=3 green / >3 blue / spend===0 gray) and rendered with the
// shared `band-chip` + `chip-{band}` recipe (the SAME pill the hero/Widget band
// tags use). These tests pin (a) the table renders one row per store, (b) the
// ROAS pill carries the right band per threshold (proving the bandForRoas
// drain — 1.9x → red, 2.88x → green, 3.7x → blue), (c) money values render via
// the overflow-safe <Money> primitive (tabular-nums), and (d) the NC-ROAS/nCAC
// footer renders the threaded business-wide aggregate (degrading gracefully
// when a field is absent / confidence is suppressed).

import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { StoreCompareGrid } from '@/components/home/StoreCompareGrid';
import type { PerStoreData } from '@/components/home/PerStoreRow';
import type { CommandCenterNewCustomer } from '@/components/home/CommandCenterHero';

const STORES: PerStoreData[] = [
  {
    storeId: 'store-low',
    storeName: 'uzoshop',
    spend: 685,
    revenue: 1233, // 1.8x → red tone
    orders: 24,
    aov: 51.4,
    roas: 1.8,
    updatedAt: null,
    perPlatformCpm: { meta: { cpm: 9.12, spend: 685 } },
  },
  {
    storeId: 'store-mid',
    storeName: 'usmile360',
    spend: 1392,
    revenue: 3897, // 2.8x → green tone (2.7-3.0)
    orders: 68,
    aov: 57.3,
    roas: 2.8,
    updatedAt: null,
    perPlatformCpm: { meta: { cpm: 8.62, spend: 868 } },
  },
  {
    storeId: 'store-high',
    storeName: 'zolplus',
    spend: 1847,
    revenue: 6834, // 3.7x → blue tone (>3.0)
    orders: 79,
    aov: 86.5,
    roas: 3.7,
    updatedAt: null,
    perPlatformCpm: {
      meta: { cpm: 7.94, spend: 842 },
      google: { cpm: 8.18, spend: 612 },
    },
  },
];

describe('StoreCompareGrid', () => {
  it('renders one body row per store (3 rows)', () => {
    const { container } = render(<StoreCompareGrid stores={STORES} />);
    const rows = container.querySelectorAll(
      'tbody tr[data-testid="store-compare-row"]',
    );
    expect(rows).toHaveLength(3);
  });

  it('renders the section heading "ניתוח השוואתי"', () => {
    render(<StoreCompareGrid stores={STORES} />);
    expect(screen.getByText('ניתוח השוואתי')).toBeInTheDocument();
  });

  it('renders the column headers in order', () => {
    render(<StoreCompareGrid stores={STORES} />);
    for (const h of ['חנות', 'הוצאה', 'הכנסה', 'ROAS', 'CPM', 'AOV', 'הזמנות']) {
      expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    }
  });

  it('shows each store name', () => {
    render(<StoreCompareGrid stores={STORES} />);
    expect(screen.getByText('uzoshop')).toBeInTheDocument();
    expect(screen.getByText('usmile360')).toBeInTheDocument();
    expect(screen.getByText('zolplus')).toBeInTheDocument();
  });

  // ── band-drain proof — the ROAS pill classifies through bandForRoas (single
  //    source of truth) and renders the shared `band-chip chip-{band}` recipe,
  //    NOT a local parallel band map. A known ROAS lands in the operator-locked
  //    band: 1.9x → red, 2.88x → green (2.7-3.0), 3.7x → blue (>3.0).

  it('ROAS pill carries the RED band (chip-red) for a 1.9x store (<2.0) — bandForRoas drain', () => {
    const redStore: PerStoreData = { ...STORES[0], roas: 1.9, revenue: 1301 };
    const { container } = render(<StoreCompareGrid stores={[redStore]} />);
    const pill = container.querySelector('[data-testid="roas-pill"]');
    expect(pill).not.toBeNull();
    expect(pill).toHaveClass('band-chip');
    expect(pill).toHaveClass('chip-red');
    expect(pill).toHaveAttribute('data-tone', 'red');
  });

  it('ROAS pill carries the GREEN band (chip-green) for a 2.88x store (2.7-3.0) — bandForRoas drain', () => {
    const greenStore: PerStoreData = { ...STORES[1], roas: 2.88 };
    const { container } = render(<StoreCompareGrid stores={[greenStore]} />);
    const pill = container.querySelector('[data-testid="roas-pill"]');
    expect(pill).toHaveClass('band-chip');
    expect(pill).toHaveClass('chip-green');
    expect(pill).toHaveAttribute('data-tone', 'green');
  });

  it('ROAS pill carries the BLUE band (chip-blue) for a 3.7x store (>3.0) — bandForRoas drain', () => {
    const { container } = render(<StoreCompareGrid stores={[STORES[2]]} />);
    const pill = container.querySelector('[data-testid="roas-pill"]');
    expect(pill).toHaveClass('band-chip');
    expect(pill).toHaveClass('chip-blue');
    expect(pill).toHaveAttribute('data-tone', 'blue');
  });

  it('ROAS pill text shows the formatted ROAS multiple', () => {
    const { container } = render(<StoreCompareGrid stores={[STORES[2]]} />);
    const pill = container.querySelector('[data-testid="roas-pill"]');
    expect(pill?.textContent).toContain('3.70x');
  });

  it('money cells render via the overflow-safe <Money> primitive (tabular-nums)', () => {
    const { container } = render(<StoreCompareGrid stores={[STORES[0]]} />);
    const row = container.querySelector(
      'tbody tr[data-testid="store-compare-row"]',
    )!;
    // spend $685 + revenue $1,233 each render through <Money> (.metric-num)
    const moneyEls = within(row as HTMLElement)
      .getAllByText((_t, el) => el?.classList.contains('metric-num') ?? false);
    expect(moneyEls.length).toBeGreaterThanOrEqual(2);
    for (const el of moneyEls) expect(el).toHaveClass('metric-num');
  });

  it('spend cell tints subtle red, revenue subtle green; CPM/AOV/orders neutral', () => {
    const { container } = render(<StoreCompareGrid stores={[STORES[0]]} />);
    const row = container.querySelector(
      'tbody tr[data-testid="store-compare-row"]',
    )!;
    const spend = row.querySelector('[data-cell="spend"]');
    const revenue = row.querySelector('[data-cell="revenue"]');
    const cpm = row.querySelector('[data-cell="cpm"]');
    const aov = row.querySelector('[data-cell="aov"]');
    const orders = row.querySelector('[data-cell="orders"]');
    expect(spend).toHaveClass('bg-status-redBg');
    expect(revenue).toHaveClass('bg-status-greenBg');
    // Neutral cells must NOT carry any status background tint.
    for (const el of [cpm, aov, orders]) {
      expect(el?.className ?? '').not.toContain('bg-status-');
    }
  });

  it('renders nothing when stores is empty', () => {
    const { container } = render(<StoreCompareGrid stores={[]} />);
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelector('[data-testid="store-compare-row"]')).toBeNull();
  });

  it('gray tone + "—" pill text when ROAS is null (no data)', () => {
    const noRoas: PerStoreData = {
      ...STORES[0],
      storeId: 'store-null',
      storeName: 'noroas',
      roas: null,
    };
    const { container } = render(<StoreCompareGrid stores={[noRoas]} />);
    const pill = container.querySelector('[data-testid="roas-pill"]');
    expect(pill).toHaveAttribute('data-tone', 'gray');
    expect(pill?.textContent).toContain('—');
  });

  // ── ads-off Phase 2 — RoasPill off-display ────────────────────────────────

  it('ads-off organic: blue tone + "אורגני" when adOff=true, spend=0, revenue>0', () => {
    const organicStore: PerStoreData = {
      storeId: 'store-organic',
      storeName: 'organicstore',
      spend: 0,
      revenue: 250,
      orders: 12,
      aov: 20.8,
      roas: null,
      updatedAt: null,
      perPlatformCpm: {},
      adOff: true,
    };
    const { container } = render(<StoreCompareGrid stores={[organicStore]} />);
    const pill = container.querySelector('[data-testid="roas-pill"]');
    expect(pill).toHaveAttribute('data-tone', 'blue');
    expect(pill?.textContent).toContain('אורגני');
  });

  it('ads-off empty: gray tone + "0" when adOff=true, spend=0, revenue=0', () => {
    const emptyStore: PerStoreData = {
      storeId: 'store-off-empty',
      storeName: 'emptystore',
      spend: 0,
      revenue: 0,
      orders: 0,
      aov: null,
      roas: null,
      updatedAt: null,
      perPlatformCpm: {},
      adOff: true,
    };
    const { container } = render(<StoreCompareGrid stores={[emptyStore]} />);
    const pill = container.querySelector('[data-testid="roas-pill"]');
    expect(pill).toHaveAttribute('data-tone', 'gray');
    expect(pill?.textContent).toContain('0');
  });

  it('ads-off historical spend>0: normal pill (number, not off-state) when adOff=true but spend>0', () => {
    // spend>0 → adDisplayState returns 'normal' regardless of adOff
    const historicalStore: PerStoreData = {
      storeId: 'store-historical',
      storeName: 'historicalstore',
      spend: 40,
      revenue: 120,
      orders: 5,
      aov: 24,
      roas: 3,       // 3.0 → green tone
      updatedAt: null,
      perPlatformCpm: {},
      adOff: true,
    };
    const { container } = render(<StoreCompareGrid stores={[historicalStore]} />);
    const pill = container.querySelector('[data-testid="roas-pill"]');
    expect(pill).toHaveAttribute('data-tone', 'green');
    expect(pill?.textContent).toContain('3.00x');
  });

  it('regression: adOff=false with spend=100, revenue=300, roas=3 → normal green pill', () => {
    const normalStore: PerStoreData = {
      storeId: 'store-normal',
      storeName: 'normalstore',
      spend: 100,
      revenue: 300,
      orders: 10,
      aov: 30,
      roas: 3,       // 3.0 → green tone
      updatedAt: null,
      perPlatformCpm: {},
      adOff: false,
    };
    const { container } = render(<StoreCompareGrid stores={[normalStore]} />);
    const pill = container.querySelector('[data-testid="roas-pill"]');
    expect(pill).toHaveAttribute('data-tone', 'green');
    expect(pill?.textContent).toContain('3.00x');
  });

  // ── NC-ROAS / nCAC footer (mockup 306-311) ───────────────────────────────
  // Reuses the EXACT business-wide CommandCenterNewCustomer aggregate the hero
  // renders (threaded as a prop from Dashboard — no second NC aggregate). The
  // footer hides entirely when the prop is omitted (back-compat).

  const NC_OK: CommandCenterNewCustomer = {
    ncRoas: 1.74,
    nCac: 64,
    ncOrders: 15,
    returningOrders: 10,
    unclassifiableShare: 0,
    confidence: 'ok',
  };

  it('does NOT render the NC footer when newCustomer is omitted (back-compat)', () => {
    const { container } = render(<StoreCompareGrid stores={STORES} />);
    expect(
      container.querySelector('[data-testid="store-compare-nc-footer"]'),
    ).toBeNull();
  });

  it('renders the NC-ROAS + nCAC footer values from the threaded aggregate', () => {
    const { container } = render(
      <StoreCompareGrid stores={STORES} newCustomer={NC_OK} />,
    );
    const footer = container.querySelector('[data-testid="store-compare-nc-footer"]');
    expect(footer).not.toBeNull();
    // NC-ROAS — 2-decimal, mirrors the hero tile's formatting.
    expect(
      container.querySelector('[data-testid="store-compare-nc-roas"]')?.textContent,
    ).toContain('1.74');
    // nCAC — rendered via the overflow-safe <Money> primitive ($64).
    const ncac = container.querySelector('[data-testid="store-compare-ncac"]');
    expect(ncac?.textContent).toContain('64');
    expect(
      within(ncac as HTMLElement).getAllByText(
        (_t, el) => el?.classList.contains('metric-num') ?? false,
      ).length,
    ).toBeGreaterThanOrEqual(1);
    // order-mix line — new · returning · unclassified.
    const mix = container.querySelector('[data-testid="store-compare-nc-mix"]');
    expect(mix?.textContent).toContain('15');
    expect(mix?.textContent).toContain('חדשות');
    expect(mix?.textContent).toContain('10');
    expect(mix?.textContent).toContain('חוזרות');
    expect(mix?.textContent).toContain('0% לא מסווג');
  });

  it('footer uses the canonical inset-well token (bg-pill-track, not bg-glass-2/bg-canvas)', () => {
    const { container } = render(
      <StoreCompareGrid stores={STORES} newCustomer={NC_OK} />,
    );
    const footer = container.querySelector('[data-testid="store-compare-nc-footer"]');
    expect(footer).toHaveClass('bg-pill-track');
    expect(footer?.className ?? '').not.toContain('bg-glass-2');
    expect(footer?.className ?? '').not.toContain('bg-canvas');
  });

  it('low-confidence: footer renders the ratio + a "ביטחון נמוך" badge', () => {
    const lowNc: CommandCenterNewCustomer = {
      ...NC_OK,
      unclassifiableShare: 0.3,
      confidence: 'low',
    };
    const { container } = render(
      <StoreCompareGrid stores={STORES} newCustomer={lowNc} />,
    );
    expect(
      container.querySelector('[data-testid="store-compare-nc-roas"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="store-compare-nc-confidence"]'),
    ).not.toBeNull();
  });

  it('suppressed: footer hides the ratio (shows "לא מספיק דאטה לסיווג") but keeps the order-mix', () => {
    const suppressedNc: CommandCenterNewCustomer = {
      ...NC_OK,
      ncRoas: null,
      unclassifiableShare: 0.55,
      confidence: 'suppressed',
    };
    const { container } = render(
      <StoreCompareGrid stores={STORES} newCustomer={suppressedNc} />,
    );
    // ratios hidden …
    expect(
      container.querySelector('[data-testid="store-compare-nc-roas"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="store-compare-ncac"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="store-compare-nc-suppressed"]'),
    ).not.toBeNull();
    // … but the count-based order-mix stays (honest even when the ratio isn't).
    expect(
      container.querySelector('[data-testid="store-compare-nc-mix"]')?.textContent,
    ).toContain('חדשות');
  });

  it('degrades gracefully when nCAC is absent (null) — renders "—", never a fabricated 0', () => {
    const noNcac: CommandCenterNewCustomer = { ...NC_OK, nCac: null };
    const { container } = render(
      <StoreCompareGrid stores={STORES} newCustomer={noNcac} />,
    );
    const ncac = container.querySelector('[data-testid="store-compare-ncac"]');
    expect(ncac?.textContent).toContain('—');
  });
});
