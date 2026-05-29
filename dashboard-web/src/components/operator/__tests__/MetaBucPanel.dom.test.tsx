// dashboard-web/src/components/operator/__tests__/MetaBucPanel.dom.test.tsx
//
// Component tests for MetaBucPanel (Phase A Task 15).
//
// Testing strategy: MetaBucPanel is an async server component that calls
// getSupabaseAdmin() internally. We mock @/lib/supabaseAdmin and extract the
// rendering logic into pure sub-components that are testable synchronously.
//
// We test the rendering branches by calling the component as an async
// function and awaiting the returned JSX, then rendering the result.
// This pattern is the pragmatic workaround recommended for server components
// in vitest/jsdom — React 18's renderToString works on server-component JSX
// if the component itself is awaited first (it returns a ReactElement, not a
// Promise<ReactElement> for the rendering step).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks — must be established before the module under test is imported.
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { MetaBucPanel } from '../MetaBucPanel';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_ROW = {
  store_id: 'uzoshop',
  ad_account_id: '123456',
  ads_insights_call_pct: 45,
  ads_insights_cputime_pct: 30,
  ads_insights_time_pct: 20,
  ads_insights_eta_minutes: 0,
  ads_management_call_pct: 55,
  ads_management_cputime_pct: 40,
  ads_management_time_pct: 35,
  ads_management_eta_minutes: 0,
  last_url: null,
  last_updated_at: new Date(Date.now() - 5 * 60_000).toISOString(), // 5 min ago
};

const HIGH_USAGE_ROW = {
  ...BASE_ROW,
  store_id: 'zolplus',
  ad_account_id: '789012',
  ads_insights_call_pct: 85, // ≥ 80 → status-red
  ads_insights_cputime_pct: 65, // ≥ 60 → status-orange
  ads_insights_time_pct: 92,
  ads_insights_eta_minutes: 45,
  ads_management_call_pct: 20,
  ads_management_cputime_pct: 10,
  ads_management_time_pct: 5,
  ads_management_eta_minutes: 0,
};

// Helper: build a mock Supabase chain that returns the given rows.
function mockSupabase(rows: typeof BASE_ROW[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    // Return a resolved promise so await works inside fetchBucRows.
    then: undefined as unknown,
  };
  // Make the chain itself thenable so `await sb.from(...).select(...).order(...)` resolves.
  const result = { data: rows };
  // Override .order to return a Promise-like object on the last call
  chain.order = vi.fn().mockImplementation(function (this: typeof chain) {
    // Return an object that resolves when awaited
    const thenableChain = {
      ...chain,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      then: (resolve: (v: typeof result) => void) => resolve(result),
    };
    return thenableChain;
  });
  (getSupabaseAdmin as ReturnType<typeof vi.fn>).mockReturnValue(chain);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MetaBucPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders empty state when fetch returns no rows', async () => {
    mockSupabase([]);
    const jsx = await MetaBucPanel();
    render(jsx);
    expect(
      screen.getByText(/אין נתוני BUC עדיין/),
    ).toBeDefined();
  });

  it('renders one card per (store, ad_account_id) row', async () => {
    mockSupabase([BASE_ROW, HIGH_USAGE_ROW]);
    const jsx = await MetaBucPanel();
    render(jsx);
    // Each card shows the store_id
    expect(screen.getByText('uzoshop')).toBeDefined();
    expect(screen.getByText('zolplus')).toBeDefined();
    // Each card shows the ad account ID with "act_" prefix
    expect(screen.getByText('act_123456')).toBeDefined();
    expect(screen.getByText('act_789012')).toBeDefined();
  });

  it('shows ETA badge when eta_minutes > 0', async () => {
    mockSupabase([HIGH_USAGE_ROW]); // ads_insights_eta_minutes = 45
    const jsx = await MetaBucPanel();
    render(jsx);
    // ETA text should appear for ads_insights block
    expect(screen.getByText(/ETA חזרה 45 דק׳/)).toBeDefined();
  });

  it('does NOT show ETA badge when eta_minutes = 0', async () => {
    mockSupabase([BASE_ROW]); // all eta = 0
    const jsx = await MetaBucPanel();
    render(jsx);
    const etaEls = screen.queryAllByText(/ETA חזרה/);
    expect(etaEls.length).toBe(0);
  });

  it('applies status-red class for pct >= 80', async () => {
    mockSupabase([HIGH_USAGE_ROW]); // ads_insights_call_pct = 85
    const jsx = await MetaBucPanel();
    const { container } = render(jsx);
    // The progress bar fill div for call_count should have bg-status-red
    const redBars = container.querySelectorAll('.bg-status-red');
    expect(redBars.length).toBeGreaterThan(0);
  });

  it('applies status-orange class for pct >= 60 and < 80', async () => {
    mockSupabase([HIGH_USAGE_ROW]); // ads_insights_cputime_pct = 65
    const jsx = await MetaBucPanel();
    const { container } = render(jsx);
    const orangeBars = container.querySelectorAll('.bg-status-orange');
    expect(orangeBars.length).toBeGreaterThan(0);
  });

  it('applies status-green class for pct < 60', async () => {
    mockSupabase([BASE_ROW]); // all pcts < 60
    const jsx = await MetaBucPanel();
    const { container } = render(jsx);
    const greenBars = container.querySelectorAll('.bg-status-green');
    expect(greenBars.length).toBeGreaterThan(0);
  });
});
