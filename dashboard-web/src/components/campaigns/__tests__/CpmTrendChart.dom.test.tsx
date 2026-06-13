// dashboard-web/src/components/campaigns/__tests__/CpmTrendChart.dom.test.tsx
//
// Horizon re-skin Wave 4 (debt #6) — the consolidated CpmTrendChart.
//
// Coverage (the contract both call-sites depend on):
//   1. Renders the verdict box + the Horizon SegmentedControl baseline toggle
//      + the ROAS-overlay checkbox.
//   2. The SegmentedControl toggles mode → onModeChange fires with the new value.
//   3. The ROAS-overlay checkbox toggles → the legend + right-axis path appears
//      (we assert the checkbox flips and the ROAS legend swatch shows up).
//   4. The FIX-19 fallback banner renders when mode='prev' but the previous
//      period has too few active days (analyzer falls back to half-over-half).
//   5. The optional close (X) button only renders when onClose is provided.
//
// Recharts' ResponsiveContainer collapses to 0×0 in jsdom, so the SVG line
// geometry is not asserted — every element these tests touch (verdict, toggle,
// checkbox, banner) lives OUTSIDE the chart SVG and renders unconditionally.

import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

import { CpmTrendChart } from '@/components/campaigns/CpmTrendChart';
import type { CpmTrendPoint } from '@/components/campaigns/CpmTrendChart';

// 6 active days, rising CPM + ROAS — enough for analyzeCpmVsRoas (n>=5) to
// produce a non-placeholder verdict (hasData=true).
function makeSeries(): CpmTrendPoint[] {
  const out: CpmTrendPoint[] = [];
  for (let i = 0; i < 6; i++) {
    const day = String(10 + i).padStart(2, '0');
    const spend = 100 + i * 10;
    const impressions = 10000;
    const value = 200 + i * 30;
    out.push({
      date: `2026-05-${day}`,
      spend,
      impressions,
      value,
      cpm: (spend / impressions) * 1000,
      roas: value / spend,
    });
  }
  return out;
}

const RANGE = { from: '2026-05-10', to: '2026-05-15' };
const PREV_RANGE = { from: '2026-05-04', to: '2026-05-09' };

describe('CpmTrendChart — render + verdict', () => {
  it('renders the verdict box, the baseline SegmentedControl, and the ROAS-overlay checkbox', () => {
    render(
      <CpmTrendChart
        cpmDaily={makeSeries()}
        cpmDailyPrev={null}
        range={RANGE}
        prevRange={PREV_RANGE}
        mode="half"
        onModeChange={() => {}}
      />,
    );
    expect(screen.getByTestId('cpm-trend-verdict')).toBeTruthy();
    expect(screen.getByTestId('cpm-trend-mode')).toBeTruthy();
    expect(screen.getByTestId('cpm-trend-roas-toggle')).toBeTruthy();
    // The verdict box always shows the "ניתוח:" prefix.
    expect(screen.getByTestId('cpm-trend-verdict').textContent).toContain('ניתוח:');
  });
});

describe('CpmTrendChart — SegmentedControl toggles mode → onModeChange', () => {
  it('clicking the "vs תקופה קודמת" option fires onModeChange("prev")', () => {
    const onModeChange = vi.fn();
    render(
      <CpmTrendChart
        cpmDaily={makeSeries()}
        cpmDailyPrev={null}
        range={RANGE}
        prevRange={PREV_RANGE}
        mode="half"
        onModeChange={onModeChange}
      />,
    );
    const seg = screen.getByTestId('cpm-trend-mode');
    // The radiogroup renders one button per option; find the prev option by label.
    const prevBtn = within(seg).getByText('vs תקופה קודמת');
    act(() => {
      fireEvent.click(prevBtn);
    });
    expect(onModeChange).toHaveBeenCalledWith('prev');
  });
});

describe('CpmTrendChart — ROAS-overlay checkbox', () => {
  it('toggling the checkbox flips its checked state and reveals the ROAS legend', () => {
    render(
      <CpmTrendChart
        cpmDaily={makeSeries()}
        cpmDailyPrev={null}
        range={RANGE}
        prevRange={PREV_RANGE}
        mode="half"
        onModeChange={() => {}}
      />,
    );
    const checkbox = screen.getByTestId('cpm-trend-roas-toggle') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    act(() => {
      fireEvent.click(checkbox);
    });
    expect(checkbox.checked).toBe(true);
    // The ROAS legend row (ציר ימין) only appears once the overlay is on.
    expect(screen.getByText(/ROAS \(ציר ימין\)/)).toBeTruthy();
  });
});

describe('CpmTrendChart — FIX-19 fallback banner', () => {
  it('shows the half-over-half fallback banner when mode=prev but prev has too few days', () => {
    render(
      <CpmTrendChart
        cpmDaily={makeSeries()}
        // Empty prev → analyzer can't use previous-period → falls back to
        // half-over-half → the FIX-19 banner fires.
        cpmDailyPrev={[]}
        range={RANGE}
        prevRange={PREV_RANGE}
        mode="prev"
        onModeChange={() => {}}
        isLoadingPrev={false}
      />,
    );
    const banner = screen.getByTestId('cpm-trend-fallback-banner');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain('מציג השוואת חצי-חצי במקום');
  });

  it('does NOT show the fallback banner while the prev fetch is still loading', () => {
    render(
      <CpmTrendChart
        cpmDaily={makeSeries()}
        cpmDailyPrev={undefined}
        range={RANGE}
        prevRange={PREV_RANGE}
        mode="prev"
        onModeChange={() => {}}
        isLoadingPrev
      />,
    );
    expect(screen.queryByTestId('cpm-trend-fallback-banner')).toBeNull();
  });
});

describe('CpmTrendChart — optional close button', () => {
  it('renders a close button only when onClose is provided', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <CpmTrendChart
        cpmDaily={makeSeries()}
        cpmDailyPrev={null}
        range={RANGE}
        prevRange={PREV_RANGE}
        mode="half"
        onModeChange={() => {}}
        onClose={onClose}
      />,
    );
    const closeBtn = screen.getByLabelText('סגור');
    act(() => {
      fireEvent.click(closeBtn);
    });
    expect(onClose).toHaveBeenCalled();

    // Without onClose, no close button is rendered.
    rerender(
      <CpmTrendChart
        cpmDaily={makeSeries()}
        cpmDailyPrev={null}
        range={RANGE}
        prevRange={PREV_RANGE}
        mode="half"
        onModeChange={() => {}}
      />,
    );
    expect(screen.queryByLabelText('סגור')).toBeNull();
  });
});
