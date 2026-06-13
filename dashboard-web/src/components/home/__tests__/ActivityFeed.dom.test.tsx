// dashboard-web/src/components/home/__tests__/ActivityFeed.dom.test.tsx
//
// Phase 3, Task C — DOM tests for the rebuilt real-time <ActivityFeed>.
//
// We mock `swr`'s default export so each test injects a deterministic
// { data, error } pair and exercises the component's pure render logic
// (LIVE-badge state machine, row rendering, empty state) without a real
// network poll. The matchMedia reduced-motion stub (setup-dom.ts) reports
// `true` by default; one test flips it to `false` to assert the motion path.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import type { StoreEventsResponse } from '@/app/api/store-events/route';

// ---- SWR mock: a settable holder the tests poke before each render. --------
let swrReturn: { data: StoreEventsResponse | undefined; error: unknown } = {
  data: undefined,
  error: undefined,
};
// Captures the SWR key (the /api/store-events URL) so tests can assert the
// resolved ?store= param. Read lazily inside the mock (same as swrReturn).
let lastSwrKey: string | undefined;

vi.mock('swr', () => ({
  default: (key: string) => {
    // useStores() (Self-serve stores Phase 6a) also calls useSWR, keyed on
    // '/api/stores'. Only capture the store-events key here and let the
    // useStores hook fall back to its hardcoded 3 (returning `undefined` data
    // makes the hook use its own fallbackData) so the brand-color resolution
    // path is exercised without disturbing the store-events assertion.
    if (key === '/api/stores') return { data: undefined, error: undefined };
    lastSwrKey = key;
    return swrReturn;
  },
}));

import { ActivityFeed } from '@/components/home/ActivityFeed';

// Fixed clock so relative-time + LIVE-freshness math is deterministic.
const NOW = '2026-06-01T12:00:00Z';
const NOW_MS = Date.parse(NOW);

function row(over: Partial<StoreEventsResponse['events'][number]>): StoreEventsResponse['events'][number] {
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
    first_touch_source: null,
    occurred_at: NOW,
    received_at: NOW,
    ...over,
  };
}

