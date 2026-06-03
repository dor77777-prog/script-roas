// dashboard-web/src/components/ui/__tests__/Tooltip.dom.test.tsx
//
// Tooltip-system-redesign — Phase 1 · Task 1.1.
//
// DOM tests for the `HelpTooltip` mode-selection contract on the DESKTOP
// (fine-pointer) branch: the null-passthrough is preserved; simple (string)
// content opens a Radix Tooltip (`role="tooltip"`) on focus; rich content
// (`variant="rich"` / non-string ReactNode / a `title`) opens a Radix Popover
// (`role="dialog"`) and NEVER a tooltip; Esc closes the open surface.
//
// The desktop branch is pinned via the useIsMobile mock so these assertions are
// deterministic. The touch (coarse-pointer) modes — ⓘ toggletip + bottom-sheet
// — arrive in Task 1.2 with their own coverage.

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Pin the desktop (fine-pointer) branch for the whole suite.
vi.mock('@/lib/hooks/useIsMobile', () => ({ useIsMobile: () => false }));

import { HelpTooltip } from '../Tooltip';

describe('HelpTooltip — desktop simple/rich split (Task 1.1)', () => {
  it('returns the child untouched when content is null/empty', () => {
    const { container, rerender } = render(
      <HelpTooltip content={null}>
        <b id="c">x</b>
      </HelpTooltip>,
    );
    expect(container.querySelector('#c')).toBeInTheDocument();
    // no overlay roles for a passthrough
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();

    rerender(
      <HelpTooltip content="">
        <b id="c">x</b>
      </HelpTooltip>,
    );
    expect(container.querySelector('#c')).toBeInTheDocument();
  });

  it('string content on desktop opens a role=tooltip on focus', async () => {
    render(
      <HelpTooltip content="עזרה" delayDuration={0}>
        <button type="button">t</button>
      </HelpTooltip>,
    );
    fireEvent.focus(screen.getByRole('button', { name: 't' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('עזרה');
    // never a dialog for simple content
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('rich content (variant=rich + title) on desktop opens a role=dialog (Popover), not a tooltip', async () => {
    render(
      <HelpTooltip variant="rich" title="כותרת" content={<p>גוף</p>}>
        <button type="button">t</button>
      </HelpTooltip>,
    );
    fireEvent.click(screen.getByRole('button', { name: 't' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('כותרת');
    expect(dialog).toHaveTextContent('גוף');
    // rich must NEVER be a tooltip
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('non-string ReactNode content auto-promotes to a role=dialog (Popover)', async () => {
    render(
      <HelpTooltip content={<span>תוכן עשיר</span>}>
        <button type="button">t</button>
      </HelpTooltip>,
    );
    fireEvent.click(screen.getByRole('button', { name: 't' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('תוכן עשיר');
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('variant=text pins a non-string content to a tooltip (no surprise popover)', async () => {
    render(
      <HelpTooltip variant="text" content={<span>טקסט פשוט</span>} delayDuration={0}>
        <button type="button">t</button>
      </HelpTooltip>,
    );
    fireEvent.focus(screen.getByRole('button', { name: 't' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('טקסט פשוט');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Esc closes the rich Popover', async () => {
    render(
      <HelpTooltip variant="rich" title="כותרת" content={<p>גוף</p>}>
        <button type="button">t</button>
      </HelpTooltip>,
    );
    fireEvent.click(screen.getByRole('button', { name: 't' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Esc closes the simple Tooltip', async () => {
    render(
      <HelpTooltip content="עזרה" delayDuration={0}>
        <button type="button">t</button>
      </HelpTooltip>,
    );
    fireEvent.focus(screen.getByRole('button', { name: 't' }));
    const tip = await screen.findByRole('tooltip');
    expect(tip).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('button', { name: 't' }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  });
});
