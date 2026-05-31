import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
  SheetHeader,
  SheetBody,
  SheetFooter,
} from '../Sheet';

describe('Sheet primitive', () => {
  it('opens and shows content; supports side="start" and side="end"', async () => {
    render(
      <Sheet>
        <SheetTrigger>open</SheetTrigger>
        <SheetContent side="end">
          <SheetTitle>title</SheetTitle>
          <p>body</p>
        </SheetContent>
      </Sheet>,
    );
    fireEvent.click(screen.getByText('open'));
    expect(await screen.findByText('title')).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('exposes Sheet.Header / Sheet.Body / Sheet.Footer compound exports', () => {
    // Compound namespace matches the named exports — guards against either
    // surface drifting (e.g. someone removes Sheet.Footer but leaves
    // SheetFooter, breaking new consumers using `<Sheet.Footer>` syntax).
    expect(Sheet.Header).toBe(SheetHeader);
    expect(Sheet.Body).toBe(SheetBody);
    expect(Sheet.Footer).toBe(SheetFooter);
    expect(Sheet.Content).toBe(SheetContent);
    expect(Sheet.Title).toBe(SheetTitle);
    expect(Sheet.Trigger).toBe(SheetTrigger);
  });

  it('renders Header / Body / Footer when used inside an open Sheet', async () => {
    render(
      <Sheet defaultOpen>
        <SheetContent side="end">
          <SheetTitle>t</SheetTitle>
          <Sheet.Header>head-content</Sheet.Header>
          <Sheet.Body>body-content</Sheet.Body>
          <Sheet.Footer>foot-content</Sheet.Footer>
        </SheetContent>
      </Sheet>,
    );
    expect(await screen.findByText('head-content')).toBeInTheDocument();
    expect(screen.getByText('body-content')).toBeInTheDocument();
    expect(screen.getByText('foot-content')).toBeInTheDocument();
  });

  it('P0-12 — default close X renders above sticky table headers (z-20)', async () => {
    // The Wave-2 sticky table headers render at z-5 (see TableBase). The
    // close X must be at z-20 so it remains clickable when a sticky
    // column header is positioned over it. Regression test for the
    // P0-12 bug where the X was hidden behind sticky headers.
    render(
      <Sheet defaultOpen>
        <SheetContent side="end">
          <SheetTitle>t</SheetTitle>
          <p>body</p>
        </SheetContent>
      </Sheet>,
    );
    const closeBtn = await screen.findByRole('button', { name: 'סגור' });
    expect(closeBtn.className).toMatch(/\bz-20\b/);
  });

  it('hideDefaultClose suppresses the auto-rendered X', async () => {
    render(
      <Sheet defaultOpen>
        <SheetContent side="end" hideDefaultClose>
          <SheetTitle>t</SheetTitle>
          <p>body</p>
        </SheetContent>
      </Sheet>,
    );
    await screen.findByText('body');
    expect(screen.queryByRole('button', { name: 'סגור' })).toBeNull();
  });

  it('panel applies glass+neon treatment classes (gradient, blur, shadow, edge highlight)', async () => {
    render(
      <Sheet defaultOpen>
        <SheetContent side="end" data-testid="sheet-panel">
          <SheetTitle>t</SheetTitle>
        </SheetContent>
      </Sheet>,
    );
    const panel = await screen.findByTestId('sheet-panel');
    const cls = panel.className;
    // Glass gradient (Tailwind's from/to consume our --glass-* vars).
    expect(cls).toMatch(/\bbg-gradient-to-b\b/);
    expect(cls).toMatch(/\bfrom-glass-3\b/);
    expect(cls).toMatch(/\bto-glass-2\b/);
    // Blur and shadow tokens.
    expect(cls).toMatch(/\[backdrop-filter:var\(--blur-sheet\)\]/);
    expect(cls).toMatch(/\bshadow-sheet\b/);
    // Opening-edge highlight: side="end" opens from the inline-end side,
    // so the highlight goes on the inline-start border.
    expect(cls).toMatch(/\bborder-s\b/);
    expect(cls).toMatch(/\bborder-glass-edge-hot\b/);
  });

  // -------------------------------------------------------------------------
  // Wave-4 Task 4.1 — centered modal variant.
  //
  // `variant="modal"` turns the Sheet into a centered floating card on a
  // dimmed scrim (the Campaign drawer mockup) instead of an edge drawer.
  // It must NOT carry the drawer's slide-in / edge-gradient classes, must
  // be centered + flat --glass-1, and its overlay must use the scrim token.
  // The drawer path is unchanged (covered by the tests above).
  // -------------------------------------------------------------------------
  describe('variant="modal" (Wave-4 Task 4.1)', () => {
    it('renders a centered, flat glass-1 modal card (no slide-in / edge gradient)', async () => {
      render(
        <Sheet defaultOpen>
          <SheetContent variant="modal" data-testid="modal-panel">
            <SheetTitle>t</SheetTitle>
          </SheetContent>
        </Sheet>,
      );
      const panel = await screen.findByTestId('modal-panel');
      const cls = panel.className;
      // Centered, not edge-slid.
      expect(cls).toMatch(/\bleft-1\/2\b/);
      expect(cls).toMatch(/\btop-1\/2\b/);
      expect(cls).toMatch(/-translate-x-1\/2/);
      expect(cls).toMatch(/-translate-y-1\/2/);
      // Zoom/fade entrance — NOT a slide.
      expect(cls).toMatch(/\bzoom-in-95\b/);
      expect(cls).toMatch(/\bfade-in-0\b/);
      expect(cls).not.toMatch(/slide-in-from-/);
      // Flat surface — glass-1, NOT the drawer's glass-3→glass-2 gradient.
      expect(cls).toMatch(/\bbg-glass-1\b/);
      expect(cls).not.toMatch(/\bbg-gradient-to-b\b/);
      expect(cls).not.toMatch(/\bfrom-glass-3\b/);
      // Modal radius + hairline edge + shadow.
      expect(cls).toMatch(/rounded-\[var\(--radius-hero\)\]/);
      expect(cls).toMatch(/\bborder-glass-edge\b/);
      expect(cls).toMatch(/\bshadow-sheet\b/);
      // No edge-hot highlight border on a modal (that's a drawer cue).
      expect(cls).not.toMatch(/\bborder-glass-edge-hot\b/);
      // Mobile full-screen sheet collapse.
      expect(cls).toMatch(/max-sm:inset-0/);
      expect(cls).toMatch(/max-sm:rounded-none/);
    });

    it('uses the scrim overlay (bg-scrim) for the modal variant', async () => {
      const { container } = render(
        <Sheet defaultOpen>
          <SheetContent variant="modal">
            <SheetTitle>t</SheetTitle>
          </SheetContent>
        </Sheet>,
      );
      await screen.findByText('t');
      // The Radix overlay is the fixed inset-0 element rendered before the
      // content. For the modal variant it must carry bg-scrim, NOT the
      // drawer's bg-glass-3.
      const overlay = container.ownerDocument.querySelector('[class*="fixed"][class*="inset-0"]');
      expect(overlay).not.toBeNull();
      expect(overlay!.className).toMatch(/\bbg-scrim\b/);
      expect(overlay!.className).not.toMatch(/\bbg-glass-3\b/);
    });

    it('default (no variant) stays a drawer with the glass-3→glass-2 gradient + scrim-free overlay', async () => {
      const { container } = render(
        <Sheet defaultOpen>
          <SheetContent data-testid="default-panel">
            <SheetTitle>t</SheetTitle>
          </SheetContent>
        </Sheet>,
      );
      const panel = await screen.findByTestId('default-panel');
      // defaultVariants → drawer + side="end".
      expect(panel.className).toMatch(/\bslide-in-from-end\b/);
      expect(panel.className).toMatch(/\bbg-gradient-to-b\b/);
      const overlay = container.ownerDocument.querySelector('[class*="fixed"][class*="inset-0"]');
      expect(overlay!.className).toMatch(/\bbg-glass-3\b/);
    });
  });
});
