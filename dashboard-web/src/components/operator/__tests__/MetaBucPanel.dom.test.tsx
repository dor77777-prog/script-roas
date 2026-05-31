// dashboard-web/src/components/operator/__tests__/MetaBucPanel.dom.test.tsx
//
// Component tests for MetaBucPanel.
//
// Task 5.2 (UI/UX overhaul, 2026-05-30): the panel was converted from an
// async server component to a client component that polls
// /api/operator/meta-buc-usage via SWR @ 15 s. We now mock `swr` instead
// of `@/lib/supabaseAdmin`.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks
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

import { MetaBucPanel } from '../MetaBucPanel';
import type { BucRow } from '@/app/api/operator/meta-buc-usage/route';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_ROW: BucRow = {
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
  last_updated_at: new Date(Date.now() - 5 * 60_000).toISOString(),
};

const HIGH_USAGE_ROW: BucRow = {
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

function metaBucResp(rows: BucRow[]) {
  return { rows, lastUpdated: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MetaBucPanel', () => {
  beforeEach(() => {
    setSwrResult({ data: undefined, isLoading: true });
  });

  it('renders loading state on first paint', () => {
    setSwrResult({ data: undefined, isLoading: true });
    render(<MetaBucPanel />);
    expect(screen.getByText(/טוען נתוני BUC/)).toBeDefined();
  });

  it('renders empty state when API returns no rows', () => {
    setSwrResult({ data: metaBucResp([]), isLoading: false });
    render(<MetaBucPanel />);
    expect(screen.getByText(/אין נתוני BUC עדיין/)).toBeDefined();
  });

  it('renders one card per (store, ad_account_id) row', () => {
    setSwrResult({
      data: metaBucResp([BASE_ROW, HIGH_USAGE_ROW]),
      isLoading: false,
    });
    render(<MetaBucPanel />);
    expect(screen.getByText('uzoshop')).toBeDefined();
    expect(screen.getByText('zolplus')).toBeDefined();
    expect(screen.getByText('act_123456')).toBeDefined();
    expect(screen.getByText('act_789012')).toBeDefined();
  });

  it('shows ETA badge when eta_minutes > 0', () => {
    setSwrResult({
      data: metaBucResp([HIGH_USAGE_ROW]),
      isLoading: false,
    });
    render(<MetaBucPanel />);
    expect(screen.getByText(/ETA חזרה 45 דק׳/)).toBeDefined();
  });

  it('does NOT show ETA badge when eta_minutes = 0', () => {
    setSwrResult({ data: metaBucResp([BASE_ROW]), isLoading: false });
    render(<MetaBucPanel />);
    expect(screen.queryAllByText(/ETA חזרה/).length).toBe(0);
  });

  it('applies status-red class for pct >= 80', () => {
    setSwrResult({
      data: metaBucResp([HIGH_USAGE_ROW]),
      isLoading: false,
    });
    const { container } = render(<MetaBucPanel />);
    const redBars = container.querySelectorAll('.bg-status-red');
    expect(redBars.length).toBeGreaterThan(0);
  });

  it('applies status-orange class for pct >= 60 and < 80', () => {
    setSwrResult({
      data: metaBucResp([HIGH_USAGE_ROW]),
      isLoading: false,
    });
    const { container } = render(<MetaBucPanel />);
    const orangeBars = container.querySelectorAll('.bg-status-orange');
    expect(orangeBars.length).toBeGreaterThan(0);
  });

  it('applies status-green class for pct < 60', () => {
    setSwrResult({ data: metaBucResp([BASE_ROW]), isLoading: false });
    const { container } = render(<MetaBucPanel />);
    const greenBars = container.querySelectorAll('.bg-status-green');
    expect(greenBars.length).toBeGreaterThan(0);
  });
});
