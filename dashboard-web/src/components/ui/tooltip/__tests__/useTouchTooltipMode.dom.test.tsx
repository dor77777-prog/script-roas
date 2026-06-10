// dashboard-web/src/components/ui/tooltip/__tests__/useTouchTooltipMode.dom.test.tsx
//
// 2026-06-10 audit — tooltip mode by POINTER, not width (Wave 8A item 4).
//
// Pre-fix: HelpTooltip selected its touch/desktop branch with the
// viewport-width hook (useIsMobile, max-width:767px). A coarse-pointer
// TABLET ≥768px therefore got hover-only desktop tooltips it can never open.
//
// Post-fix: the gate is `matchMedia('(hover: none), (pointer: coarse)')` per
// the documented §4.1 pointer matrix; the 767px width check survives ONLY as
// a fallback when matchMedia is unavailable.
//
// matchMedia is mocked per-test (NOT the hook) so these tests pin the real
// gating logic end-to-end through HelpTooltip's rendered output:
//   touch branch  → a paired ⓘ toggletip button
//   desktop branch → no ⓘ (hover tooltip via Radix)

import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { HelpTooltip } from '@/components/ui/Tooltip';
import { TOUCH_TOOLTIP_QUERY } from '@/components/ui/tooltip/useTouchTooltipMode';

const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');
const originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');

function stubMatchMedia(matchesFor: (query: string) => boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: matchesFor(query),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  });
}

function removeMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: undefined,
  });
}

function setInnerWidth(px: number) {
  Object.defineProperty(window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: px,
  });
}

afterEach(() => {
  cleanup();
  if (originalMatchMedia) Object.defineProperty(window, 'matchMedia', originalMatchMedia);
  if (originalInnerWidth) Object.defineProperty(window, 'innerWidth', originalInnerWidth);
});

function renderHelp() {
  return render(
    <HelpTooltip content="עזרה">
      <span>ROAS</span>
    </HelpTooltip>,
  );
}

describe('HelpTooltip mode gate — pointer capability, not viewport width (item 4)', () => {
  it('coarse-pointer device on a WIDE viewport (tablet ≥768px) gets the tap ⓘ touch branch', () => {
    setInnerWidth(1024); // wide — the old width gate would have chosen desktop
    stubMatchMedia((q) => q === TOUCH_TOOLTIP_QUERY);
    renderHelp();
    expect(screen.getByRole('button', { name: 'הסבר' })).toBeInTheDocument();
  });

  it('fine-pointer hover-capable device gets the desktop branch (no ⓘ)', () => {
    setInnerWidth(1024);
    stubMatchMedia(() => false);
    renderHelp();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('ROAS')).toBeInTheDocument();
  });

  it('falls back to the width check ONLY when matchMedia is unavailable — narrow → touch', () => {
    removeMatchMedia();
    setInnerWidth(500);
    renderHelp();
    expect(screen.getByRole('button', { name: 'הסבר' })).toBeInTheDocument();
  });

  it('falls back to the width check ONLY when matchMedia is unavailable — wide → desktop', () => {
    removeMatchMedia();
    setInnerWidth(1280);
    renderHelp();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
