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

  // Operator-approved (2026-06-05): the chip is ALWAYS expandable when there
  // are unknown orders — even when coverage is healthy (not prominent) — so the
  // operator can always inspect the bucket. The COLOR stays quiet (not the
  // warning band) when not prominent.
  it('is expandable when not prominent (quiet color) if the breakdown has unknown orders', async () => {
    const user = userEvent.setup();
    render(
      <CoverageChip
        coverage={{ coverageShare: 0.82, unknownShare: 0.18, prominent: false }}
        breakdown={sampleBreakdown()}
      />,
    );
    const chip = screen.getByTestId('coverage-chip');
    expect(chip).toHaveAttribute('data-prominent', 'false'); // quiet color, not the warning band
    const trigger = screen.getByTestId('coverage-chip-expand');
    await user.click(trigger);
    expect(screen.getByTestId('unknown-bucket-panel')).toBeInTheDocument();
  });

  // Regression (2026-06-05): the expanded panel must span the FULL hero width
  // and align with the hero cards — not render narrow + shoved to the side. The
  // disclosure wrapper AND the panel's mount node both carry `w-full`; without
  // the wrapper's `w-full` the flex column collapses to the chip's width and the
  // panel (despite its own `w-full`) renders constrained to that narrow column.
  it('renders the expanded panel full-width (aligned with the hero cards, not shoved aside)', async () => {
    const user = userEvent.setup();
    render(
      <CoverageChip
        coverage={{ coverageShare: 0.68, unknownShare: 0.32, prominent: true }}
        breakdown={sampleBreakdown()}
      />,
    );
    await user.click(screen.getByTestId('coverage-chip-expand'));
    const panel = screen.getByTestId('unknown-bucket-panel');
    const mountNode = panel.parentElement!; // div#panelId
    expect(mountNode.className).toContain('w-full');
    const disclosureWrapper = mountNode.parentElement!; // flex w-full flex-col items-end
    expect(disclosureWrapper.className).toContain('w-full');
  });

  // True back-compat: with NO breakdown the chip stays a static summary (no
  // disclosure trigger) regardless of prominence.
  it('stays a static summary (no disclosure) when no breakdown is given', () => {
    render(
      <CoverageChip
        coverage={{ coverageShare: 0.82, unknownShare: 0.18, prominent: false }}
      />,
    );
    expect(screen.queryByTestId('coverage-chip-expand')).toBeNull();
    expect(screen.getByTestId('coverage-chip')).toBeInTheDocument();
  });
});