function resp(over: Partial<StoreEventsResponse> = {}): StoreEventsResponse {
  return {
    events: [],
    serverNow: NOW,
    lastReceivedAt: null,
    ...over,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW_MS);
  swrReturn = { data: undefined, error: undefined };
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('<ActivityFeed> — rows', () => {
  it('renders sale, refund and add_to_cart rows with Hebrew labels', () => {
    swrReturn = {
      data: resp({
        lastReceivedAt: NOW,
        events: [
          row({ id: 's1', type: 'sale', product_title: 'סרום', amount_cad: 248 }),
          row({ id: 'r1', type: 'refund', product_title: 'סט סלמון', amount_cad: -59.9, store_id: 'zolplus' }),
          row({ id: 'c1', type: 'add_to_cart', product_title: 'מיקרוסקופ', amount_cad: null, store_id: 'usmile360' }),
        ],
      }),
      error: undefined,
    };
    render(<ActivityFeed />);
    expect(screen.getByText('מכירה')).toBeInTheDocument();
    expect(screen.getByText('החזר')).toBeInTheDocument();
    expect(screen.getByText('הוספה לעגלה')).toBeInTheDocument();
    // product titles render as plain text (React escapes; no dangerouslySetInnerHTML).
    expect(screen.getByText('סרום')).toBeInTheDocument();
    expect(screen.getByText('סט סלמון')).toBeInTheDocument();
    expect(screen.getByText('מיקרוסקופ')).toBeInTheDocument();
  });

  it('renders the amount through the <Money> primitive (overflow-safe, <bdi dir="ltr">)', () => {
    swrReturn = {
      data: resp({ lastReceivedAt: NOW, events: [row({ id: 's1', type: 'sale', amount_cad: 248 })] }),
      error: undefined,
    };
    const { container } = render(<ActivityFeed />);
    // Money renders a <bdi dir="ltr" class="metric-num">. Assert at least one
    // such node carries an LTR-isolated number.
    const bdis = Array.from(container.querySelectorAll('bdi[dir="ltr"]'));
    expect(bdis.length).toBeGreaterThan(0);
    const moneyNode = bdis.find((b) => b.className.includes('metric-num'));
    expect(moneyNode).toBeDefined();
    expect(moneyNode!.textContent).toMatch(/248/);
  });

  it('renders a negative (refund) amount', () => {
    swrReturn = {
      data: resp({ lastReceivedAt: NOW, events: [row({ id: 'r1', type: 'refund', amount_cad: -59.9 })] }),
      error: undefined,
    };
    const { container } = render(<ActivityFeed />);
    const text = container.textContent ?? '';
    // The compact-floor Money shows a minus and the magnitude.
    expect(text).toMatch(/[-−]/);
    expect(text).toMatch(/59|60/);
  });

  it('add_to_cart row carries no money amount', () => {
    swrReturn = {
      data: resp({ lastReceivedAt: NOW, events: [row({ id: 'c1', type: 'add_to_cart', amount_cad: null })] }),
      error: undefined,
    };
    render(<ActivityFeed />);
    const cartRow = screen.getByText('הוספה לעגלה').closest('[data-testid="store-event-row"]')!;
    // No metric-num money node inside the cart row.
    expect(cartRow.querySelector('.metric-num')).toBeNull();
  });

  it('renders the store chip (display name)', () => {
    swrReturn = {
      data: resp({ lastReceivedAt: NOW, events: [row({ id: 's1', store_id: 'zolplus' })] }),
      error: undefined,
    };
    render(<ActivityFeed />);
    // zolplus → 'Zol Plus' display name.
    expect(screen.getByText('Zol Plus')).toBeInTheDocument();
  });

  /* ---- Horizon re-skin (W3.6): icon-circle + pill-track chip + lucide-only -- */

  it('the per-type glyph is a Horizon icon-CIRCLE (rounded-full, not rounded-xl)', () => {
    swrReturn = {
      data: resp({ lastReceivedAt: NOW, events: [row({ id: 's1', type: 'sale' })] }),
      error: undefined,
    };
    const { container } = render(<ActivityFeed />);
    const rowEl = container.querySelector('[data-testid="store-event-row"]')!;
    // The lead glyph box is now a circle carrying the status tint.
    const circle = rowEl.querySelector('span.rounded-full.bg-status-greenBg');
    expect(circle).not.toBeNull();
    // The old square-ish rounded-xl glyph box must be gone.
    expect(rowEl.querySelector('.rounded-xl')).toBeNull();
  });

  it('the store chip sits on the canonical pill-track inset well (token)', () => {
    swrReturn = {
      data: resp({ lastReceivedAt: NOW, events: [row({ id: 's1', store_id: 'zolplus' })] }),
      error: undefined,
    };
    render(<ActivityFeed />);
    const chip = screen.getByTestId('store-chip');
    expect(chip.className).toContain('bg-pill-track');
  });

  it('uses lucide icons only — no emoji glyph leaks into the feed UI', () => {
    const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;
    swrReturn = {
      data: resp({
        lastReceivedAt: NOW,
        events: [
          row({ id: 's1', type: 'sale', product_title: 'סרום' }),
          row({ id: 'r1', type: 'refund', amount_cad: -59.9, store_id: 'zolplus' }),
          row({ id: 'c1', type: 'add_to_cart', amount_cad: null, store_id: 'usmile360' }),
        ],
      }),
      error: undefined,
    };
    const { container } = render(<ActivityFeed />);
    expect(container.textContent ?? '').not.toMatch(EMOJI);
  });
});

describe('<ActivityFeed> — LIVE badge state machine', () => {
  it('GREEN pulsing "LIVE" + last-event time when listening (recent event)', () => {
    // last event 4 minutes ago → within the lookback window.
    const recent = new Date(NOW_MS - 4 * 60_000).toISOString();
    swrReturn = {
      data: resp({ lastReceivedAt: recent, events: [row({ id: 's1', received_at: recent })] }),
      error: undefined,
    };
    render(<ActivityFeed />);
    const badge = screen.getByTestId('live-badge');
    expect(badge.getAttribute('data-state')).toBe('listening');
    expect(badge.textContent).toContain('LIVE');
    // last-event relative time present (4 minutes → "4ד׳").
    expect(badge.textContent).toMatch(/4/);
  });

  it('GRAY "מאזין" when connected but no events in the lookback window', () => {
    // No events at all → idle/listening-no-events.
    swrReturn = { data: resp({ lastReceivedAt: null, events: [] }), error: undefined };
    render(<ActivityFeed />);
    const badge = screen.getByTestId('live-badge');
    expect(badge.getAttribute('data-state')).toBe('idle');
    expect(badge.textContent).toContain('מאזין');
  });

  it('GRAY "מאזין" when the only event is older than the lookback window', () => {
    // 40 minutes ago → outside the 15-min window → idle.
    const stale = new Date(NOW_MS - 40 * 60_000).toISOString();
    swrReturn = {
      data: resp({ lastReceivedAt: stale, events: [row({ id: 's1', received_at: stale })] }),
      error: undefined,
    };
    render(<ActivityFeed />);
    expect(screen.getByTestId('live-badge').getAttribute('data-state')).toBe('idle');
  });

  it('RED "נותק" when the SWR read errors (disconnected)', () => {
    swrReturn = { data: undefined, error: new Error('HTTP 500') };
    render(<ActivityFeed />);
    const badge = screen.getByTestId('live-badge');
    expect(badge.getAttribute('data-state')).toBe('disconnected');
    expect(badge.textContent).toContain('נותק');
  });
});

describe('<ActivityFeed> — empty / listening state', () => {
  it('shows the "מאזין בזמן אמת…" empty state with the dynamic store-count copy', () => {
    swrReturn = { data: resp({ lastReceivedAt: null, events: [] }), error: undefined };
    render(<ActivityFeed />);
    expect(screen.getByText(/מאזין בזמן אמת/)).toBeInTheDocument();
    // P1-26 (2026-06-10): the count is now DYNAMIC (useStores → fallback 3).
    // Both the empty state ("מחובר ל-3 החנויות") and the footer
    // ("מאזין ל-3 החנויות") carry it.
    expect(screen.getByText(/מחובר ל-3 החנויות/)).toBeInTheDocument();
    expect(screen.getByText(/מאזין ל-3 החנויות/)).toBeInTheDocument();
  });

  it('scopes the copy to the filtered store when a store filter is active (P1-26)', () => {
    swrReturn = { data: resp({ lastReceivedAt: null, events: [] }), error: undefined };
    render(<ActivityFeed store="zolplus" />);
    // Filtered to one store → no "N חנויות" claim; the store name appears.
    expect(screen.getByText(/מחובר לחנות zolplus/)).toBeInTheDocument();
    expect(screen.getByText(/מאזין לחנות zolplus/)).toBeInTheDocument();
    expect(screen.queryByText(/החנויות/)).toBeNull();
  });
});

describe('<ActivityFeed> — reduced motion', () => {
  it('omits the slide-in animation class when prefers-reduced-motion: reduce (default stub)', () => {
    swrReturn = {
      data: resp({ lastReceivedAt: NOW, events: [row({ id: 's1' })] }),
      error: undefined,
    };
    const { container } = render(<ActivityFeed />);
    // The first row would carry the fresh slide-in class only when motion is allowed.
    const row0 = container.querySelector('[data-testid="store-event-row"]')!;
    expect(row0.className).not.toMatch(/animate-fade-in-up/);
  });

  it('applies the slide-in animation class when motion is allowed', () => {
    // Flip the matchMedia stub so reduced-motion reports false.
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    swrReturn = {
      data: resp({ lastReceivedAt: NOW, events: [row({ id: 's1' })] }),
      error: undefined,
    };
    const { container } = render(<ActivityFeed />);
    const row0 = container.querySelector('[data-testid="store-event-row"]')!;
    expect(row0.className).toMatch(/animate-fade-in-up/);
  });
});

describe('<ActivityFeed> — RTL + filter', () => {
  it('numbers are wrapped in <bdi> for RTL isolation', () => {
    swrReturn = {
      data: resp({ lastReceivedAt: NOW, events: [row({ id: 's1', amount_cad: 248 })] }),
      error: undefined,
    };
    const { container } = render(<ActivityFeed />);
    expect(container.querySelector('bdi[dir="ltr"]')).not.toBeNull();
  });

  it('builds the ?store= query when a specific store is passed', () => {
    swrReturn = { data: resp({ lastReceivedAt: null, events: [] }), error: undefined };
    render(<ActivityFeed store="uzoshop" />);
    expect(screen.getByTestId('activity-feed')).toBeInTheDocument();
    expect(lastSwrKey).toContain('store=uzoshop');
  });

  it('resolves a display NAME to the internal store_id in the query (name≠id bug)', () => {
    // Home passes the display name; the route filters store_events.store_id.
    // "Zol Plus" must become store=zolplus, "360usmile" → store=usmile360 —
    // else those stores returned an empty feed.
    swrReturn = { data: resp({ lastReceivedAt: null, events: [] }), error: undefined };
    render(<ActivityFeed store="Zol Plus" />);
    expect(lastSwrKey).toContain('store=zolplus');
    render(<ActivityFeed store="360usmile" />);
    expect(lastSwrKey).toContain('store=usmile360');
  });

  it('omits ?store= for All / undefined', () => {
    swrReturn = { data: resp(), error: undefined };
    render(<ActivityFeed store="All" />);
    expect(lastSwrKey).not.toContain('store=');
  });

  it('renders a "ראה הכל" footer link when onSeeAll is provided and fires it on click', () => {
    const onSeeAll = vi.fn();
    swrReturn = {
      data: resp({ lastReceivedAt: NOW, events: [row({ id: 's1' })] }),
      error: undefined,
    };
    render(<ActivityFeed onSeeAll={onSeeAll} />);
    const link = screen.getByTestId('activity-feed-see-all');
    expect(link.textContent).toContain('ראה הכל');
    fireEvent.click(link);
    expect(onSeeAll).toHaveBeenCalledTimes(1);
  });

  it('does NOT render the "ראה הכל" link when onSeeAll is omitted', () => {
    swrReturn = {
      data: resp({ lastReceivedAt: NOW, events: [row({ id: 's1' })] }),
      error: undefined,
    };
    render(<ActivityFeed />);
    expect(screen.queryByTestId('activity-feed-see-all')).toBeNull();
  });

  it('the row text is rendered (no raw HTML injection path)', () => {
    swrReturn = {
      data: resp({
        lastReceivedAt: NOW,
        events: [row({ id: 's1', product_title: '<b>x</b>' })],
      }),
      error: undefined,
    };
    const { container } = render(<ActivityFeed />);
    // The literal angle-bracket string renders as TEXT, never as a <b> element.
    expect(container.querySelector('b')).toBeNull();
    expect(within(container).getByText('<b>x</b>')).toBeInTheDocument();
  });
});

describe('<ActivityFeed> — Home snapshot cap', () => {
  it('renders at most 20 rows even when more events are returned (the rest live behind ראה הכל)', () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      row({ id: `e${i}`, product_title: `מוצר ${i}` }),
    );
    swrReturn = { data: resp({ lastReceivedAt: NOW, events: many }), error: undefined };
    const { container } = render(<ActivityFeed />);
    expect(container.querySelectorAll('[data-testid="store-event-row"]').length).toBe(20);
  });
});
