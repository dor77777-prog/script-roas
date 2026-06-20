// dashboard-web/src/components/home/__tests__/RoasTargetChartOrganicKpi.dom.test.tsx
//
// FIX #21 — RoasTargetChart KPI tile / TL;DR mis-band ORGANIC (spend=0)
// periods as RED "0.00x" while the chart LINE already shows gray "organic".
//
// Root cause: the ROAS KPI tile banded from useRoasBandGradient(kpis.roas).
// In an organic period kpis.roas is 0 → bandForRoas(0) = red, and the value
// rendered "0.00x". Meanwhile the chart line uses bandForPeriod({roas, spend})
// which returns gray + dashed when spend===0. The two surfaces disagreed.
//
// Fix: band the KPI tile + TL;DR from the SAME spend-aware source the chart
// line uses (bandForPeriod), and render an organic label ("אורגני") instead
// of "0.00x" when spend===0.

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  RoasTargetChart,
  type RoasChartData,
} from '@/components/home/RoasTargetChart';

// An organic period: real revenue, ZERO ad spend → roas folds to 0 upstream.
// Chart points are gaps (null) because every day was no-spend.
function organicData(): RoasChartData {
  return {
    points: [
      { date: '2026-06-13', roas: null },
      { date: '2026-06-14', roas: null },
      { date: '2026-06-15', roas: null },
    ],
    pins: [],
    kpis: {
      revenue: 4_200,
      roas: 0, // organic — no meaningful ratio
      spend: 0, // <-- the organic signal
      netProfit: 3_100,
      cpm: 0,
    },
    daysActive: 0,
  };
}

describe('<RoasTargetChart> — organic (spend=0) KPI tile (FIX #21)', () => {
  it('ROAS KPI tile is gray/organic, NOT red "0.00x"', () => {
    render(<RoasTargetChart range="30" data={organicData()} />);
    const tile = screen.getByTestId('chart-kpi-roas');

    // Must NOT render the misleading red "0.00x".
    expect(tile.textContent).not.toMatch(/0\.00x/);

    // The value reads as organic ("אורגני") or an em-dash — not a fake ratio.
    expect(tile.textContent).toMatch(/אורגני|—/);

    // Band chip is the gray "no ad activity" chip, matching the chart line.
    expect(tile.querySelector('.chip-gray')).not.toBeNull();
    expect(tile.querySelector('.chip-red')).toBeNull();
  });

  it('a spend-backed period still bands + shows the numeric ROAS (no regression)', () => {
    const paid: RoasChartData = {
      ...organicData(),
      kpis: { revenue: 4_200, roas: 2.85, spend: 1_400, netProfit: 3_100, cpm: 12 },
    };
    render(<RoasTargetChart range="30" data={paid} />);
    const tile = screen.getByTestId('chart-kpi-roas');
    expect(tile.textContent).toMatch(/2\.85x/);
    // 2.85 → green band, never the organic gray chip.
    expect(tile.querySelector('.chip-green')).not.toBeNull();
  });
});
