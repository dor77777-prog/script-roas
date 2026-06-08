// dashboard-web/src/components/activity/__tests__/ActivityStatsTab.dom.test.tsx
//
// DOM tests for the "פעילות › סטטיסטיקות והתפלגויות" sub-tab (AS-T2). We mock
// `swr`'s default export so each test injects a deterministic
// ActivityStatsResponse AND captures the SWR key (the /api/activity-stats URL)
// so the global range/store wiring can be asserted with no real network.
//
// Coverage:
//  - the KPI row (orders total · paid% · ATC total · first-touch coverage%)
//  - donut 1 (ממומן ↔ לא-ממומן) + donut 2 (התפלגות לפי פלטפורמה) render with a
//    platform label
//  - the "לפי הזמנות / לפי הכנסה" toggle is a PURE client switch (no refetch:
//    the SWR key is unchanged) and surfaces a ₪ <Money> value in revenue mode
//  - the per-product table renders a product row + a stacked source bar
//  - the "רכישות / הוספות-לעגלה" toggle switches the per-product stacked bar
//    (purchaseBySource ↔ atcBySource) without a refetch
//  - the SWR key respects the GLOBAL range (from/to) + store (resolved NAME→id)
//  - loading / error / empty states

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ActivityStatsResponse } from '@/app/api/activity-stats/route';

// ---- SWR mock — settable holder + captured key. ----------------------------
let swrReturn: { data: ActivityStatsResponse | undefined; error: unknown } = {
  data: undefined,
  error: undefined,
};
const swrKeys: string[] = [];

vi.mock('swr', () => ({
  default: (key: string | null) => {
    if (key) swrKeys.push(key);
    return swrReturn;
  },
}));

import { ActivityStatsTab } from '@/components/activity/ActivityStatsTab';

const RANGE = { from: '2026-05-08', to: '2026-06-07' };

function fullResp(over: Partial<ActivityStatsResponse> = {}): ActivityStatsResponse {
  return {
    range: RANGE,
    orders: {
      total: 11506,
      paidVsOrganic: {
        paid: { orders: 9141, revenueCad: 820000 },
        organic: { orders: 2365, revenueCad: 190000 },
      },
      byPlatform: [
        { bucket: 'meta', label: 'Meta', orders: 8746, revenueCad: 700000, pct: 76.1 },
        { bucket: 'google', label: 'Google', orders: 676, revenueCad: 60000, pct: 5.9 },
        { bucket: 'direct', label: 'ישיר', orders: 1113, revenueCad: 90000, pct: 9.7 },
        { bucket: 'referral', label: 'הפניות', orders: 567, revenueCad: 40000, pct: 4.9 },
        { bucket: 'email', label: 'אימייל', orders: 78, revenueCad: 6000, pct: 0.7 },
        { bucket: 'tiktok', label: 'TikTok', orders: 18, revenueCad: 1500, pct: 0.2 },
      ],
    },
    atc: {
      total: 1002,
      byPlatform: [
        { bucket: 'meta', label: 'Meta', count: 760, pct: 75.8 },
        { bucket: 'google', label: 'Google', count: 90, pct: 9.0 },
        { bucket: 'direct', label: 'ישיר', count: 152, pct: 15.2 },
      ],
    },
    perProduct: [
      {
        productId: 'p1',
        productTitle: 'Uzo Hair Dryer Pro',
        atcCount: 418,
        purchaseCount: 132,
        conversionPct: 31.6,
        purchaseBySource: [
          { bucket: 'meta', count: 108 },
          { bucket: 'direct', count: 14 },
          { bucket: 'google', count: 10 },
        ],
        atcBySource: [
          { bucket: 'meta', count: 300 },
          { bucket: 'email', count: 118 },
        ],
      },
      {
        productId: 'p2',
        productTitle: 'Zol Plus Serum 50ml',
        atcCount: 236,
        purchaseCount: 61,
        conversionPct: 25.8,
        purchaseBySource: [{ bucket: 'meta', count: 61 }],
        atcBySource: [{ bucket: 'meta', count: 236 }],
      },
    ],
    firstTouchCoverage: { orders: { withFt: 978, total: 11506, pct: 8.5 } },
    ...over,
  };
}

