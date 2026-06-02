// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
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

  it('carries a tooltip naming legit unknown causes', () => {
    const { getByTestId } = render(
      <CoverageChip coverage={{ coverageShare: 0.55, unknownShare: 0.45, prominent: true }} />,
    );
    expect(getByTestId('coverage-chip').getAttribute('title') ?? '').toMatch(/express|headless|untagged|privacy|תשלום מהיר|לא מתויג/i);
  });
});
