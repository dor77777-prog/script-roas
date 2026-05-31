// dashboard-web/src/components/home/__tests__/RoasTargetChart.dom.test.tsx
//
// Task 3.2 — DOM contract tests for <RoasTargetChart>.
//
// What this pins (one assertion per spec item):
//   (a) renders TL;DR sentence (and the band-tinted accent number)
//   (b) renders 5 KPI tiles inside the in-card strip
//   (c) default range = 30 (when URL is empty)
//   (d) clicking the 7-day preset writes ?chartRange=7 AND fires
//       onRangeChange('7'), letting the owner refetch + re-render
//   (e) clicking a pin opens its tooltip (initial: closed)
//   (f) clicking elsewhere (document outside the chart wrap) closes the
//       open tooltip
//   (g) initial state: NO tooltip visible (pin tips are hover-and-click
//       only — [[home-visual-rules]])
//   (h) the custom-range toggle reveals the from/to date inputs
//
// Routing model: the dashboard uses window.history.replaceState directly
// (no next/navigation hook). The test seeds + reads window.location.search
// the same way the production code does.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import {
  RoasTargetChart,
  type RoasChartData,
} from '@/components/home/RoasTargetChart';

/* --------------------------------------------------------------------------
 * Fixtures — a clean 7-point downtrend so synthesizeRoasChart returns
 * confidence='high' and direction='down'. The numbers are picked so the
 * mid-range delta crosses the 5% threshold the synthesiser uses.
 * -------------------------------------------------------------------------- */

function makeData(): RoasChartData {
  return {
    points: [
      { date: '2026-05-01', roas: 3.20 },
      { date: '2026-05-02', roas: 3.10 },
      { date: '2026-05-03', roas: 3.00 },
      { date: '2026-05-04', roas: 2.40 },
      { date: '2026-05-05', roas: 2.30 },
      { date: '2026-05-06', roas: 2.20 },
      { date: '2026-05-07', roas: 2.10 },
    ],
    pins: [
      {
        id: 'refund-05-04',
        date: '2026-05-04',
        label: 'יום רפאנד כבד · 04/05',
      },
    ],
    kpis: {
      revenue: 108_997,
      roas: 2.62,
      spend: 46_863,
      netProfit: 34_885,
      cpm: 16.13,
    },
    prevPeriod: { roas: 2.84, revenue: 99_100 },
    daysActive: 7,
  };
}

function resetUrl() {
  window.history.replaceState(null, '', '/');
}

beforeEach(() => {
  resetUrl();
});

