import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Sidebar } from '@/components/Sidebar';
import { ThemeProvider } from '@/components/ThemeProvider';
import { TooltipProvider } from '@/components/ui/Tooltip';

function renderSidebar() {
  return render(
    <ThemeProvider>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        <Sidebar
          activeTab="home"
          onTabChange={() => {}}
          isMobileOpen={false}
          onMobileClose={() => {}}
        />
      </TooltipProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  // Each test starts with a clean localStorage so a leaked
  // sidebar:pinned=true from a previous test cannot make a "default
  // collapsed" assertion silently pass against a pre-pinned sidebar.
  window.localStorage.clear();
});

describe('Sidebar — hover state must differ from active state', () => {
  it('inactive nav item hover classes do NOT include bg-glass-2', () => {
    renderSidebar();
    // Both rails render — grab the first P&L button (desktop rail).
    const inactive = screen.getAllByRole('tab', { name: /P&L/ })[0];
    const cls = inactive.className;
    // Inactive default state must NOT use bg-glass-2 (the active bg).
    // Hover may use bg-glass-1 (one step lighter) but never bg-glass-2.
    expect(cls).not.toMatch(/\bhover:bg-glass-2\b/);
  });

  it('active nav item carries the brand-500 vertical indicator (visually distinct from hover)', async () => {
    // reskin-w2 Horizon recipe: the active item is signalled by a brand-500
    // vertical indicator bar beside it (mockup `.sb-ind`) + the accent wash +
    // bold text — replacing the old 1px ring. The indicator only renders on the
    // EXPANDED rail (not the collapsed icon-rail), so pre-pin before render.
    window.localStorage.setItem('sidebar:pinned', 'true');
    renderSidebar();
    const desktop = screen.getByTestId('desktop-sidebar');
    await waitFor(() => {
      expect(desktop.getAttribute('data-expanded')).toBe('true');
    });
    const active = within(desktop).getByRole('tab', { name: 'בית' });
    const indicator = active.querySelector('[data-testid="sidebar-active-indicator"]');
    expect(indicator).not.toBeNull();
    // Token-driven (brand accent var), not a raw colour.
    expect(indicator!.className).toContain('bg-[var(--accent)]');
    // Must be pinned to the rail's inline-start edge. Guard the exact bug from
    // the W2 quality review: `inline-start-0` is NOT a Tailwind utility (emits
    // no CSS → indicator falls back to its static inline position). The correct
    // logical-inset utility is `start-0` (→ inset-inline-start:0, RTL-correct).
    expect(indicator!.className).toContain('absolute');
    expect(indicator!.className).toContain('start-0');
    expect(indicator!.className).not.toContain('inline-start-0');
  });
});

// ---------------------------------------------------------------------------
// Task 5.8 — slim 72px rail + hover-to-expand + pin + ⌘\ shortcut.
// ---------------------------------------------------------------------------

