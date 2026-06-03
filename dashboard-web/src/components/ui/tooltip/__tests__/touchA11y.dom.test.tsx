// Tooltip-system-redesign — Phase 4 (B): a11y nits the Stage-1 review flagged.
//
// What this pins:
//   1. RichSheet (mode D) gives its Radix Dialog an accessible description —
//      `aria-describedby` on the dialog resolves to the body — so Radix no
//      longer logs the "Missing `Description`" dev warning, and AT reads the
//      body as the dialog's description.
//   2. RichSheet's SheetTitle is NEVER empty — when no `title` is passed it
//      falls back to a non-empty accessible heading (a dialog must have an
//      accessible name).
//   3. Toggletip's `role="status"` live region lives OUTSIDE the open-gated
//      popover subtree, so it is present in the DOM before open and reliably
//      announces the content when the toggletip opens.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { RichSheet } from '@/components/ui/tooltip/RichSheet';
import { Toggletip } from '@/components/ui/tooltip/Toggletip';

describe('RichSheet (mode D) a11y', () => {
  // Spy on console.warn so we can hermetically assert Radix's "Missing
  // Description" dev warning is no longer emitted.
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('does NOT emit the Radix "Missing Description" warning', () => {
    render(
      <RichSheet content={<p>גוף ההסבר הארוך</p>} title="כותרת">
        <span>נושא</span>
      </RichSheet>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'כותרת' }));
    screen.getByRole('dialog');
    const missingDesc = warnSpy.mock.calls.some((args) =>
      String(args[0] ?? '').includes('Missing `Description`'),
    );
    expect(missingDesc).toBe(false);
  });

  it('opened dialog carries an aria-describedby that resolves to a non-empty description', () => {
    render(
      <RichSheet content={<p>גוף ההסבר הארוך</p>} title="כותרת">
        <span>נושא</span>
      </RichSheet>,
    );
    // Open the sheet via the ⓘ button.
    fireEvent.click(screen.getByRole('button', { name: 'כותרת' }));

    const dialog = screen.getByRole('dialog');
    const describedById = dialog.getAttribute('aria-describedby');
    expect(describedById).toBeTruthy();
    // The referenced description node exists and is non-empty (Radix wires it
    // to the SheetDescription — silences the "Missing Description" warning).
    const desc = document.getElementById(describedById as string);
    expect(desc).not.toBeNull();
    expect(desc?.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    // The visible body still carries the full help text.
    expect(dialog).toHaveTextContent('גוף ההסבר הארוך');
  });

  it('renders a non-empty accessible heading even when no title is given', () => {
    render(
      <RichSheet content={<p>גוף בלי כותרת</p>}>
        <span>נושא</span>
      </RichSheet>,
    );
    // No title prop → the ⓘ button still has a non-empty label …
    const info = screen.getByRole('button', { name: 'מידע נוסף' });
    fireEvent.click(info);

    const dialog = screen.getByRole('dialog');
    // … and the dialog has a non-empty accessible name (a heading), so it is
    // never an unnamed dialog.
    const labelledById = dialog.getAttribute('aria-labelledby');
    expect(labelledById).toBeTruthy();
    const heading = document.getElementById(labelledById as string);
    expect(heading).not.toBeNull();
    expect(heading?.textContent?.trim().length ?? 0).toBeGreaterThan(0);
  });
});

describe('Toggletip (mode C) live region', () => {
  it('mounts the role=status live region before open (outside the open-gated popover)', () => {
    render(
      <Toggletip content="עזרה על המדד">
        <span>ROAS</span>
      </Toggletip>,
    );
    // The popover content (role=dialog) is NOT mounted while closed …
    expect(screen.queryByRole('dialog')).toBeNull();
    // … but the live region IS present in the DOM, so the announcement is
    // reliable on open (a live region added at the same tick it fills can be
    // missed by some screen readers).
    const status = screen.getByRole('status');
    expect(status).toBeInTheDocument();
    expect(status).toHaveTextContent(''); // empty until opened
  });

  it('fills the live region with the content when opened', () => {
    render(
      <Toggletip content="עזרה על המדד">
        <span>ROAS</span>
      </Toggletip>,
    );
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'הסבר' }));
    });
    expect(screen.getByRole('status')).toHaveTextContent('עזרה על המדד');
  });
});
