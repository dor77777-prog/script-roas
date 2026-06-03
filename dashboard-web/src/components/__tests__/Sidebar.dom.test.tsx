import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from '../Sidebar';
import { ThemeProvider } from '../ThemeProvider';

function renderSidebar(props: {
  activeTab?: 'home'|'activity'|'customers'|'archive'|'pnl'|'trends'|'campaigns'|'products'|'detail';
  onTabChange?: (k: string) => void;
  isMobileOpen?: boolean;
  onMobileClose?: () => void;
} = {}) {
  return render(
    <ThemeProvider>
      <Sidebar
        activeTab={props.activeTab ?? 'home'}
        onTabChange={props.onTabChange ?? (() => {})}
        isMobileOpen={props.isMobileOpen ?? false}
        onMobileClose={props.onMobileClose ?? (() => {})}
      />
    </ThemeProvider>,
  );
}

describe('Sidebar', () => {
  it('renders all 9 tab destinations + operator link + theme toggle', () => {
    renderSidebar();
    // 'פעילות' (Activity) sits RIGHT AFTER 'בית' (Home) — first after Home.
    // Wave 2: 'לקוחות' (Customer Value) lands at slot 3 (after פעילות).
    const expectedLabels = ['בית', 'פעילות', 'לקוחות', 'טבלאות אופטימיזציה', 'P&L', 'מגמות', 'קמפיינים', 'מוצרים', 'פירוט'];
    for (const label of expectedLabels) {
      // The Sidebar now renders two copies of the nav body (desktop right-
      // rail + mobile off-canvas drawer) — both are always in the DOM, the
      // mobile one hidden via `md:hidden` + `translate-x-full`. So each
      // label appears twice; `getAllByText` keeps this test resilient to
      // that without asserting on which rail rendered them.
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    // Operator link likewise appears twice — at least one is enough.
    const operatorLinks = screen.getAllByRole('link', { name: /ניהול/ });
    expect(operatorLinks.length).toBeGreaterThan(0);
    expect(operatorLinks[0]).toHaveAttribute('href', '/operator');
  });

  it('fires onTabChange with the correct key when an item is clicked', () => {
    const onTabChange = vi.fn();
    renderSidebar({ onTabChange });
    // Click the first copy (desktop rail) — both copies wire the same handler.
    fireEvent.click(screen.getAllByText('קמפיינים')[0]);
    expect(onTabChange).toHaveBeenCalledWith('campaigns');
  });

  it('fires onTabChange("activity") when the פעילות item is clicked', () => {
    const onTabChange = vi.fn();
    renderSidebar({ onTabChange });
    fireEvent.click(screen.getAllByText('פעילות')[0]);
    expect(onTabChange).toHaveBeenCalledWith('activity');
  });

  it('fires onTabChange("customers") when the לקוחות item is clicked', () => {
    const onTabChange = vi.fn();
    renderSidebar({ onTabChange });
    fireEvent.click(screen.getAllByText('לקוחות')[0]);
    expect(onTabChange).toHaveBeenCalledWith('customers');
  });

  it('orders לקוחות immediately after פעילות in the desktop rail (slot 3)', () => {
    const { container } = renderSidebar();
    const rail = container.querySelector('[data-testid="desktop-sidebar"]')!;
    const labels = Array.from(rail.querySelectorAll('nav [role="tab"]')).map(
      (b) => b.getAttribute('aria-label')?.trim() ?? b.textContent?.trim(),
    );
    const activityIdx = labels.findIndex((l) => l === 'פעילות');
    const customersIdx = labels.findIndex((l) => l === 'לקוחות');
    expect(activityIdx).toBeGreaterThanOrEqual(0);
    expect(customersIdx).toBe(activityIdx + 1);
  });

  it('orders פעילות immediately after בית in the desktop rail', () => {
    const { container } = renderSidebar();
    const rail = container.querySelector('[data-testid="desktop-sidebar"]')!;
    // The desktop rail renders collapsed (icon-only) by default, so the label
    // text lives on each tab button's aria-label (not visible text). Read the
    // tab order from those.
    const labels = Array.from(rail.querySelectorAll('nav [role="tab"]')).map(
      (b) => b.getAttribute('aria-label')?.trim() ?? b.textContent?.trim(),
    );
    const homeIdx = labels.findIndex((l) => l === 'בית');
    const activityIdx = labels.findIndex((l) => l === 'פעילות');
    expect(homeIdx).toBeGreaterThanOrEqual(0);
    expect(activityIdx).toBe(homeIdx + 1);
  });

  it('marks the active item with aria-current="page"', () => {
    renderSidebar({ activeTab: 'pnl' });
    // Both rails mark the active item; assert at least one does.
    const activeButtons = screen
      .getAllByText('P&L')
      .map((el) => el.closest('button'))
      .filter((b): b is HTMLButtonElement => b !== null && b.getAttribute('aria-current') === 'page');
    expect(activeButtons.length).toBeGreaterThan(0);
  });

  /**
   * Regression (2026-06-01): in LIGHT mode, hovering the SELECTED desktop tab
   * flipped its background to the near-white --glass-2 (the ghost Button
   * variant's built-in `hover:bg-glass-2`), swallowing the white active text
   * (--sidebar-fg-active). The active item must declare its OWN accent-based
   * hover:bg so tailwind-merge drops the ghost's glass-2 hover.
   */
  it('active desktop tab keeps an accent hover fill, never the glass-2 ghost hover (light-mode contrast)', () => {
    const { container } = renderSidebar({ activeTab: 'pnl' });
    const rail = container.querySelector('[data-testid="desktop-sidebar"]')!;
    const active = rail.querySelector('nav [role="tab"][aria-current="page"]') as HTMLElement;
    expect(active).not.toBeNull();
    const cls = active.className;
    // tailwind-merge must have kept the accent-based hover background...
    expect(cls).toContain('hover:bg-[color-mix(in_oklab,var(--accent)_30%,transparent)]');
    // ...and dropped the ghost variant's near-white glass-2 hover fill.
    expect(cls).not.toContain('hover:bg-glass-2');
    // White active text is preserved on hover (belt-and-suspenders).
    expect(cls).toContain('hover:text-[var(--sidebar-fg-active)]');
  });
});
