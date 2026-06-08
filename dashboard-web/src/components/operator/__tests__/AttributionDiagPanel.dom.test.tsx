// @vitest-environment jsdom
//
// dashboard-web/src/components/operator/__tests__/AttributionDiagPanel.dom.test.tsx
//
// classify-v2 T4 — the re-runnable attribution diagnostic panel. Renders the
// orders + ATC source-distribution tables, the murky-bucket breakdowns, and the
// first-touch coverage from a mocked /api/operator/attribution-diag response.
// Source labels come from the shared sourceLabels vocabulary (SOURCE_LABEL).
// The refresh button must re-fetch (we assert mutate() is invoked).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

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
const mutateSpy = vi.fn(() => Promise.resolve());

vi.mock('swr', () => ({
  default: () => nextSwrResult,
  useSWRConfig: () => ({ mutate: mutateSpy }),
}));

vi.mock('@/lib/operatorClient', () => ({
  operatorFetch: vi.fn(),
}));

import { AttributionDiagPanel } from '../AttributionDiagPanel';
import type { AttributionDiagResponse } from '@/app/api/operator/attribution-diag/route';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------
function sample(): AttributionDiagResponse {
  return {
    range: { from: '2026-05-08', to: '2026-06-07' },
    orders: {
      total: 100,
      bySource: [
        { source: 'meta-paid', count: 60, pct: 60 },
        { source: 'direct', count: 30, pct: 30 },
        { source: 'other-paid', count: 10, pct: 10 },
      ],
    },
    atc: {
      total: 50,
      bySource: [
        { source: 'direct', count: 40, pct: 80 },
        { source: 'meta-paid', count: 10, pct: 20 },
      ],
    },
    buckets: {
      otherPaid: [
        { key: 'partnerX | affiliate', count: 7 },
        { key: 'influencerY | bio', count: 3 },
      ],
      otherReferral: [{ domain: 'blog.example.com', count: 5 }],
      directFirstTouch: [
        { firstTouch: 'meta-paid', count: 12 },
        { firstTouch: '(ללא)', count: 18 },
      ],
    },
    firstTouchCoverage: {
      orders: { withFt: 42, total: 100, pct: 42 },
      atc: { withFt: 12, total: 50, pct: 24 },
    },
  };
}

function diagResp(body: AttributionDiagResponse) {
  return body;
}

beforeEach(() => {
  setSwrResult({ data: undefined, isLoading: true });
  mutateSpy.mockClear();
});
afterEach(() => cleanup());

describe('AttributionDiagPanel', () => {
  it('renders a loading state on first paint', () => {
    setSwrResult({ data: undefined, isLoading: true });
    render(<AttributionDiagPanel />);
    expect(screen.getByText(/טוען/)).toBeDefined();
  });

  it('renders the orders source-distribution table with Hebrew labels + counts + pct', () => {
    setSwrResult({ data: diagResp(sample()), isLoading: false });
    render(<AttributionDiagPanel />);
    // SOURCE_LABEL['meta-paid'] === 'Meta (paid)'; direct → 'ישיר (no UTM)'.
    expect(screen.getAllByText('Meta (paid)').length).toBeGreaterThan(0);
    expect(screen.getAllByText('ישיר (no UTM)').length).toBeGreaterThan(0);
    // Order count + percentage are rendered.
    expect(screen.getAllByText('60').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/60(\.0)?%/).length).toBeGreaterThan(0);
  });

  it('renders the ATC distribution distinctly from orders', () => {
    setSwrResult({ data: diagResp(sample()), isLoading: false });
    render(<AttributionDiagPanel />);
    // ATC total 50 + orders total 100 both appear.
    expect(screen.getAllByText(/100/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/50/).length).toBeGreaterThan(0);
    // direct count in ATC table is 40.
    expect(screen.getAllByText('40').length).toBeGreaterThan(0);
  });

  it('renders the murky-bucket breakdowns (other-paid combos, referrer domains, direct first-touch)', () => {
    setSwrResult({ data: diagResp(sample()), isLoading: false });
    render(<AttributionDiagPanel />);
    expect(screen.getByText('partnerX | affiliate')).toBeDefined();
    expect(screen.getByText('influencerY | bio')).toBeDefined();
    expect(screen.getByText('blog.example.com')).toBeDefined();
    expect(screen.getByText('(ללא)')).toBeDefined();
  });

  it('renders the first-touch coverage for both orders and ATC', () => {
    setSwrResult({ data: diagResp(sample()), isLoading: false });
    render(<AttributionDiagPanel />);
    // 42% orders coverage + 24% atc coverage.
    expect(screen.getAllByText(/42(\.0)?%/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/24(\.0)?%/).length).toBeGreaterThan(0);
  });

  it('refresh button re-fetches via SWR mutate', () => {
    setSwrResult({ data: diagResp(sample()), isLoading: false });
    render(<AttributionDiagPanel />);
    const btn = screen.getByTestId('attribution-diag-refresh');
    fireEvent.click(btn);
    expect(mutateSpy).toHaveBeenCalled();
  });

  it('shows an empty state when the range has no data', () => {
    const empty = sample();
    empty.orders = { total: 0, bySource: [] };
    empty.atc = { total: 0, bySource: [] };
    empty.buckets = { otherPaid: [], otherReferral: [], directFirstTouch: [] };
    empty.firstTouchCoverage = { orders: { withFt: 0, total: 0, pct: 0 }, atc: { withFt: 0, total: 0, pct: 0 } };
    setSwrResult({ data: diagResp(empty), isLoading: false });
    render(<AttributionDiagPanel />);
    expect(screen.getAllByText(/אין/).length).toBeGreaterThan(0);
  });
});
