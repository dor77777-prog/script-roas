// dashboard-web/src/components/operator/__tests__/FreshnessPanel.dom.test.tsx
//
// Component tests for FreshnessPanel.
//
// Task 5.2 (UI/UX overhaul, 2026-05-30): the panel was converted from an
// async server component (which called getFreshness() directly) to a client
// component that polls /api/operator/freshness via SWR @ 15 s. We now mock
// `swr` instead of `@/lib/inngest/freshness`.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

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

import { FreshnessPanel } from '../FreshnessPanel';
import type { FreshnessRow } from '@/lib/inngest/freshness';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<FreshnessRow> = {}): FreshnessRow {
  const now = new Date().toISOString();
  return {
    store_id: 'uzoshop',
    platform: 'meta',
    scope: 'campaign_status',
    table_name: 'campaigns_daily',
    last_attempt_at: now,
    last_success_at: now,
    status: 'success',
    lag_minutes: 0,
    error_code: null,
    error_message: null,
    budget_skip: false,
    updated_at: now,
    ...overrides,
  };
}

function freshnessResp(rows: FreshnessRow[]) {
  return { rows, lastUpdated: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FreshnessPanel', () => {
  beforeEach(() => {
    setSwrResult({ data: undefined, isLoading: true });
  });

  it('renders loading state on first paint', () => {
    setSwrResult({ data: undefined, isLoading: true });
    render(<FreshnessPanel />);
    expect(screen.getByText(/טוען טריות נתונים/)).toBeDefined();
  });

  it('renders empty state when SWR resolves with no rows', () => {
    setSwrResult({ data: freshnessResp([]), isLoading: false });
    render(<FreshnessPanel />);
    expect(screen.getByText(/אין רשומות freshness עדיין/)).toBeDefined();
  });

  it('renders one row per freshness entry', () => {
    const rows = [
      makeRow({ store_id: 'uzoshop', platform: 'meta', scope: 'campaign_status', table_name: 'campaigns_daily', lag_minutes: 5 }),
      makeRow({ store_id: 'zolplus', platform: 'tiktok', scope: 'ad_metrics', table_name: 'ads_daily', lag_minutes: 20 }),
      makeRow({ store_id: 'usmile360', platform: 'google', scope: 'kpi_daily', table_name: 'data_daily', lag_minutes: 0 }),
    ];
    setSwrResult({ data: freshnessResp(rows), isLoading: false });
    render(<FreshnessPanel />);
    expect(screen.getByText('uzoshop')).toBeDefined();
    expect(screen.getByText('zolplus')).toBeDefined();
    expect(screen.getByText('usmile360')).toBeDefined();
  });

  it('renders rows in the order returned by the API (stalest-first from helper)', () => {
    // The helper now returns rows ordered by last_success_at ASC NULLS FIRST
    // (stalest source first); the panel renders them in that order verbatim.
    const rows = [
      makeRow({ store_id: 'uzoshop', lag_minutes: 42 }),
      makeRow({ store_id: 'zolplus', lag_minutes: 15 }),
      makeRow({ store_id: 'usmile360', lag_minutes: 0 }),
    ];
    setSwrResult({ data: freshnessResp(rows), isLoading: false });
    const { container } = render(<FreshnessPanel />);
    const storeCells = container.querySelectorAll('tbody tr td:first-child');
    expect(storeCells[0].textContent).toBe('uzoshop');
    expect(storeCells[1].textContent).toBe('zolplus');
    expect(storeCells[2].textContent).toBe('usmile360');
  });

  it('shows CheckCircle2 (status-green) for success status', () => {
    setSwrResult({
      data: freshnessResp([makeRow({ status: 'success' })]),
      isLoading: false,
    });
    const { container } = render(<FreshnessPanel />);
    const greenIcons = container.querySelectorAll('.text-status-greenFg');
    expect(greenIcons.length).toBeGreaterThan(0);
  });

  it('shows AlertCircle (status-orange) for budget_skip status', () => {
    setSwrResult({
      data: freshnessResp([
        makeRow({ status: 'budget_skip', budget_skip: true, error_code: 'META_BUDGET_HIGH' }),
      ]),
      isLoading: false,
    });
    const { container } = render(<FreshnessPanel />);
    const orangeIcons = container.querySelectorAll('.text-status-orangeFg');
    expect(orangeIcons.length).toBeGreaterThan(0);
    expect(screen.getByText('META_BUDGET_HIGH')).toBeDefined();
  });

  it('shows XCircle (status-red) for transient_error status', () => {
    setSwrResult({
      data: freshnessResp([
        makeRow({ status: 'transient_error', error_message: '429 too many requests' }),
      ]),
      isLoading: false,
    });
    const { container } = render(<FreshnessPanel />);
    const redIcons = container.querySelectorAll('.text-status-redFg');
    expect(redIcons.length).toBeGreaterThan(0);
    expect(screen.getByText(/429 too many requests/)).toBeDefined();
  });

  it('shows XCircle for auth_error status', () => {
    setSwrResult({
      data: freshnessResp([
        makeRow({ status: 'auth_error', error_message: 'Token expired' }),
      ]),
      isLoading: false,
    });
    const { container } = render(<FreshnessPanel />);
    const redIcons = container.querySelectorAll('.text-status-redFg');
    expect(redIcons.length).toBeGreaterThan(0);
  });

  // FIX #5: the Lag column now shows LIVE lag computed from last_success_at,
  // NOT the frozen lag_minutes (which is pinned to 0 on every success, so a
  // dead worker would otherwise read "0 min stale" forever).
  it('displays LIVE lag (from last_success_at) in the lag column, not frozen lag_minutes', () => {
    const fortyMinAgo = new Date(Date.now() - 40 * 60_000).toISOString();
    setSwrResult({
      data: freshnessResp([
        // status success + frozen lag_minutes 0, but last_success_at is 40 min old.
        makeRow({ status: 'success', lag_minutes: 0, last_success_at: fortyMinAgo }),
      ]),
      isLoading: false,
    });
    render(<FreshnessPanel />);
    // Live lag ≈ 40 (allow 39/40 for tick boundary), NOT the frozen 0.
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.getByText(/^(39|40)$/)).toBeDefined();
  });

  it('flags an aged success row (> 60 min SLA) as stale (not green) — dead worker', () => {
    const ninetyMinAgo = new Date(Date.now() - 90 * 60_000).toISOString();
    setSwrResult({
      data: freshnessResp([
        makeRow({ scope: 'campaign_metrics', status: 'success', lag_minutes: 0, last_success_at: ninetyMinAgo }),
      ]),
      isLoading: false,
    });
    const { container } = render(<FreshnessPanel />);
    // No green icon — the aged success is downgraded to a stale (red) flag.
    expect(container.querySelectorAll('.text-status-greenFg').length).toBe(0);
    expect(container.querySelectorAll('.text-status-redFg').length).toBeGreaterThan(0);
  });

  it('displays — when last_success_at is null (never succeeded)', () => {
    setSwrResult({
      data: freshnessResp([makeRow({ lag_minutes: null, last_success_at: null })]),
      isLoading: false,
    });
    render(<FreshnessPanel />);
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThan(0);
  });
});
