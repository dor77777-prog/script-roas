// dashboard-web/src/components/home/__tests__/StoreDetailModal.dom.test.tsx
//
// Per-store drill-down MODAL — smoke + contract tests.
//
// Pins (match the approved mockup store-modal-mockup.html):
//   • null data → no modal renders (the Sheet stays closed).
//   • Header: store name (bdi ltr) + big ROAS + a close button.
//   • KPI section: all 5 labels (הוצאה / הכנסה / רווח תפעולי / הזמנות / AOV).
//   • A platform breakdown card + at least one top-campaign row.
//   • Footer "show all campaigns" fires onOpenCampaigns() (no campaign → table
//     only); clicking a campaign row fires onOpenCampaigns({storeId,platform,
//     campaignId}) to deep-link that campaign's drawer.
//   • ROAS chart shows for a ≥2-day range, hidden on a single-day range.
//
// Reduced-motion is on in the test runner → <CountUp> renders the FINAL value
// immediately (no animation frames), so the ROAS number is its final string.

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { StoreDetailModal } from '@/components/home/StoreDetailModal';
import type { StoreDetailData } from '@/lib/home/storeDetail';

function makeData(over: Partial<StoreDetailData> = {}): StoreDetailData {
  return {
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    roas: 3.45,
    zeroSalesWithSpend: false,
    updatedAt: new Date(Date.now() - 2 * 60_000).toISOString(),
    kpis: {
      spend: 1840,
      revenue: 6350,
      operatingProfit: 2790,
      orders: 46,
      aov: 138,
    },
    deltas: {
      spendPct: -0.08,
      revenuePct: 0.14,
      operatingProfitPct: 0.19,
      ordersPct: 0.06,
      aovPct: -0.03,
    },
    roasSeries: [
      { date: '2026-05-01', roas: 2.1 },
      { date: '2026-05-02', roas: null },
      { date: '2026-05-03', roas: 3.4 },
    ],
    platforms: [
      { platform: 'meta', spend: 1180, cpm: 37, roas: 3.6 },
      { platform: 'google', spend: 520, cpm: 9, roas: 3.1 },
      { platform: 'tiktok', spend: 140, cpm: 3, roas: 2.4 },
    ],
    topCampaigns: [
      { name: 'Meta · ABO – Hero Video', platform: 'meta', roas: 4.2, spend: 640, revenue: 2688, orders: 92, storeId: 'uzoshop', campaignId: 'cmp-1' },
      { name: 'Google · PMax – Catalog', platform: 'google', roas: 3.3, spend: 520, revenue: 1716, orders: 58, storeId: 'uzoshop', campaignId: 'cmp-2' },
    ],
    newCustomer: { ncRevenue: 0, ncOrders: 0, returningOrders: 3, ncRoas: null, nCac: null, unclassifiableShare: 0, confidence: 'ok' },
    ...over,
  };
}

