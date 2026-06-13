// dashboard-web/src/components/home/__tests__/MobileStickyRoas.dom.test.tsx
//
// Feature B3 (2026-06-01) — MOBILE-ONLY collapsing sticky ROAS summary.
//
// Pins:
//   • Renders the big ROAS number (tabular bdi), the 'יעד X.X' caption, and a
//     delta chip vs the previous period (green up / red down).
//   • deltaRoas === null → NO chip (no NaN, no $0 surprise).
//   • Toggling collapsed (driven by the sentinel IntersectionObserver) applies
//     a collapsed data-attribute and the size/opacity classes.
//   • Under reduced motion the transition classes are NOT applied (the state is
//     set instantly).
//   • md:hidden so desktop never sees it.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { MobileStickyRoas } from '@/components/home/MobileStickyRoas';

// ── IntersectionObserver mock ──────────────────────────────────────────────
// jsdom has no IntersectionObserver. Capture the callback so a test can drive
// the sentinel in/out of view and assert the collapse toggles.
type IOCallback = (entries: Array<{ isIntersecting: boolean }>) => void;
let ioCallbacks: IOCallback[] = [];

class MockIO {
  cb: IOCallback;
  constructor(cb: IOCallback) {
    this.cb = cb;
    ioCallbacks.push(cb);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

function fireSentinel(isIntersecting: boolean) {
  act(() => {
    for (const cb of ioCallbacks) cb([{ isIntersecting }]);
  });
}

// matchMedia override helper — the global setup reports reduced-motion=true.
function setReducedMotion(reduced: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query.includes('prefers-reduced-motion') ? reduced : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

beforeEach(() => {
  ioCallbacks = [];
  (globalThis as unknown as { IntersectionObserver: typeof MockIO }).IntersectionObserver =
    MockIO;
});
afterEach(() => {
  setReducedMotion(true); // restore the global default
});

describe('B3 — <MobileStickyRoas>', () => {
  it('renders the ROAS number, the target caption, and a delta chip', () => {
    const { getByTestId } = render(
      <MobileStickyRoas roas={2.87} target={3.0} deltaRoas={0.39} rangeLabel="30 ימים אחרונים" />,
    );
    expect(getByTestId('mobile-sticky-roas')).toBeTruthy();
    expect(getByTestId('mobile-sticky-roas-value').textContent).toContain('2.87');
    // Target caption.
    expect(getByTestId('mobile-sticky-roas-target').textContent).toContain('3.0');
    // Delta chip present + positive (up) — ROAS-POINTS format matching the hero
    // ROAS card's fmtRoasDelta (▴ +0.39), NOT a percent.
    const chip = getByTestId('mobile-sticky-roas-delta');
    expect(chip).toBeTruthy();
    expect(chip.textContent).toContain('0.39');
    expect(chip.textContent).not.toContain('%');
  });

  it('renders NO delta chip when deltaRoas is null', () => {
    const { queryByTestId } = render(
      <MobileStickyRoas roas={2.87} target={3.0} deltaRoas={null} />,
    );
    expect(queryByTestId('mobile-sticky-roas-delta')).toBeNull();
  });

  it('renders the ROAS as "—" when roas is null (no NaN)', () => {
    const { getByTestId } = render(
      <MobileStickyRoas roas={null} target={3.0} deltaRoas={null} />,
    );
    expect(getByTestId('mobile-sticky-roas-value').textContent).toContain('—');
  });

  it('toggles the collapsed data-attribute when the sentinel scrolls out of view', () => {
    const { getByTestId } = render(
      <MobileStickyRoas roas={2.87} target={3.0} deltaRoas={1.2} />,
    );
    const bar = getByTestId('mobile-sticky-roas');
    // Sentinel visible → not collapsed.
    fireSentinel(true);
    expect(bar.getAttribute('data-collapsed')).toBe('false');
    // Sentinel scrolled out → collapsed.
    fireSentinel(false);
    expect(bar.getAttribute('data-collapsed')).toBe('true');
    // Back into view → expanded again.
    fireSentinel(true);
    expect(bar.getAttribute('data-collapsed')).toBe('false');
  });

  it('is mobile-only (md:hidden)', () => {
    const { getByTestId } = render(
      <MobileStickyRoas roas={2.87} target={3.0} deltaRoas={null} />,
    );
    expect(getByTestId('mobile-sticky-roas').className).toContain('md:hidden');
  });

  it('pins at top-0 (the TopStrip is non-sticky — no header offset above)', () => {
    // reskin-w2c: the app header became a NON-sticky floating navbar, so this
    // bar pins at the very top instead of being offset by the old slim sticky
    // header's height (was top-[3.25rem]).
    const { getByTestId } = render(
      <MobileStickyRoas roas={2.87} target={3.0} deltaRoas={null} />,
    );
    const cls = getByTestId('mobile-sticky-roas').className;
    expect(cls).toContain('top-0');
    expect(cls).not.toContain('top-[3.25rem]');
  });

  it('applies size/opacity TRANSITION classes when motion is allowed', () => {
    setReducedMotion(false);
    const { getByTestId } = render(
      <MobileStickyRoas roas={2.87} target={3.0} deltaRoas={1.2} />,
    );
    const value = getByTestId('mobile-sticky-roas-value');
    const target = getByTestId('mobile-sticky-roas-target');
    // The motion-aware build applies a transition utility on the value + caption.
    expect(value.className).toContain('transition');
    expect(target.className).toContain('transition');
  });

  it('does NOT apply transition classes under reduced motion', () => {
    setReducedMotion(true);
    const { getByTestId } = render(
      <MobileStickyRoas roas={2.87} target={3.0} deltaRoas={1.2} />,
    );
    const value = getByTestId('mobile-sticky-roas-value');
    const target = getByTestId('mobile-sticky-roas-target');
    expect(value.className).not.toContain('transition');
    expect(target.className).not.toContain('transition');
  });
});
