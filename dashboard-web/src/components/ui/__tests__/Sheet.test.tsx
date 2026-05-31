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
});
