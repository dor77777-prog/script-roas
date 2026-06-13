// dashboard-web/src/components/operator/__tests__/StatusEventsFeed.dom.test.tsx
//
// W7-T6 (Horizon re-skin Wave 7) — smoke DOM tests for StatusEventsFeed.
//
// The feed was converted from a hand-rolled `<section border…rounded-lg>` to the
// shared glass `<Card>` primitive, and its inner "שינויי סטטוס אחרונים" heading
// was DROPPED (ActivityTab already self-titles the panel — the inner heading was
// a duplicate). The "(50 אחרונים)" count is kept as a muted caption so no info is
// lost. These tests pin: (1) renders as a Card with the events, (2) the duplicate
// heading is gone, (3) the count caption survives, (4) loading + empty states.
//
// Mirrors FreshnessPanel.dom.test.tsx: mock `swr` (the component polls via
// useSWR) + `@/lib/operatorClient` (the fetcher) so the component renders
// synchronously off the supplied data.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks — must precede the import of the module under test.
// ---------------------------------------------------------------------------
let nextSwrResult: { data: unknown; isLoading: boolean } = {
  data: undefined,
  isLoading: true,
};
function setSwrResult(r: { data: unknown; isLoading: boolean }) {
  nextSwrResult = r;
}

vi.mock('swr', () => ({
  default: () => nextSwrResult,
}));

vi.mock('@/lib/operatorClient', () => ({
  operatorFetch: vi.fn(),
}));

import { StatusEventsFeed } from '../StatusEventsFeed';
import type { StatusEventRow } from '@/lib/operator/registriesReaders';

beforeEach(() => {
  cleanup();
  setSwrResult({ data: undefined, isLoading: true });
});

function makeEvent(overrides: Partial<StatusEventRow> = {}): StatusEventRow {
  return {
    id: 1,
    store_id: 'uzoshop',
    platform: 'meta',
    entity_type: 'campaign',
    entity_id: 'c_123',
    occurred_at: new Date().toISOString(),
    from_status: 'ACTIVE',
    to_status: 'PAUSED',
    change_kind: 'paused',
    ...overrides,
  };
}

describe('<StatusEventsFeed>', () => {
  it('loading state renders the Card shell with a טוען… message', () => {
    setSwrResult({ data: undefined, isLoading: true });
    render(<StatusEventsFeed />);
    expect(screen.getByTestId('status-events-feed')).toBeTruthy();
    expect(screen.getByText('טוען…')).toBeTruthy();
  });

  it('empty state renders the Card with the "no events yet" copy', () => {
    setSwrResult({ data: { events: [] }, isLoading: false });
    render(<StatusEventsFeed />);
    const card = screen.getByTestId('status-events-feed');
    expect(card).toBeTruthy();
    expect(card.textContent).toContain('אין אירועי סטטוס עדיין');
  });

  it('renders the events inside a Card and keeps the (50 אחרונים) count caption', () => {
    setSwrResult({
      data: {
        events: [
          makeEvent({ id: 1, entity_id: 'c_aaa', to_status: 'PAUSED' }),
          makeEvent({ id: 2, entity_id: 'c_bbb', to_status: 'ACTIVE', change_kind: 'enabled' }),
        ],
      },
      isLoading: false,
    });
    render(<StatusEventsFeed />);

    const card = screen.getByTestId('status-events-feed');
    // .glass is the Card primitive's canonical surface class — proves the
    // hand-rolled <section> is now a real Card.
    expect(card.className).toContain('glass');
    // Count caption survives (no info loss).
    expect(card.textContent).toContain('(50 אחרונים)');
    // Both events render.
    expect(card.textContent).toContain('c_aaa');
    expect(card.textContent).toContain('c_bbb');
    // The events are in a list.
    expect(card.querySelectorAll('li').length).toBe(2);
  });

  it('no longer renders the duplicated "שינויי סטטוס אחרונים" heading', () => {
    setSwrResult({
      data: { events: [makeEvent()] },
      isLoading: false,
    });
    render(<StatusEventsFeed />);
    // The inner heading was dropped (ActivityTab self-titles the panel) — there
    // must be NO heading element carrying the old duplicate text.
    const headings = screen.queryAllByRole('heading');
    expect(headings.length).toBe(0);
    expect(screen.queryByText('שינויי סטטוס אחרונים')).toBeNull();
  });
});
