// dashboard-web/src/components/ui/__tests__/tooltipFocusableGuard.dom.test.tsx
//
// Tooltip-system-redesign — Phase 0 · Task 0.2.
//
// Hermetic a11y guard: rich (focusable) tooltip content must NEVER live
// inside an element with `role="tooltip"`. The ARIA `tooltip` role describes
// a non-interactive overlay — a focusable child (link/button/input/[tabindex])
// is unreachable by keyboard there and trips axe `aria-required-children` /
// the WAI tooltip pattern. Rich content must instead render inside a
// `role="dialog"` (Popover/Sheet) which owns focus management.
//
// THIS TEST IS INTENTIONALLY RED against the current primitive: today
// `HelpTooltip` always renders its `content` (rich JSX included) inside the
// Radix Tooltip `role="tooltip"` surface, so a focusable child leaks in.
// It becomes GREEN after Task 1.1 routes rich content to a Popover dialog.
// Per the plan it is the Phase-1 acceptance gate and MUST NOT be skipped.
//
// The desktop (fine-pointer) branch is pinned via the useIsMobile mock so the
// guard is deterministic and forward-compatible with the four-mode split.

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Pin the desktop branch — the touch branch routes through an ⓘ toggletip /
// bottom-sheet (added in Task 1.2) which never uses role=tooltip anyway. The
// hard case to guard is the desktop primitive, where the simple path is a
// genuine Radix Tooltip and rich content must escape that surface.
vi.mock('@/lib/hooks/useIsMobile', () => ({ useIsMobile: () => false }));

import { HelpTooltip } from '../Tooltip';

const FOCUSABLE_SELECTOR = 'a,button,input,select,textarea,[tabindex]';

describe('tooltip focusable guard (a11y)', () => {
  it('rich content with a focusable element never renders inside role=tooltip', async () => {
    render(
      <HelpTooltip
        content={
          <div>
            <a href="#x">קישור</a>
            <input aria-label="שדה" />
          </div>
        }
      >
        <button type="button">פתח</button>
      </HelpTooltip>,
    );

    // Open the overlay the way a keyboard user would — focus the trigger.
    fireEvent.focus(screen.getByRole('button', { name: 'פתח' }));

    // Give Radix a tick to portal the open surface. Either a tooltip or a
    // dialog should appear; we don't care which here — we only assert that
    // whatever role=tooltip surfaces exist, none of them contain a focusable
    // element. (After Task 1.1 the rich surface is a dialog, so there is no
    // offending role=tooltip subtree at all.)
    await new Promise((r) => setTimeout(r, 50));

    const tips = document.querySelectorAll('[role="tooltip"]');
    tips.forEach((tip) => {
      expect(tip.querySelector(FOCUSABLE_SELECTOR)).toBeNull();
    });
  });
});
