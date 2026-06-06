// dashboard-web/src/components/activity/__tests__/ActivityEventsTab.dom.test.tsx
//
// DOM tests for the "פעילות" (Activity) tab. We mock `swr`'s default export so
// each test injects a deterministic { data } payload AND captures the SWR key
// (the /api/store-events URL) so filter/pagination wiring can be asserted
// without a real network poll.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { StoreEventsPagedResponse } from '@/app/api/store-events/route';
import type { DashboardData } from '@/lib/types';

// ---- SWR mock — settable holder + captured key. ----------------------------
let swrReturn: { data: StoreEventsPagedResponse | undefined; error: unknown; isLoading?: boolean } = {
  data: undefined,
  error: undefined,
};
let lastSwrKey: string | undefined;

vi.mock('swr', () => ({
  default: (key: string) => {
    lastSwrKey = key;
    return swrReturn;
  },
}));

import { ActivityEventsTab } from '@/components/activity/ActivityEventsTab';

const NOW = '2026-06-01T12:00:00Z';

function ev(
  over: Partial<StoreEventsPagedResponse['events'][number]>,
): StoreEventsPagedResponse['events'][number] {
  return {
    id: Math.random().toString(36).slice(2),
    store_id: 'uzoshop',
    type: 'sale',
    amount_cad: 248,
    currency: 'CAD',
    amount_original: 248,
    product_title: 'סרום לצמיחת שיער',
    quantity: 2,
    customer_label: null,
    source: null,
    occurred_at: NOW,
    received_at: NOW,
    ...over,
  };
}

function resp(over: Partial<StoreEventsPagedResponse> = {}): StoreEventsPagedResponse {
  return {
    events: [],
    total: 0,
    page: 1,
    pageSize: 40,
    serverNow: NOW,
    ...over,
  };
}

// Minimal DashboardData — only `stores` is consumed by the tab's store picker.
const DATA = { stores: ['uzoshop', 'Zol Plus', '360usmile'] } as unknown as DashboardData;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse(NOW));
  swrReturn = { data: undefined, error: undefined };
  lastSwrKey = undefined;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('<ActivityEventsTab> — rows grouped by day', () => {
  it('renders rows grouped under a sticky day header', () => {
    swrReturn = {
      data: resp({
        total: 2,
        events: [
          ev({ id: 's1', type: 'sale', product_title: 'סרום', amount_cad: 248, received_at: '2026-06-01T14:52:00Z' }),
          ev({ id: 's2', type: 'sale', product_title: 'מטליות', amount_cad: 183, received_at: '2026-05-31T11:20:00Z' }),
        ],
      }),
      error: undefined,
    };
    const { container } = render(<ActivityEventsTab data={DATA} globalStore="All" />);
    // Two distinct day-group headers (different calendar days).
    const dayHeaders = container.querySelectorAll('[data-testid="activity-day-header"]');
    expect(dayHeaders.length).toBe(2);
    // Both rows render with Hebrew type labels + product titles.
    expect(screen.getByText('סרום')).toBeInTheDocument();
    expect(screen.getByText('מטליות')).toBeInTheDocument();
    expect(screen.getAllByText('מכירה').length).toBe(2);
  });

  it('renders sale / refund / add_to_cart Hebrew labels and a <Money> amount', () => {
    swrReturn = {
      data: resp({
        total: 3,
        events: [
          ev({ id: 's1', type: 'sale', amount_cad: 248 }),
          ev({ id: 'r1', type: 'refund', amount_cad: -59.9, store_id: 'zolplus' }),
          ev({ id: 'c1', type: 'add_to_cart', amount_cad: null, store_id: 'usmile360' }),
        ],
      }),
      error: undefined,
    };
    const { container } = render(<ActivityEventsTab data={DATA} globalStore="All" />);
    expect(screen.getByText('מכירה')).toBeInTheDocument();
    expect(screen.getByText('החזר')).toBeInTheDocument();
    expect(screen.getByText('הוספה לעגלה')).toBeInTheDocument();
    // Money renders <bdi dir="ltr" class="metric-num"> — at least one present.
    const money = Array.from(container.querySelectorAll('bdi[dir="ltr"]')).find((b) =>
      b.className.includes('metric-num'),
    );
    expect(money).toBeDefined();
  });

  it('renders product titles as escaped text (no HTML injection)', () => {
    swrReturn = {
      data: resp({ total: 1, events: [ev({ id: 's1', product_title: '<b>x</b>' })] }),
      error: undefined,
    };
    const { container } = render(<ActivityEventsTab data={DATA} globalStore="All" />);
    expect(container.querySelector('b')).toBeNull();
    expect(within(container).getByText('<b>x</b>')).toBeInTheDocument();
  });
});