describe('Sidebar — Task 5.8 collapsed rail + hover-to-expand', () => {
  it('Step 1: default-renders collapsed at 72px (no sidebar:pinned in localStorage)', () => {
    renderSidebar();
    const desktop = screen.getByTestId('desktop-sidebar');
    expect(desktop.getAttribute('data-expanded')).toBe('false');
    expect(desktop.getAttribute('data-pinned')).toBe('false');
    // Inline width style is the source of truth — class transitions only
    // describe HOW the width changes, not the resting value.
    expect(desktop.style.width).toBe('72px');
  });

  it('Step 1: pre-existing sidebar:pinned=true hydrates into 220px pinned-expanded state', async () => {
    window.localStorage.setItem('sidebar:pinned', 'true');
    renderSidebar();
    const desktop = screen.getByTestId('desktop-sidebar');
    // The useSidebarPin hook hydrates inside useEffect — wait one tick so
    // React commits the post-hydration state. Asserting synchronously
    // would see the SSR-safe collapsed default and incorrectly pass.
    await waitFor(() => {
      expect(desktop.getAttribute('data-pinned')).toBe('true');
      expect(desktop.getAttribute('data-expanded')).toBe('true');
      expect(desktop.style.width).toBe('220px');
    });
  });

  it('Step 2: hover for 200ms temporarily expands; mouseleave collapses back', () => {
    vi.useFakeTimers();
    try {
      renderSidebar();
      const desktop = screen.getByTestId('desktop-sidebar');

      // mouseenter starts the 200ms timer — width must still be collapsed
      // immediately after the enter event.
      act(() => {
        fireEvent.mouseEnter(desktop);
      });
      expect(desktop.style.width).toBe('72px');

      // Advance just under the threshold — still collapsed.
      act(() => {
        vi.advanceTimersByTime(199);
      });
      expect(desktop.style.width).toBe('72px');

      // Cross the 200ms boundary — must expand.
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(desktop.style.width).toBe('220px');

      // mouseleave collapses back immediately (pinned=false).
      act(() => {
        fireEvent.mouseLeave(desktop);
      });
      expect(desktop.style.width).toBe('72px');
      expect(desktop.getAttribute('data-pinned')).toBe('false');
    } finally {
      vi.useRealTimers();
    }
  });

  it('Step 2: mouseleave before 200ms cancels the pending expand', () => {
    vi.useFakeTimers();
    try {
      renderSidebar();
      const desktop = screen.getByTestId('desktop-sidebar');

      act(() => {
        fireEvent.mouseEnter(desktop);
        vi.advanceTimersByTime(100);
        fireEvent.mouseLeave(desktop);
        // Push past 200ms — if the timer wasn't cancelled, this would
        // still flip hoverExpanded to true.
        vi.advanceTimersByTime(500);
      });
      expect(desktop.style.width).toBe('72px');
    } finally {
      vi.useRealTimers();
    }
  });

  it('Step 3: clicking pin toggles persist sidebar:pinned in localStorage', () => {
    renderSidebar();
    const desktop = screen.getByTestId('desktop-sidebar');

    expect(window.localStorage.getItem('sidebar:pinned')).toBeNull();
    // Re-query the pin button after each render — the surrounding rail
    // re-mounts its layout (collapsed → expanded) when pinned flips, so
    // a captured reference would point to a detached DOM node.
    expect(
      within(desktop).getByTestId('sidebar-pin-toggle').getAttribute('aria-pressed'),
    ).toBe('false');

    act(() => {
      fireEvent.click(within(desktop).getByTestId('sidebar-pin-toggle'));
    });
    expect(window.localStorage.getItem('sidebar:pinned')).toBe('true');
    expect(
      within(desktop).getByTestId('sidebar-pin-toggle').getAttribute('aria-pressed'),
    ).toBe('true');
    expect(desktop.style.width).toBe('220px');

    act(() => {
      fireEvent.click(within(desktop).getByTestId('sidebar-pin-toggle'));
    });
    expect(window.localStorage.getItem('sidebar:pinned')).toBe('false');
    expect(
      within(desktop).getByTestId('sidebar-pin-toggle').getAttribute('aria-pressed'),
    ).toBe('false');
    expect(desktop.style.width).toBe('72px');
  });

  it('Step 4: ⌘\\ keyboard shortcut toggles pinned state', () => {
    renderSidebar();
    const desktop = screen.getByTestId('desktop-sidebar');
    expect(desktop.getAttribute('data-pinned')).toBe('false');

    act(() => {
      fireEvent.keyDown(document, { key: '\\', metaKey: true });
    });
    expect(desktop.getAttribute('data-pinned')).toBe('true');
    expect(window.localStorage.getItem('sidebar:pinned')).toBe('true');

    // Second press unpins.
    act(() => {
      fireEvent.keyDown(document, { key: '\\', metaKey: true });
    });
    expect(desktop.getAttribute('data-pinned')).toBe('false');
    expect(window.localStorage.getItem('sidebar:pinned')).toBe('false');

    // Ctrl+\ (Windows/Linux) works equivalently.
    act(() => {
      fireEvent.keyDown(document, { key: '\\', ctrlKey: true });
    });
    expect(desktop.getAttribute('data-pinned')).toBe('true');
  });

  it('Step 4: ⌘\\ is ignored when focus is inside an editable element', () => {
    renderSidebar();
    const desktop = screen.getByTestId('desktop-sidebar');

    // Append a real input to the document and fire the event with that
    // input as the keydown target — mirrors how CommandPalette guards its
    // ⌘K binding from typed text.
    const input = document.createElement('input');
    document.body.appendChild(input);
    try {
      act(() => {
        fireEvent.keyDown(input, { key: '\\', metaKey: true });
      });
      expect(desktop.getAttribute('data-pinned')).toBe('false');
    } finally {
      document.body.removeChild(input);
    }
  });

  it('Step 5: collapsed rail nav items expose label + shortcut via aria-label / tooltip content', () => {
    renderSidebar();
    const desktop = screen.getByTestId('desktop-sidebar');

    // Collapsed state hides the inline label, so the only accessible
    // text for the icon is via aria-label. The tooltip itself is portal-
    // rendered and only appears on actual hover, which jsdom doesn't
    // simulate cleanly; aria-label is the visible-to-AT contract for
    // collapsed icons, so we pin that.
    const home = within(desktop).getByRole('tab', { name: 'בית' });
    expect(home.getAttribute('aria-label')).toBe('בית');

    const pnl = within(desktop).getByRole('tab', { name: 'P&L' });
    expect(pnl.getAttribute('aria-label')).toBe('P&L');

    // The pin button itself surfaces ⌘\ in its tooltip; its own
    // aria-label flips between "pin open" / "unpin".
    const pinBtn = within(desktop).getByTestId('sidebar-pin-toggle');
    expect(pinBtn.getAttribute('aria-label')).toBe('הצמד פתוח');
  });

  it('Step 5: expanded sidebar removes the per-icon aria-label (the inline text takes over)', () => {
    window.localStorage.setItem('sidebar:pinned', 'true');
    renderSidebar();
    const desktop = screen.getByTestId('desktop-sidebar');
    // After hydration the rail is expanded — labels render inline and
    // the redundant aria-label is dropped so screen readers don't double-
    // announce "Home Home".
    return waitFor(() => {
      expect(desktop.getAttribute('data-expanded')).toBe('true');
      const home = within(desktop).getByRole('tab', { name: 'בית' });
      expect(home.getAttribute('aria-label')).toBeNull();
    });
  });

  it('width transition uses 200ms ease-out per mockup CSS', () => {
    renderSidebar();
    const desktop = screen.getByTestId('desktop-sidebar');
    // Tailwind: transition-[width] duration-200 ease-out. The class
    // string is the source of truth — testing the resolved CSS would
    // require a real stylesheet which jsdom does not parse.
    expect(desktop.className).toMatch(/transition-\[width\]/);
    expect(desktop.className).toMatch(/duration-200/);
    expect(desktop.className).toMatch(/ease-out/);
  });
});

afterEach(() => {
  // Belt-and-braces — the global afterEach in setup-dom.ts only handles
  // RTL cleanup; localStorage state would otherwise leak between files.
  window.localStorage.clear();
});
