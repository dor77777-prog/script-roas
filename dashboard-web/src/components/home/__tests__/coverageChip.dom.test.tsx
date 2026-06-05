// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CoverageChip } from '@/components/home/CoverageChip';
import type { UnknownBucketBreakdown } from '@/lib/home/unknownBucket';

afterEach(() => cleanup());

/** A non-empty breakdown so <UnknownBucketPanel> renders (it returns null at 0). */
function sampleBreakdown(): UnknownBucketBreakdown {
  return {
    unknownOrders: 41,
    unknownRevenueCad: 1044,
    newVsReturning: { new: 23, returning: 14, unclassifiable: 4 },
    aovBands: { low: 11, mid: 22, high: 8 },
    byStore: [{ store: 'uzoshop', orders: 26 }],
    topProducts: [],
    byPaymentCategory: { credit: 29, paypal: 9, other: 3 },
  };
}

describe('CoverageChip (2026-06-02)', () => {
  it('renders nothing when coverage is null', () => {
    const { container } = render(<CoverageChip coverage={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the coverage % quietly when not prominent', () => {
    const { getByTestId } = render(
      <CoverageChip coverage={{ coverageShare: 0.82, unknownShare: 0.18, prominent: false }} />,
    );
    const el = getByTestId('coverage-chip');
    expect(el.textContent ?? '').toMatch(/82/);
    expect(el.getAttribute('data-prominent')).toBe('false');
  });

  it('flags prominent when unknown is high', () => {
    const { getByTestId } = render(
      <CoverageChip coverage={{ coverageShare: 0.55, unknownShare: 0.45, prominent: true }} />,
    );
    expect(getByTestId('coverage-chip').getAttribute('data-prominent')).toBe('true');
  });

  // The chip wires its help text through the Radix-based <HelpTooltip>
  // primitive (commit fee304a replaced the native `title` attribute), so the
  // content lives in a portal that only mounts once the tooltip opens. Mirror
  // the established pattern in components/ui/__tests__/Tooltip.test.tsx: hover
  // the trigger, then assert the rendered tooltip names the legit causes.
  it('carries a tooltip naming legit unknown causes', async () => {
    render(
      <CoverageChip coverage={{ coverageShare: 0.55, unknownShare: 0.45, prominent: true }} />,
    );
    fireEvent.pointerMove(screen.getByTestId('coverage-chip'));
    const tip = await screen.findByRole('tooltip');
    expect(tip.textContent ?? '').toMatch(/express|headless|untagged|privacy|תשלום מהיר|לא מתויג/i);
  });

  // A.3 — when a breakdown is supplied AND the chip is prominent (>30% unknown),
  // the chip becomes a disclosure: an expand trigger reveals the inline
  // <UnknownBucketPanel>.
  it('exposes a disclosure that reveals the unknown-bucket panel when prominent + breakdown given', async () => {
    const user = userEvent.setup();
    render(
      <CoverageChip
        coverage={{ coverageShare: 0.68, unknownShare: 0.32, prominent: true }}
        breakdown={sampleBreakdown()}
      />,
    );
    // Panel is hidden until expanded.
    expect(screen.queryByTestId('unknown-bucket-panel')).toBeNull();
    const trigger = screen.getByTestId('coverage-chip-expand');
    await user.click(trigger);
    expect(screen.getByTestId('unknown-bucket-panel')).toBeInTheDocument();
  });

  // Back-compat: a breakdown alone (no prominent state) does NOT turn the chip
  // into a disclosure — the chip stays the honest quiet summary.
  it('does not expose a disclosure when not prominent even if a breakdown is given', () => {
    render(
      <CoverageChip
        coverage={{ coverageShare: 0.82, unknownShare: 0.18, prominent: false }}
        breakdown={sampleBreakdown()}
      />,
    );
    expect(screen.queryByTestId('coverage-chip-expand')).toBeNull();
    expect(screen.getByTestId('coverage-chip')).toBeInTheDocument();
  });
});
