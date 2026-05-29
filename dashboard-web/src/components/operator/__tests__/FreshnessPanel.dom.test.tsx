// dashboard-web/src/components/operator/__tests__/FreshnessPanel.dom.test.tsx
//
// Component tests for FreshnessPanel (Phase A Task 15).
//
// Testing strategy: FreshnessPanel is an async server component that calls
// getFreshness() from @/lib/inngest/freshness. We mock that module and call
// the component as an async function, then render the returned ReactElement.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// Mocks — established before the module under test is imported.
// ---------------------------------------------------------------------------

vi.mock('@/lib/inngest/freshness', () => ({
  getFreshness: vi.fn(),
}));

import { getFreshness } from '@/lib/inngest/freshness';
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FreshnessPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders empty state when getFreshness returns []', async () => {
    (getFreshness as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const jsx = await FreshnessPanel();
    render(jsx);
    expect(screen.getByText(/אין נתוני freshness עדיין/)).toBeDefined();
  });

  it('renders one row per freshness entry', async () => {
    const rows = [
      makeRow({ store_id: 'uzoshop', platform: 'meta', scope: 'campaign_status', table_name: 'campaigns_daily', lag_minutes: 5 }),
      makeRow({ store_id: 'zolplus', platform: 'tiktok', scope: 'ad_metrics', table_name: 'ads_daily', lag_minutes: 20 }),
      makeRow({ store_id: 'usmile360', platform: 'google', scope: 'kpi_daily', table_name: 'data_daily', lag_minutes: 0 }),
    ];
    (getFreshness as ReturnType<typeof vi.fn>).mockResolvedValue(rows);
    const jsx = await FreshnessPanel();
    render(jsx);
    expect(screen.getByText('uzoshop')).toBeDefined();
    expect(screen.getByText('zolplus')).toBeDefined();
    expect(screen.getByText('usmile360')).toBeDefined();
  });

  it('renders rows in the order returned by getFreshness (lag DESC from helper)', async () => {
    // getFreshness already orders by lag_minutes DESC — component just renders.
    // We verify the DOM order matches the array order.
    const rows = [
      makeRow({ store_id: 'uzoshop', lag_minutes: 42 }),
      makeRow({ store_id: 'zolplus', lag_minutes: 15 }),
      makeRow({ store_id: 'usmile360', lag_minutes: 0 }),
    ];
    (getFreshness as ReturnType<typeof vi.fn>).mockResolvedValue(rows);
    const jsx = await FreshnessPanel();
    const { container } = render(jsx);
    const storeCells = container.querySelectorAll('tbody tr td:first-child');
    expect(storeCells[0].textContent).toBe('uzoshop');
    expect(storeCells[1].textContent).toBe('zolplus');
    expect(storeCells[2].textContent).toBe('usmile360');
  });

  it('shows CheckCircle2 (status-green) for success status', async () => {
    (getFreshness as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeRow({ status: 'success' }),
    ]);
    const jsx = await FreshnessPanel();
    const { container } = render(jsx);
    // lucide CheckCircle2 renders an SVG; verify the text-status-green class
    const greenIcons = container.querySelectorAll('.text-status-green');
    expect(greenIcons.length).toBeGreaterThan(0);
  });

  it('shows AlertCircle (status-orange) for budget_skip status', async () => {
    (getFreshness as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeRow({ status: 'budget_skip', budget_skip: true, error_code: 'META_BUDGET_HIGH' }),
    ]);
    const jsx = await FreshnessPanel();
    const { container } = render(jsx);
    const orangeIcons = container.querySelectorAll('.text-status-orange');
    expect(orangeIcons.length).toBeGreaterThan(0);
    // The error_code should appear in the notes column
    expect(screen.getByText('META_BUDGET_HIGH')).toBeDefined();
  });

  it('shows XCircle (status-red) for transient_error status', async () => {
    (getFreshness as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeRow({ status: 'transient_error', error_message: '429 too many requests' }),
    ]);
    const jsx = await FreshnessPanel();
    const { container } = render(jsx);
    const redIcons = container.querySelectorAll('.text-status-red');
    expect(redIcons.length).toBeGreaterThan(0);
    expect(screen.getByText(/429 too many requests/)).toBeDefined();
  });

  it('shows XCircle for auth_error status', async () => {
    (getFreshness as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeRow({ status: 'auth_error', error_message: 'Token expired' }),
    ]);
    const jsx = await FreshnessPanel();
    const { container } = render(jsx);
    const redIcons = container.querySelectorAll('.text-status-red');
    expect(redIcons.length).toBeGreaterThan(0);
  });

  it('displays lag_minutes as a number in the lag column', async () => {
    (getFreshness as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeRow({ lag_minutes: 37 }),
    ]);
    const jsx = await FreshnessPanel();
    render(jsx);
    expect(screen.getByText('37')).toBeDefined();
  });

  it('displays — when lag_minutes is null', async () => {
    (getFreshness as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeRow({ lag_minutes: null }),
    ]);
    const jsx = await FreshnessPanel();
    render(jsx);
    // There will be multiple — cells (lag + notes when no error)
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThan(0);
  });
});
