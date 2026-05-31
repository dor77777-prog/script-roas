// dashboard-web/src/components/ui/__tests__/FreshnessBadge.test.tsx
//
// Task 3.6 — DOM contract for <FreshnessBadge>.
//
// Pins:
//   (a) fresh   → .fresh-chip.live + <.pulse> dot is rendered
//   (b) aging   → .fresh-chip.aging + NO pulse dot
//   (c) stale   → .fresh-chip.stale + NO pulse dot
//   (d) null ts → stale + label "—"
//   (e) per-platform input with one stale platform surfaces worstLabel
//   (f) data-stage attribute always equals the hook's `stage`
//
// The thresholds locked by lib/freshness/useStaleness.ts:
//   < 15 min  → fresh
//   < 30 min  → aging
//   ≥ 30 min  → stale
//
// We freeze Date.now() with vi.setSystemTime so the relative offsets
// in the timestamps below are deterministic.

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FreshnessBadge } from '../FreshnessBadge';

const NOW = new Date('2026-05-31T12:00:00Z').getTime();

function isoMinutesAgo(min: number): string {
  return new Date(NOW - min * 60_000).toISOString();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('<FreshnessBadge>', () => {
  // (a) ---------------------------------------------------------------
  it('fresh stage renders .fresh-chip.live with a pulse dot', () => {
    const { container } = render(
      <FreshnessBadge updatedAt={isoMinutesAgo(2)} />,
    );
    const chip = screen.getByTestId('freshness-badge');
    expect(chip.classList.contains('fresh-chip')).toBe(true);
    expect(chip.classList.contains('live')).toBe(true);
    expect(chip.getAttribute('data-stage')).toBe('fresh');
    // pulse dot is the only child <span> with class .pulse
    expect(container.querySelector('.fresh-chip .pulse')).not.toBeNull();
  });

  // (b) ---------------------------------------------------------------
  it('aging stage renders .fresh-chip.aging without pulse dot', () => {
    const { container } = render(
      <FreshnessBadge updatedAt={isoMinutesAgo(20)} />,
    );
    const chip = screen.getByTestId('freshness-badge');
    expect(chip.classList.contains('aging')).toBe(true);
    expect(chip.classList.contains('live')).toBe(false);
    expect(chip.getAttribute('data-stage')).toBe('aging');
    expect(container.querySelector('.fresh-chip .pulse')).toBeNull();
    // Label format pinned: "AGING · Nmin"
    expect(chip.textContent).toMatch(/AGING · 20min/);
  });

  // (c) ---------------------------------------------------------------
  it('stale stage renders .fresh-chip.stale without pulse dot', () => {
    const { container } = render(
      <FreshnessBadge updatedAt={isoMinutesAgo(47)} />,
    );
    const chip = screen.getByTestId('freshness-badge');
    expect(chip.classList.contains('stale')).toBe(true);
    expect(chip.getAttribute('data-stage')).toBe('stale');
    expect(container.querySelector('.fresh-chip .pulse')).toBeNull();
    expect(chip.textContent).toMatch(/STALE · 47min/);
  });

  // (d) ---------------------------------------------------------------
  it('null updatedAt renders stale chip with em-dash label', () => {
    render(<FreshnessBadge updatedAt={null} />);
    const chip = screen.getByTestId('freshness-badge');
    expect(chip.classList.contains('stale')).toBe(true);
    expect(chip.textContent).toContain('—');
  });

  // (e) ---------------------------------------------------------------
  it('per-platform input surfaces "TikTok stuck · 1h 47min" when one platform is stale', () => {
    render(
      <FreshnessBadge
        updatedAt={{
          meta:   isoMinutesAgo(2),
          google: isoMinutesAgo(4),
          tiktok: isoMinutesAgo(107), // 1h 47min
        }}
      />,
    );
    const chip = screen.getByTestId('freshness-badge');
    expect(chip.classList.contains('stale')).toBe(true);
    expect(chip.textContent).toMatch(/TikTok stuck · 1h 47min/);
  });

  // (f) ---------------------------------------------------------------
  it('label format for fresh < 60s uses seconds suffix', () => {
    // 20s ago → fresh, "LIVE · 20s"
    render(
      <FreshnessBadge
        updatedAt={new Date(NOW - 20_000).toISOString()}
      />,
    );
    expect(screen.getByTestId('freshness-badge').textContent).toMatch(/LIVE · 20s/);
  });

  // (g) ---------------------------------------------------------------
  it('all-fresh per-platform input renders live chip with pulse', () => {
    const { container } = render(
      <FreshnessBadge
        updatedAt={{
          meta:   isoMinutesAgo(1),
          google: isoMinutesAgo(2),
          tiktok: isoMinutesAgo(3),
        }}
      />,
    );
    const chip = screen.getByTestId('freshness-badge');
    expect(chip.classList.contains('live')).toBe(true);
    expect(container.querySelector('.fresh-chip .pulse')).not.toBeNull();
  });

  // (h) ---------------------------------------------------------------
  it('forwards user className via cn() merge', () => {
    render(
      <FreshnessBadge updatedAt={isoMinutesAgo(2)} className="ms-2" />,
    );
    expect(screen.getByTestId('freshness-badge').className).toMatch(/ms-2/);
  });
});
