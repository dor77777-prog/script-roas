// dashboard-web/src/components/ui/__tests__/TooltipTouch.dom.test.tsx
//
// Tooltip-system-redesign — Phase 1 · Task 1.2.
//
// DOM tests for the `HelpTooltip` TOUCH (coarse-pointer) branch. The desktop
// suite lives in `Tooltip.dom.test.tsx` (mocks useIsMobile → false); this file
// pins the mobile branch (useIsMobile → true) so the two ARIA trees stay
// independent and deterministic.
//
//   mode C — simple/touch  → a paired ⓘ <button aria-label> that tap-opens a
//            Radix Popover carrying the content (role="dialog"), tap-out/Esc
//            close, announced via a role="status" live region. No focusable
//            content inside.
//   mode D — long-rich/touch → the content escalates to a bottom Sheet
//            (Radix Dialog, role="dialog") with a visible ✕ close + title.
//
// Length heuristic (operator decision §6.5.2): LONG = variant==='rich' AND
// (a title is present OR content is a block/array) → Sheet. SHORT rich (a bare
// inline node, no title) stays the tap-Popover (mode C carrying the rich body).

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Pin the TOUCH (coarse-pointer) branch for the whole suite.
vi.mock('@/lib/hooks/useIsMobile', () => ({ useIsMobile: () => true }));

import { HelpTooltip } from '../Tooltip';

describe('HelpTooltip — touch modes (Task 1.2)', () => {
  it('returns the child untouched when content is null/empty (passthrough on touch too)', () => {
    const { container } = render(
      <HelpTooltip content={null}>
        <b id="c">x</b>
      </HelpTooltip>,
    );
    expect(container.querySelector('#c')).toBeInTheDocument();
    // no ⓘ affordance, no overlay for a passthrough
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('touch + simple renders an ⓘ button that tap-opens a popover with the content', async () => {
    render(
      <HelpTooltip content="עזרה">
        <span>ROAS</span>
      </HelpTooltip>,
    );
    // the child is still rendered alongside the affordance
    expect(screen.getByText('ROAS')).toBeInTheDocument();

    const info = screen.getByRole('button', { name: /הסבר|מידע|help/i });
    expect(info).toBeInTheDocument();

    fireEvent.click(info);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('עזרה');
    // never a desktop hover tooltip on touch
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('touch + simple announces the content via a role=status live region', async () => {
    render(
      <HelpTooltip content="עזרה">
        <span>ROAS</span>
      </HelpTooltip>,
    );
    const info = screen.getByRole('button', { name: /הסבר|מידע|help/i });
    fireEvent.click(info);
    await screen.findByRole('dialog');
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('עזרה');
  });

  it('touch + simple — Esc closes the toggletip popover', async () => {
    render(
      <HelpTooltip content="עזרה">
        <span>ROAS</span>
      </HelpTooltip>,
    );
    const info = screen.getByRole('button', { name: /הסבר|מידע|help/i });
    fireEvent.click(info);
    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('touch + short-rich (no title, inline node) stays a tap-open popover, not a sheet', async () => {
    render(
      <HelpTooltip variant="rich" content={<span>החזר 2 שורות</span>}>
        <span>החזרים</span>
      </HelpTooltip>,
    );
    const info = screen.getByRole('button', { name: /הסבר|מידע|help/i });
    fireEvent.click(info);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('החזר 2 שורות');
    // a short-rich popover has no visible ✕ close button (that's the sheet)
    expect(screen.queryByRole('button', { name: 'סגור' })).toBeNull();
  });

  it('touch + long rich (title present) escalates to a bottom Sheet with a visible close', async () => {
    render(
      <HelpTooltip variant="rich" title="כותרת" content={<p>גוף ארוך</p>}>
        <span>LTV</span>
      </HelpTooltip>,
    );
    // the ⓘ trigger is labelled by the title (descriptive a11y label)
    const info = screen.getByRole('button', { name: 'כותרת' });
    fireEvent.click(info);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('כותרת');
    expect(dialog).toHaveTextContent('גוף ארוך');
    // the sheet carries a visible close affordance (aria-label "סגור")
    expect(screen.getByRole('button', { name: 'סגור' })).toBeInTheDocument();
  });

  it('touch + long rich Sheet closes via the ✕ button', async () => {
    render(
      <HelpTooltip variant="rich" title="כותרת" content={<p>גוף ארוך</p>}>
        <span>LTV</span>
      </HelpTooltip>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'כותרת' }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'סגור' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
