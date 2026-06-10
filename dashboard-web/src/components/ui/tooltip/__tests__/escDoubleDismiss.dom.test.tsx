// dashboard-web/src/components/ui/tooltip/__tests__/escDoubleDismiss.dom.test.tsx
//
// 2026-06-10 audit — Esc double-dismiss (Wave 8A item 1).
//
// Pre-fix: the shared drawer stack (lib/drawerStack.ts) closed the topmost
// drawer on ANY document Escape. An Esc meant for an open HelpTooltip rich
// popover INSIDE the campaign modal therefore closed the popover (Radix,
// capture phase) AND the modal (drawer stack, bubble phase) in one keystroke
// — the WR-01 stack-collapse class reintroduced for the 2026-06-03 tooltip
// surfaces.
//
// Post-fix: the tooltip layer marks the Esc events it consumes
// (`markEscHandledByInnerLayer`), and the drawer-stack listener ignores
// marked events. One Esc = one dismissal:
//   Esc #1 → closes ONLY the popover; the sheet survives.
//   Esc #2 → closes the sheet.
//
// The harness replicates the campaign-modal pattern exactly: a Radix Sheet
// whose own Radix Esc-dismiss is suppressed (`onEscapeKeyDown
// preventDefault`) with closing delegated to `useDrawerEsc` — see
// campaign-drawer/index.tsx. Desktop pointer mode (jsdom default) routes the
// rich HelpTooltip to the RichPopover surface.

import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/Sheet';
import { HelpTooltip } from '@/components/ui/Tooltip';
import { useDrawerEsc } from '@/lib/drawerStack';

const SHEET_TITLE = 'קמפיין לדוגמה';
const POPOVER_BODY = 'גוף ההסבר המלא של המדד';

function ModalWithHelp({ onClosed }: { onClosed?: () => void }) {
  const [open, setOpen] = useState(true);
  // Same wiring as the campaign modal: drawer-stack owns Esc; Radix's own
  // Esc-dismiss is suppressed on the content below.
  useDrawerEsc(open, () => {
    setOpen(false);
    onClosed?.();
  });
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        variant="modal"
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <SheetTitle>{SHEET_TITLE}</SheetTitle>
        <SheetDescription className="sr-only">מודאל בדיקה</SheetDescription>
        <HelpTooltip variant="rich" title="הסבר מדד" content={POPOVER_BODY} withinDrawer>
          <button type="button" aria-label="הסבר על העמודה">
            i
          </button>
        </HelpTooltip>
      </SheetContent>
    </Sheet>
  );
}

/** Dispatch a document-level Escape exactly like a real keystroke: Radix's
 *  capture listener on `document` runs first, then the drawer stack's window
 *  bubble listener. */
function pressEscape() {
  fireEvent.keyDown(document.body, { key: 'Escape' });
}

describe('Esc double-dismiss (2026-06-10 audit, Wave 8A item 1)', () => {
  it('with a popover open inside the sheet: Esc #1 closes ONLY the popover, Esc #2 closes the sheet', async () => {
    render(<ModalWithHelp />);
    expect(screen.getByText(SHEET_TITLE)).toBeInTheDocument();

    // Open the rich popover from inside the modal.
    fireEvent.click(screen.getByRole('button', { name: 'הסבר על העמודה' }));
    expect(await screen.findByText(POPOVER_BODY)).toBeInTheDocument();

    // Esc #1 — the popover closes, the sheet SURVIVES.
    pressEscape();
    await waitFor(() => {
      expect(screen.queryByText(POPOVER_BODY)).toBeNull();
    });
    expect(screen.getByText(SHEET_TITLE)).toBeInTheDocument();

    // Esc #2 — now the sheet closes.
    pressEscape();
    await waitFor(() => {
      expect(screen.queryByText(SHEET_TITLE)).toBeNull();
    });
  });

  it('with NO popover open, a single Esc still closes the sheet (drawer Esc-suppression is not mistaken for tooltip consumption)', async () => {
    render(<ModalWithHelp />);
    expect(screen.getByText(SHEET_TITLE)).toBeInTheDocument();

    // The sheet's own `onEscapeKeyDown={(e) => e.preventDefault()}` runs in
    // the capture phase before the drawer stack — the event arrives
    // defaultPrevented but UNMARKED, and must still close the drawer.
    pressEscape();
    await waitFor(() => {
      expect(screen.queryByText(SHEET_TITLE)).toBeNull();
    });
  });
});