describe('<ActivityEventsTab> — filters change the query', () => {
  it('seeds the store filter from globalStore (resolved NAME→id) and last-30-days window', () => {
    swrReturn = { data: resp(), error: undefined };
    render(<ActivityEventsTab data={DATA} globalStore="Zol Plus" />);
    // The display name "Zol Plus" must resolve to store_id "zolplus".
    expect(lastSwrKey).toContain('store=zolplus');
    expect(lastSwrKey).toContain('page=1');
  });

  it('omits store= when the store filter is "all"/"All"', () => {
    swrReturn = { data: resp(), error: undefined };
    render(<ActivityEventsTab data={DATA} globalStore="All" />);
    expect(lastSwrKey).not.toContain('store=');
  });

  it('changing the store <select> updates the query key (resolved to id)', () => {
    swrReturn = { data: resp(), error: undefined };
    render(<ActivityEventsTab data={DATA} globalStore="All" />);
    const storeSelect = screen.getByTestId('activity-store-filter') as HTMLSelectElement;
    fireEvent.change(storeSelect, { target: { value: '360usmile' } });
    expect(lastSwrKey).toContain('store=usmile360');
  });

  it('selecting a day sets from=to=that ISO date', () => {
    swrReturn = { data: resp(), error: undefined };
    render(<ActivityEventsTab data={DATA} globalStore="All" />);
    const daySelect = screen.getByTestId('activity-day-filter') as HTMLSelectElement;
    fireEvent.change(daySelect, { target: { value: '2026-05-30' } });
    expect(lastSwrKey).toContain('from=2026-05-30');
    expect(lastSwrKey).toContain('to=2026-05-30');
  });

  it('clicking a type pill sets the type param', () => {
    swrReturn = { data: resp(), error: undefined };
    render(<ActivityEventsTab data={DATA} globalStore="All" />);
    fireEvent.click(screen.getByRole('button', { name: 'החזרים' }));
    expect(lastSwrKey).toContain('type=refund');
    fireEvent.click(screen.getByRole('button', { name: 'מכירות' }));
    expect(lastSwrKey).toContain('type=sale');
    // "הכל" clears the type filter.
    fireEvent.click(screen.getByRole('button', { name: 'הכל' }));
    expect(lastSwrKey).not.toContain('type=');
  });
});

describe('<ActivityEventsTab> — pagination', () => {
  it('disables ‹ prev on page 1', () => {
    swrReturn = { data: resp({ total: 130, page: 1, pageSize: 40 }), error: undefined };
    render(<ActivityEventsTab data={DATA} globalStore="All" />);
    const prev = screen.getByTestId('activity-prev') as HTMLButtonElement;
    expect(prev).toBeDisabled();
  });

  it('shows "עמוד X מתוך Y" computed from total/pageSize and advances on next', () => {
    swrReturn = { data: resp({ total: 130, page: 1, pageSize: 40 }), error: undefined };
    render(<ActivityEventsTab data={DATA} globalStore="All" />);
    // 130 / 40 → 4 pages.
    expect(screen.getByTestId('activity-page-info').textContent).toMatch(/1.*4/);
    fireEvent.click(screen.getByTestId('activity-next'));
    expect(lastSwrKey).toContain('page=2');
  });

  it('disables הבא › next on the last page', () => {
    // total 130, pageSize 40 → 4 pages; render on page 4.
    swrReturn = { data: resp({ total: 130, page: 4, pageSize: 40, events: [ev({ id: 'x' })] }), error: undefined };
    const { rerender } = render(<ActivityEventsTab data={DATA} globalStore="All" />);
    // Advance internal page state to 4 by clicking next thrice (each rerenders
    // with the same mocked last-page payload). Then assert next is disabled.
    // Simpler: the component computes totalPages from total/pageSize and the
    // current page from its own state; we drive page state via the pager.
    // Click next 3× to reach page 4.
    fireEvent.click(screen.getByTestId('activity-next')); // → 2
    fireEvent.click(screen.getByTestId('activity-next')); // → 3
    fireEvent.click(screen.getByTestId('activity-next')); // → 4
    rerender(<ActivityEventsTab data={DATA} globalStore="All" />);
    const next = screen.getByTestId('activity-next') as HTMLButtonElement;
    expect(next).toBeDisabled();
  });
});

describe('<ActivityEventsTab> — source badge smoke tests', () => {
  it('shows a source-badge for a sale row with source "meta-paid"', () => {
    swrReturn = {
      data: resp({
        total: 1,
        events: [ev({ id: 'sb1', type: 'sale', source: 'meta-paid', received_at: NOW })],
      }),
      error: undefined,
    };
    const { container } = render(<ActivityEventsTab data={DATA} globalStore="All" />);
    expect(container.querySelector('[data-testid="source-badge"]')).toBeInTheDocument();
  });

  it('shows no source-badge for a refund row', () => {
    swrReturn = {
      data: resp({
        total: 1,
        events: [ev({ id: 'rb1', type: 'refund', source: 'meta-paid', received_at: NOW })],
      }),
      error: undefined,
    };
    const { container } = render(<ActivityEventsTab data={DATA} globalStore="All" />);
    expect(container.querySelector('[data-testid="source-badge"]')).toBeNull();
  });
});

describe('<ActivityEventsTab> — empty + loading states', () => {
  it('shows the empty state when no events match', () => {
    swrReturn = { data: resp({ total: 0, events: [] }), error: undefined };
    render(<ActivityEventsTab data={DATA} globalStore="All" />);
    expect(screen.getByTestId('activity-empty')).toBeInTheDocument();
    expect(screen.getByText(/אין אירועים/)).toBeInTheDocument();
  });

  it('shows a loading state before the first payload arrives', () => {
    swrReturn = { data: undefined, error: undefined };
    render(<ActivityEventsTab data={DATA} globalStore="All" />);
    expect(screen.getByTestId('activity-loading')).toBeInTheDocument();
  });
});