beforeEach(() => {
  swrReturn = { data: undefined, error: undefined };
  swrKeys.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('<ActivityStatsTab> — SWR key respects the global filters', () => {
  it('keys /api/activity-stats by the global from/to range', () => {
    swrReturn = { data: fullResp(), error: undefined };
    render(<ActivityStatsTab range={RANGE} globalStore="All" />);
    const key = swrKeys[swrKeys.length - 1];
    expect(key).toContain('/api/activity-stats');
    expect(key).toContain('from=2026-05-08');
    expect(key).toContain('to=2026-06-07');
  });

  it('resolves a display-name store filter to its store_id', () => {
    swrReturn = { data: fullResp(), error: undefined };
    render(<ActivityStatsTab range={RANGE} globalStore="Zol Plus" />);
    const key = swrKeys[swrKeys.length - 1];
    expect(key).toContain('store=zolplus');
  });

  it('omits store= when the global store is "All"', () => {
    swrReturn = { data: fullResp(), error: undefined };
    render(<ActivityStatsTab range={RANGE} globalStore="All" />);
    const key = swrKeys[swrKeys.length - 1];
    expect(key).not.toContain('store=');
  });
});

describe('<ActivityStatsTab> — KPI row + donuts', () => {
  it('renders the four KPIs (orders / paid% / ATC / first-touch%)', () => {
    swrReturn = { data: fullResp(), error: undefined };
    render(<ActivityStatsTab range={RANGE} globalStore="All" />);
    const kpis = screen.getByTestId('as-kpis');
    // Orders total + ATC total render as numbers.
    expect(within(kpis).getByText(/11,506|11506/)).toBeInTheDocument();
    expect(within(kpis).getByText(/1,002|1002/)).toBeInTheDocument();
    // Paid% (9141/11506 ≈ 79.4%) and first-touch coverage (8.5%) render.
    expect(within(kpis).getByText(/79\.4%/)).toBeInTheDocument();
    expect(within(kpis).getByText(/8\.5%/)).toBeInTheDocument();
  });

  it('renders both donuts, with a platform label in the platform donut legend', () => {
    swrReturn = { data: fullResp(), error: undefined };
    render(<ActivityStatsTab range={RANGE} globalStore="All" />);
    expect(screen.getByTestId('as-donut-paid')).toBeInTheDocument();
    const platformDonut = screen.getByTestId('as-donut-platform');
    expect(platformDonut).toBeInTheDocument();
    // "Meta" appears in both the center label and the legend → getAllByText.
    expect(within(platformDonut).getAllByText('Meta').length).toBeGreaterThan(0);
    expect(within(platformDonut).getByText('Google')).toBeInTheDocument();
  });

  it('paid donut shows the paid% in the center', () => {
    swrReturn = { data: fullResp(), error: undefined };
    render(<ActivityStatsTab range={RANGE} globalStore="All" />);
    const paidDonut = screen.getByTestId('as-donut-paid');
    // 79.4% appears in both the center and the paid legend row → getAllByText.
    expect(within(paidDonut).getAllByText(/79\.4%/).length).toBeGreaterThan(0);
  });
});

describe('<ActivityStatsTab> — orders/revenue toggle (pure client switch)', () => {
  it('switches the donut value to a ₪ <Money> amount without refetching', () => {
    swrReturn = { data: fullResp(), error: undefined };
    render(<ActivityStatsTab range={RANGE} globalStore="All" />);
    const keysBefore = swrKeys.length;

    // Default mode = orders → no money <bdi class="metric-num"> in the donut card.
    const paidDonut = screen.getByTestId('as-donut-paid');
    expect(
      Array.from(paidDonut.querySelectorAll('bdi.metric-num')).length,
    ).toBe(0);

    // Switch to revenue → a money value appears (metric-num <bdi>), still no
    // new SWR key (pure client field switch).
    fireEvent.click(screen.getByRole('radio', { name: 'לפי הכנסה' }));
    const moneyAfter = screen.getByTestId('as-donut-paid').querySelectorAll('bdi.metric-num');
    expect(moneyAfter.length).toBeGreaterThan(0);

    // The SWR key set did not grow with a NEW distinct key (no refetch).
    const distinctBefore = new Set(swrKeys.slice(0, keysBefore));
    const distinctAfter = new Set(swrKeys);
    expect(distinctAfter.size).toBe(distinctBefore.size);
  });
});

describe('<ActivityStatsTab> — per-product table', () => {
  it('renders a product row with a stacked source bar', () => {
    swrReturn = { data: fullResp(), error: undefined };
    render(<ActivityStatsTab range={RANGE} globalStore="All" />);
    const row = screen.getByTestId('as-product-row-p1');
    expect(within(row).getByText('Uzo Hair Dryer Pro')).toBeInTheDocument();
    // Stacked bar present with at least one segment.
    const bar = within(row).getByTestId('as-product-bar-p1');
    expect(bar.querySelectorAll('[data-bucket]').length).toBeGreaterThan(0);
  });

  it('switches the stacked bar from purchaseBySource to atcBySource on toggle', () => {
    swrReturn = { data: fullResp(), error: undefined };
    render(<ActivityStatsTab range={RANGE} globalStore="All" />);

    // p1 purchases split has 3 buckets (meta/direct/google); ATC split has 2
    // (meta/email). The segment count flips when the toggle changes.
    const purchaseSegs = screen
      .getByTestId('as-product-bar-p1')
      .querySelectorAll('[data-bucket]').length;
    expect(purchaseSegs).toBe(3);

    fireEvent.click(screen.getByRole('radio', { name: 'הוספות לעגלה' }));

    const atcSegs = screen
      .getByTestId('as-product-bar-p1')
      .querySelectorAll('[data-bucket]').length;
    expect(atcSegs).toBe(2);
    // An email segment now appears in p1's ATC split.
    expect(
      screen
        .getByTestId('as-product-bar-p1')
        .querySelector('[data-bucket="email"]'),
    ).not.toBeNull();
  });
});

describe('<ActivityStatsTab> — loading / error / empty', () => {
  it('shows the loading state before the first payload', () => {
    swrReturn = { data: undefined, error: undefined };
    render(<ActivityStatsTab range={RANGE} globalStore="All" />);
    expect(screen.getByTestId('as-loading')).toBeInTheDocument();
  });

  it('shows a Hebrew error state on fetch error', () => {
    swrReturn = { data: undefined, error: new Error('boom') };
    render(<ActivityStatsTab range={RANGE} globalStore="All" />);
    expect(screen.getByTestId('as-error')).toBeInTheDocument();
  });

  it('shows a Hebrew error state when the body carries a soft error', () => {
    swrReturn = { data: fullResp({ error: 'db down' }), error: undefined };
    render(<ActivityStatsTab range={RANGE} globalStore="All" />);
    expect(screen.getByTestId('as-error')).toBeInTheDocument();
  });

  it('shows an empty state when there are zero orders and zero ATC', () => {
    swrReturn = {
      data: fullResp({
        orders: {
          total: 0,
          paidVsOrganic: {
            paid: { orders: 0, revenueCad: 0 },
            organic: { orders: 0, revenueCad: 0 },
          },
          byPlatform: [],
        },
        atc: { total: 0, byPlatform: [] },
        perProduct: [],
        firstTouchCoverage: { orders: { withFt: 0, total: 0, pct: 0 } },
      }),
      error: undefined,
    };
    render(<ActivityStatsTab range={RANGE} globalStore="All" />);
    expect(screen.getByTestId('as-empty')).toBeInTheDocument();
  });
});
