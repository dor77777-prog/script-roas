// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { CoverageChip } from '@/components/home/CoverageChip';

afterEach(() => cleanup());

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
});
