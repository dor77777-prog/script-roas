// dashboard-web/src/components/home/__tests__/activityFeedSourceBadge.dom.test.tsx
//
// Focused DOM tests verifying the SourceBadge wiring in <ActivityFeed>:
//   • A non-refund row with source='meta-paid' shows a Meta platform badge.
//   • A refund row shows NO source badge (regardless of source value).
//
// Uses the same SWR-mock harness as ActivityFeed.dom.test.tsx.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { StoreEventsResponse } from '@/app/api/store-events/route';

// ---- SWR mock — same settable holder pattern as the main feed test. --------
let swrReturn: { data: StoreEventsResponse | undefined; error: unknown } = {
  data: undefined,
  error: undefined,
};

vi.mock('swr', () => ({
  default: (_key: string) => swrReturn,
}));

import { ActivityFeed } from '@/components/home/ActivityFeed';

const NOW = '2026-06-01T12:00:00Z';
const NOW_MS = Date.parse(NOW);

function row(
  over: Partial<StoreEventsResponse['events'][number]>,
): StoreEventsResponse['events'][number] {
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

describe('<ActivityFeed> — SourceBadge wiring', () => {
  it('sale row with source="meta-paid" shows a Meta platform badge', () => {
    swrReturn = {
      data: resp({
        lastReceivedAt: NOW,
        events: [row({ id: 's1', type: 'sale', source: 'meta-paid' })],
      }),
      error: undefined,
    };
    render(<ActivityFeed />);
    // The SourceBadge renders a PlatformBadge for Meta, which contains the text "Meta".
    expect(screen.getByText('Meta')).toBeInTheDocument();
    // The source-badge wrapper testid is present.
    expect(screen.getByTestId('source-badge')).toBeInTheDocument();
  });

  it('add_to_cart row with source="google-paid" shows a Google platform badge', () => {
    swrReturn = {
      data: resp({
        lastReceivedAt: NOW,
        events: [row({ id: 'c1', type: 'add_to_cart', amount_cad: null, source: 'google-paid' })],
      }),
      error: undefined,
    };
    render(<ActivityFeed />);
    expect(screen.getByText('Google')).toBeInTheDocument();
    expect(screen.getByTestId('source-badge')).toBeInTheDocument();
  });

  it('refund row does NOT show any source badge (even if source is set)', () => {
    swrReturn = {
      data: resp({
        lastReceivedAt: NOW,
        events: [row({ id: 'r1', type: 'refund', amount_cad: -59.9, source: 'meta-paid' })],
      }),
      error: undefined,
    };
    render(<ActivityFeed />);
    // Refund rows are gated: no source badge should appear.
    expect(screen.queryByTestId('source-badge')).toBeNull();
  });

  it('sale row with null source renders no badge (SourceBadge returns null for null)', () => {
    swrReturn = {
      data: resp({
        lastReceivedAt: NOW,
        events: [row({ id: 's2', type: 'sale', source: null })],
      }),
      error: undefined,
    };
    render(<ActivityFeed />);
    expect(screen.queryByTestId('source-badge')).toBeNull();
  });

  it('mixed rows: only the non-refund rows with a source show badges', () => {
    swrReturn = {
      data: resp({
        lastReceivedAt: NOW,
        events: [
          row({ id: 's1', type: 'sale', source: 'meta-paid' }),
          row({ id: 'r1', type: 'refund', amount_cad: -59.9, source: 'meta-paid' }),
          row({ id: 'c1', type: 'add_to_cart', amount_cad: null, source: 'tiktok-paid' }),
        ],
      }),
      error: undefined,
    };
    render(<ActivityFeed />);
    // 2 non-refund rows with sources → 2 badges (Meta + TikTok).
    expect(screen.getAllByTestId('source-badge').length).toBe(2);
    expect(screen.getByText('Meta')).toBeInTheDocument();
    expect(screen.getByText('TikTok')).toBeInTheDocument();
  });
});