describe('<RoasTargetChart>', () => {
  // (a) ----------------------------------------------------------------
  it('renders the TL;DR sentence with a band-tinted accent number', () => {
    render(
      <RoasTargetChart
        range="30"
        data={makeData()}
        scopeLabel="כל החנויות · 7 ימים"
      />,
    );
    const tldr = screen.getByTestId('chart-tldr');
    expect(tldr.textContent).toMatch(/ROAS/);
    // The accent number gets its own data-testid so we don't rely on
    // colour assertions (jsdom doesn't paint).
    expect(screen.getByTestId('chart-tldr-accent')).toBeInTheDocument();
  });

  // (b) ----------------------------------------------------------------
  it('renders 5 KPI tiles in the strip', () => {
    render(<RoasTargetChart range="30" data={makeData()} />);
    const strip = screen.getByTestId('chart-kpi-strip');
    // Each KPI tile is a direct child of the grid wrapper.
    expect(strip.children).toHaveLength(5);
  });

  // (c) ----------------------------------------------------------------
  it('default range is 30 when no URL param is set', () => {
    render(<RoasTargetChart range="30" data={makeData()} />);
    const preset30 = screen.getByTestId('chart-range-preset-30');
    expect(preset30).toHaveAttribute('aria-pressed', 'true');
    const preset7 = screen.getByTestId('chart-range-preset-7');
    expect(preset7).toHaveAttribute('aria-pressed', 'false');
  });

  // (d) ----------------------------------------------------------------
  it('clicking the 7-day preset writes ?chartRange=7 and fires onRangeChange', () => {
    const onRangeChange = vi.fn();
    const { rerender } = render(
      <RoasTargetChart
        range="30"
        data={makeData()}
        onRangeChange={onRangeChange}
      />,
    );

    const preset7 = screen.getByTestId('chart-range-preset-7');
    fireEvent.click(preset7);

    // Owner is told.
    expect(onRangeChange).toHaveBeenCalledWith('7', undefined);

    // URL persistence.
    expect(window.location.search).toBe('?chartRange=7');

    // Owner re-renders with the new range — picker reflects the new active.
    rerender(
      <RoasTargetChart
        range="7"
        data={makeData()}
        onRangeChange={onRangeChange}
      />,
    );
    expect(screen.getByTestId('chart-range-preset-7')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  // (e) ----------------------------------------------------------------
  it('clicking a pin opens its tooltip', () => {
    render(<RoasTargetChart range="30" data={makeData()} />);
    expect(
      screen.queryByTestId('chart-pin-tooltip-refund-05-04'),
    ).not.toBeInTheDocument();

    const pin = screen.getByTestId('chart-pin-refund-05-04');
    fireEvent.click(pin);

    expect(
      screen.getByTestId('chart-pin-tooltip-refund-05-04'),
    ).toBeInTheDocument();
  });

  // (f) ----------------------------------------------------------------
  it('clicking outside the chart wrap dismisses the open pin tooltip', () => {
    render(
      <div>
        <RoasTargetChart range="30" data={makeData()} />
        <div data-testid="outside">outside the chart</div>
      </div>,
    );

    const pin = screen.getByTestId('chart-pin-refund-05-04');
    fireEvent.click(pin);
    expect(
      screen.getByTestId('chart-pin-tooltip-refund-05-04'),
    ).toBeInTheDocument();

    // Fire pointerdown on something outside the chart wrap — production
    // uses pointerdown so it fires before click.
    act(() => {
      const outside = screen.getByTestId('outside');
      const evt = new Event('pointerdown', { bubbles: true });
      outside.dispatchEvent(evt);
    });

    expect(
      screen.queryByTestId('chart-pin-tooltip-refund-05-04'),
    ).not.toBeInTheDocument();
  });

  // (g) ----------------------------------------------------------------
  it('initial render shows NO pin tooltip (hover-and-click only)', () => {
    render(<RoasTargetChart range="30" data={makeData()} />);
    // Tooltip is rendered conditionally; nothing should match the testid
    // until a hover/click toggles it on.
    expect(
      screen.queryByTestId('chart-pin-tooltip-refund-05-04'),
    ).not.toBeInTheDocument();
  });

  // (h) ----------------------------------------------------------------
  it('the custom-range toggle reveals the from/to date inputs', () => {
    render(<RoasTargetChart range="30" data={makeData()} />);

    // Initially: no panel.
    expect(
      screen.queryByTestId('chart-range-custom-panel'),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('chart-range-custom-toggle'));

    expect(
      screen.getByTestId('chart-range-custom-panel'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('chart-range-from-input')).toBeInTheDocument();
    expect(screen.getByTestId('chart-range-to-input')).toBeInTheDocument();
  });

  /* -----------------------------------------------------------------
   * Extra coverage — sanity checks that protect the spec's invariants.
   * ----------------------------------------------------------------- */

  it('renders the dashed target line + roas data line', () => {
    render(<RoasTargetChart range="30" data={makeData()} target={3.0} />);
    expect(screen.getByTestId('chart-target-line')).toBeInTheDocument();
    expect(screen.getByTestId('chart-roas-line')).toBeInTheDocument();
  });

  it('hover on a pin opens its tooltip (mouseenter → tooltip visible)', () => {
    render(<RoasTargetChart range="30" data={makeData()} />);
    fireEvent.mouseEnter(screen.getByTestId('chart-pin-refund-05-04'));
    expect(
      screen.getByTestId('chart-pin-tooltip-refund-05-04'),
    ).toBeInTheDocument();
  });

  it('pin chip shows pin count', () => {
    render(<RoasTargetChart range="30" data={makeData()} />);
    expect(screen.getByTestId('chart-pin-count').textContent).toMatch(/1/);
  });

  /* -----------------------------------------------------------------
   * Task 3.6 — freshness wiring (badge + data-freshness must agree).
   * ----------------------------------------------------------------- */

  it('omits FreshnessBadge AND data-freshness when updatedAt prop not provided', () => {
    render(<RoasTargetChart range="30" data={makeData()} />);
    expect(screen.queryByTestId('freshness-badge')).not.toBeInTheDocument();
    expect(
      screen.getByTestId('roas-target-chart').hasAttribute('data-freshness'),
    ).toBe(false);
  });

  it('renders FreshnessBadge AND forwards data-freshness="stale" when updatedAt is 47 min old', () => {
    const STALE_TS = new Date(Date.now() - 47 * 60_000).toISOString();
    render(
      <RoasTargetChart range="30" data={makeData()} updatedAt={STALE_TS} />,
    );
    const card = screen.getByTestId('roas-target-chart');
    expect(card.getAttribute('data-freshness')).toBe('stale');
    const badge = screen.getByTestId('freshness-badge');
    expect(badge.getAttribute('data-stage')).toBe('stale');
    expect(badge.classList.contains('stale')).toBe(true);
  });

  it('per-platform updatedAt surfaces worst-platform label in the badge', () => {
    render(
      <RoasTargetChart
        range="30"
        data={makeData()}
        updatedAt={{
          meta:   new Date(Date.now() - 2 * 60_000).toISOString(),
          google: new Date(Date.now() - 4 * 60_000).toISOString(),
          tiktok: new Date(Date.now() - 107 * 60_000).toISOString(),
        }}
      />,
    );
    expect(screen.getByTestId('freshness-badge').textContent).toMatch(
      /TikTok stuck · 1h 47min/,
    );
    expect(
      screen.getByTestId('roas-target-chart').getAttribute('data-freshness'),
    ).toBe('stale');
  });
});