describe('<StoreDetailModal>', () => {
  it('renders nothing meaningful when data is null', () => {
    render(<StoreDetailModal data={null} open={false} onClose={() => {}} rangeLabel="30 ימים" onOpenCampaigns={() => {}} />);
    expect(screen.queryByTestId('store-detail-modal')).toBeNull();
  });

  it('renders the store name in a bdi dir="ltr" in the header', () => {
    render(<StoreDetailModal data={makeData()} open onClose={() => {}} rangeLabel="30 ימים" onOpenCampaigns={() => {}} />);
    const hero = screen.getByTestId('store-detail-hero');
    const name = within(hero).getByText('uzoshop');
    expect(name.tagName.toLowerCase()).toBe('bdi');
    expect(name.getAttribute('dir')).toBe('ltr');
  });

  it('renders the big ROAS value (final, reduced-motion)', () => {
    render(<StoreDetailModal data={makeData()} open onClose={() => {}} rangeLabel="30 ימים" onOpenCampaigns={() => {}} />);
    expect(screen.getByTestId('store-detail-modal').textContent).toContain('3.45x');
  });

  it('alarm-red state shows a static 0.00x', () => {
    const data = makeData({ roas: null, zeroSalesWithSpend: true });
    render(<StoreDetailModal data={data} open onClose={() => {}} rangeLabel="30 ימים" onOpenCampaigns={() => {}} />);
    expect(screen.getByTestId('store-detail-modal').textContent).toContain('0.00x');
  });

  it('renders all 5 KPI labels', () => {
    render(<StoreDetailModal data={makeData()} open onClose={() => {}} rangeLabel="30 ימים" onOpenCampaigns={() => {}} />);
    // "הוצאה" also appears in the per-platform breakdown, so scope each KPI
    // label assertion to its own KPI card.
    expect(within(screen.getByTestId('kpi-spend')).getByText('הוצאה')).toBeInTheDocument();
    expect(within(screen.getByTestId('kpi-revenue')).getByText('הכנסה')).toBeInTheDocument();
    expect(within(screen.getByTestId('kpi-op')).getByText('רווח תפעולי')).toBeInTheDocument();
    expect(within(screen.getByTestId('kpi-orders')).getByText('הזמנות')).toBeInTheDocument();
    expect(within(screen.getByTestId('kpi-aov')).getByText('AOV')).toBeInTheDocument();
  });

  it('renders a per-platform breakdown including Meta', () => {
    render(<StoreDetailModal data={makeData()} open onClose={() => {}} rangeLabel="30 ימים" onOpenCampaigns={() => {}} />);
    // PlatformBadge renders the label "Meta".
    expect(screen.getAllByText('Meta').length).toBeGreaterThan(0);
  });

  it('renders a top campaign row', () => {
    render(<StoreDetailModal data={makeData()} open onClose={() => {}} rangeLabel="30 ימים" onOpenCampaigns={() => {}} />);
    expect(screen.getByText('Meta · ABO – Hero Video')).toBeInTheDocument();
  });

  it('footer "show all campaigns" fires onOpenCampaigns with no campaign (table only)', () => {
    const onOpenCampaigns = vi.fn();
    render(<StoreDetailModal data={makeData()} open onClose={() => {}} rangeLabel="30 ימים" onOpenCampaigns={onOpenCampaigns} />);
    fireEvent.click(screen.getByTestId('store-detail-open-campaigns'));
    // No argument → host drills to the Campaigns tab filtered to the store,
    // without opening any specific campaign drawer.
    expect(onOpenCampaigns).toHaveBeenCalledTimes(1);
    expect(onOpenCampaigns.mock.calls[0][0]).toBeUndefined();
  });

  it('clicking a campaign row deep-links that exact campaign (storeId+platform+campaignId)', () => {
    const onOpenCampaigns = vi.fn();
    render(<StoreDetailModal data={makeData()} open onClose={() => {}} rangeLabel="30 ימים" onOpenCampaigns={onOpenCampaigns} />);
    fireEvent.click(screen.getByText('Meta · ABO – Hero Video'));
    expect(onOpenCampaigns).toHaveBeenCalledWith({
      storeId: 'uzoshop',
      platform: 'meta',
      campaignId: 'cmp-1',
    });
  });

  it('shows the ROAS-over-time chart when the range spans ≥2 days', () => {
    render(<StoreDetailModal data={makeData()} open onClose={() => {}} rangeLabel="30 ימים" onOpenCampaigns={() => {}} />);
    expect(screen.getByTestId('store-detail-chart')).toBeInTheDocument();
  });

  it('hides the ROAS chart on a single-day range (one series point — empty plot)', () => {
    const data = makeData({ roasSeries: [{ date: '2026-05-01', roas: 2.1 }] });
    render(<StoreDetailModal data={data} open onClose={() => {}} rangeLabel="יום" onOpenCampaigns={() => {}} />);
    expect(screen.queryByTestId('store-detail-chart')).toBeNull();
  });

  it('ghost close button fires onClose', () => {
    const onClose = vi.fn();
    render(<StoreDetailModal data={makeData()} open onClose={onClose} rangeLabel="30 ימים" onOpenCampaigns={() => {}} />);
    fireEvent.click(screen.getByTestId('store-detail-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('SheetContent carries the store-detail-modal testid', () => {
    render(<StoreDetailModal data={makeData()} open onClose={() => {}} rangeLabel="30 ימים" onOpenCampaigns={() => {}} />);
    expect(screen.getByTestId('store-detail-modal')).toBeInTheDocument();
  });
});

describe('<StoreDetailModal> — per-store NC-ROAS / nCAC', () => {
  it('renders the new-customer row with NC-ROAS, nCAC and unclassifiable share', () => {
    const data = makeData({
      newCustomer: {
        ncRevenue: 300, ncOrders: 6, returningOrders: 3, ncRoas: 1.5, nCac: 50, unclassifiableShare: 0.2, confidence: 'ok',
      },
    });
    const { getByTestId } = render(
      <StoreDetailModal data={data} open onClose={() => {}} rangeLabel="היום" onOpenCampaigns={() => {}} />,
    );
    const nc = getByTestId('store-detail-nc');
    expect(nc.textContent).toContain('1.50'); // NC-ROAS
    expect(nc.textContent).toContain('$50');  // nCAC
    expect(nc.textContent).toContain('20%');  // unclassifiable
    expect(nc.textContent).toContain('שאלה אחרת');
  });
});

describe('<StoreDetailModal> — NC-ROAS net-adj label + confidence gate', () => {
  it('shows the "net (refund-adj)" qualifier on the NC-ROAS row', () => {
    const data = makeData({
      newCustomer: { ncRevenue: 180, ncOrders: 2, returningOrders: 3, ncRoas: 3, nCac: 30, unclassifiableShare: 0.05, confidence: 'ok' },
    });
    render(
      <StoreDetailModal data={data} open onClose={() => {}} rangeLabel="היום" onOpenCampaigns={() => {}} />,
    );
    expect(within(screen.getByTestId('store-detail-nc')).getByText(/refund-adj|נטו/i)).toBeInTheDocument();
  });

  it('confidence=low → renders a low-confidence badge', () => {
    const data = makeData({
      newCustomer: { ncRevenue: 180, ncOrders: 2, returningOrders: 3, ncRoas: 3, nCac: 30, unclassifiableShare: 0.3, confidence: 'low' },
    });
    render(
      <StoreDetailModal data={data} open onClose={() => {}} rangeLabel="היום" onOpenCampaigns={() => {}} />,
    );
    expect(within(screen.getByTestId('store-detail-nc')).getByText(/ביטחון נמוך/)).toBeInTheDocument();
  });

  it('confidence=suppressed → hides the ratio, shows not-enough-data', () => {
    const data = makeData({
      newCustomer: { ncRevenue: 180, ncOrders: 2, returningOrders: 3, ncRoas: 3, nCac: 30, unclassifiableShare: 0.6, confidence: 'suppressed' },
    });
    render(
      <StoreDetailModal data={data} open onClose={() => {}} rangeLabel="היום" onOpenCampaigns={() => {}} />,
    );
    const nc = screen.getByTestId('store-detail-nc');
    expect(within(nc).queryByText('3.00')).not.toBeInTheDocument();
    expect(within(nc).getByText(/לא מספיק דאטה/)).toBeInTheDocument();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Horizon re-skin (Wave 3.8) — band-header recipe + pill-track insets + AA chips
// + no-info-loss. These pin the re-skin so a regression to the old hand-rolled
// glass header / glass KPI cards / unbanded chips would FAIL.
// ───────────────────────────────────────────────────────────────────────────
describe('<StoreDetailModal> — Horizon re-skin', () => {
  it('header is a banded Card via the data-band recipe (roas 3.45 → blue), NOT a hand-rolled glass+!important hack', () => {
    // roas 3.45 > 3.0 → blue (bandForRoas, single source of truth).
    render(<StoreDetailModal data={makeData({ roas: 3.45 })} open onClose={() => {}} rangeLabel="30 ימים" onOpenCampaigns={() => {}} />);
    const hero = screen.getByTestId('store-detail-hero');
    // Band recipe: the slab carries data-band + the per-store-card scope class
    // (so the scoped white-on-band globals.css rules apply), AND the Card
    // primitive's glass base (proves it's the <Card> primitive, not a bespoke
    // <header className="glass …"> with a hand-pinned data-mounted).
    expect(hero.getAttribute('data-band')).toBe('blue');
    expect(hero.className).toContain('per-store-card');
    expect(hero.className).toContain('glass');
    // No `!important` COLOUR hack survives on the header — the band colour comes
    // straight from the data-band recipe, not a `!bg-…`/`!text-…` override.
    expect(hero.className).not.toMatch(/![a-z-]*(?:bg|text|from|to|via)-/);
  });

  it('alarm-red header maps to the red-alarm band (zeroSalesWithSpend)', () => {
    render(<StoreDetailModal data={makeData({ roas: null, zeroSalesWithSpend: true })} open onClose={() => {}} rangeLabel="30 ימים" onOpenCampaigns={() => {}} />);
    expect(screen.getByTestId('store-detail-hero').getAttribute('data-band')).toBe('red-alarm');
  });

  it('KPI insets render on the canonical bg-pill-track recessed surface', () => {
    render(<StoreDetailModal data={makeData()} open onClose={() => {}} rangeLabel="30 ימים" onOpenCampaigns={() => {}} />);
    for (const id of ['kpi-spend', 'kpi-revenue', 'kpi-op', 'kpi-orders', 'kpi-aov']) {
      expect(screen.getByTestId(id).className).toContain('bg-pill-track');
    }
  });

  it('per-platform insets use bg-pill-track and an AA-safe chip-{band} ROAS chip (bandForRoas)', () => {
    // meta roas 3.6 → blue, google 3.1 → blue, tiktok 2.4 → orange.
    render(<StoreDetailModal data={makeData()} open onClose={() => {}} rangeLabel="30 ימים" onOpenCampaigns={() => {}} />);
    const meta = screen.getByTestId('platform-meta');
    expect(meta.className).toContain('bg-pill-track');
    // The ROAS chip carries the shared band-chip recipe + the correct band class.
    const metaChip = within(meta).getByText(/3\.60x/);
    expect(metaChip.closest('.band-chip')?.className).toContain('chip-blue');
    const ttChip = within(screen.getByTestId('platform-tiktok')).getByText(/2\.40x/);
    expect(ttChip.closest('.band-chip')?.className).toContain('chip-orange');
  });

  it('no-info-loss — every section + the trend still render (header / KPIs / NC tile / trend / per-platform / top-campaigns)', () => {
    render(<StoreDetailModal data={makeData()} open onClose={() => {}} rangeLabel="30 ימים" onOpenCampaigns={() => {}} />);
    expect(screen.getByTestId('store-detail-hero')).toBeInTheDocument();      // header KPIs + ROAS hero
    expect(screen.getByTestId('kpi-spend')).toBeInTheDocument();              // 5-up KPI insets
    expect(screen.getByTestId('store-detail-nc')).toBeInTheDocument();        // per-store NC tile (kept)
    expect(screen.getByTestId('store-detail-chart')).toBeInTheDocument();     // ROAS trend (≥2 days)
    expect(screen.getByTestId('platform-meta')).toBeInTheDocument();          // per-platform breakdown
    expect(screen.getByTestId('platform-google')).toBeInTheDocument();
    expect(screen.getByTestId('platform-tiktok')).toBeInTheDocument();
    expect(screen.getByText('Meta · ABO – Hero Video')).toBeInTheDocument();  // top campaigns (= mockup "top products")
    expect(screen.getByTestId('store-detail-open-campaigns')).toBeInTheDocument(); // footer CTAs
    expect(screen.getByTestId('store-detail-close')).toBeInTheDocument();
  });

  it('contains no emoji (lucide icons only)', () => {
    render(<StoreDetailModal data={makeData()} open onClose={() => {}} rangeLabel="30 ימים" onOpenCampaigns={() => {}} />);
    const text = screen.getByTestId('store-detail-modal').textContent ?? '';
    // Pictographic emoji range (NOT the ▲/▼/✕ geometric glyphs the deltas use).
    expect(text).not.toMatch(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });
});
