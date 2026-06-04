import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FirstClickCoverageChip } from '@/components/FirstClickCoverageChip';

describe('FirstClickCoverageChip', () => {
  it('renders the coverage percentage', () => {
    render(<FirstClickCoverageChip firstClickOrders={3} lastClickOrders={10} />);
    // 3/10 = 30%
    expect(screen.getByTestId('first-click-coverage-chip').textContent).toContain('30%');
  });

  it('renders 0% (never NaN) when there are no last-click orders', () => {
    render(<FirstClickCoverageChip firstClickOrders={0} lastClickOrders={0} />);
    const chip = screen.getByTestId('first-click-coverage-chip');
    expect(chip.textContent).toContain('0%');
    expect(chip.textContent).not.toContain('NaN');
  });

  it('uses the quiet tone when coverage is healthy and a warn tone when low', () => {
    const { rerender } = render(
      <FirstClickCoverageChip firstClickOrders={9} lastClickOrders={10} />,
    );
    expect(screen.getByTestId('first-click-coverage-chip').getAttribute('data-tone')).toBe('quiet');
    rerender(<FirstClickCoverageChip firstClickOrders={1} lastClickOrders={10} />);
    expect(screen.getByTestId('first-click-coverage-chip').getAttribute('data-tone')).toBe('warn');
  });

  it('exposes the Google-blind caveat in the tooltip', async () => {
    // The chip wires its caveat through the Radix <HelpTooltip> (the repo's
    // no-native-title rule forbids title=); content mounts on hover.
    render(<FirstClickCoverageChip firstClickOrders={3} lastClickOrders={10} />);
    fireEvent.pointerMove(screen.getByTestId('first-click-coverage-chip'));
    const tip = await screen.findByRole('tooltip');
    expect(tip.textContent).toContain('Google');
  });

  it('clamps the displayed percentage to 100 when first-click exceeds last-click', () => {
    // first-click and last-click are different order sets, so the raw ratio can
    // exceed 1 (e.g. 15/10 = 150%). The chip must never render >100%.
    render(<FirstClickCoverageChip firstClickOrders={15} lastClickOrders={10} />);
    const chip = screen.getByTestId('first-click-coverage-chip');
    expect(chip.textContent).toContain('100%');
    expect(chip.textContent).not.toContain('150%');
  });

  it('keeps the real (unclamped) ratio in the tooltip when it exceeds 100%', async () => {
    render(<FirstClickCoverageChip firstClickOrders={15} lastClickOrders={10} />);
    fireEvent.pointerMove(screen.getByTestId('first-click-coverage-chip'));
    const tip = await screen.findByRole('tooltip');
    // Raw counts (15 of 10) are still surfaced in the tooltip text.
    expect(tip.textContent).toContain('15');
    expect(tip.textContent).toContain('10');
  });
});
