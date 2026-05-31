// dashboard-web/src/components/ui/__tests__/StatusPill.dom.test.tsx
//
// Task 5.1 (UI/UX overhaul) — DOM tests for the operator <StatusPill>.
//
// We mock `swr` so each test can hand the component a fixed
// HealthSummaryResponse without spinning a real fetcher loop. The component
// is a thin presentational wrapper over the chip CSS variants from
// globals.css, so the tests focus on:
//  - status → CSS class mapping (live / aging / stale / neutral)
//  - GREEN pulses; YELLOW / RED / UNKNOWN do not
//  - loading state renders a neutral chip with טוען (no flash of stale color)
//  - the title attribute carries freshness % + errors count for hover diag

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Hoisted SWR mock — each test calls setSwrResult(...) before render.
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

import { StatusPill } from '../StatusPill';
import type { HealthSummaryResponse } from '@/app/api/operator/health-summary/route';

function summary(overrides: Partial<HealthSummaryResponse> = {}): HealthSummaryResponse {
  return {
    status: 'green',
    freshness_pct: 1,
    errors_1h: 0,
    lastUpdated: new Date().toISOString(),
    ...overrides,
  };
}

describe('<StatusPill>', () => {
  beforeEach(() => {
    setSwrResult({ data: undefined, isLoading: true });
  });

  it('renders a neutral loading chip before data arrives', () => {
    setSwrResult({ data: undefined, isLoading: true });
    render(<StatusPill />);
    const pill = screen.getByTestId('operator-status-pill');
    expect(pill.getAttribute('data-status')).toBe('loading');
    expect(pill.textContent).toContain('טוען');
    // No pulsing dot on loading.
    expect(pill.querySelector('.pulse')).toBeNull();
  });

  it('GREEN status → .live chip + pulsing dot', () => {
    setSwrResult({
      data: summary({ status: 'green', freshness_pct: 1, errors_1h: 0 }),
      isLoading: false,
    });
    render(<StatusPill />);
    const pill = screen.getByTestId('operator-status-pill');
    expect(pill.getAttribute('data-status')).toBe('green');
    expect(pill.className).toContain('live');
    expect(pill.querySelector('.pulse')).not.toBeNull();
    expect(pill.textContent).toContain('תקין');
    expect(pill.textContent).toContain('100%');
  });

  it('YELLOW status → .aging chip + no pulse', () => {
    setSwrResult({
      data: summary({ status: 'yellow', freshness_pct: 0.88, errors_1h: 2 }),
      isLoading: false,
    });
    render(<StatusPill />);
    const pill = screen.getByTestId('operator-status-pill');
    expect(pill.getAttribute('data-status')).toBe('yellow');
    expect(pill.className).toContain('aging');
    expect(pill.querySelector('.pulse')).toBeNull();
    expect(pill.textContent).toContain('דורש תשומת לב');
    expect(pill.textContent).toContain('88%');
  });

  it('RED status → .stale chip + no pulse', () => {
    setSwrResult({
      data: summary({ status: 'red', freshness_pct: 0.5, errors_1h: 7 }),
      isLoading: false,
    });
    render(<StatusPill />);
    const pill = screen.getByTestId('operator-status-pill');
    expect(pill.getAttribute('data-status')).toBe('red');
    expect(pill.className).toContain('stale');
    expect(pill.querySelector('.pulse')).toBeNull();
    expect(pill.textContent).toContain('דורש טיפול דחוף');
    expect(pill.textContent).toContain('50%');
  });

  it('UNKNOWN status → neutral chip without chip color class', () => {
    setSwrResult({
      data: summary({ status: 'unknown', freshness_pct: 0, errors_1h: 0 }),
      isLoading: false,
    });
    render(<StatusPill />);
    const pill = screen.getByTestId('operator-status-pill');
    expect(pill.getAttribute('data-status')).toBe('unknown');
    expect(pill.className).not.toContain('live');
    expect(pill.className).not.toContain('aging');
    expect(pill.className).not.toContain('stale');
    expect(pill.textContent).toContain('לא זמין');
  });

  it('data-tooltip exposes freshness % + errors count (hover surface)', () => {
    setSwrResult({
      data: summary({ status: 'yellow', freshness_pct: 0.9, errors_1h: 1 }),
      isLoading: false,
    });
    render(<StatusPill />);
    const pill = screen.getByTestId('operator-status-pill');
    expect(pill.getAttribute('data-tooltip')).toBe('freshness 90% · 1 errors');
  });
});
