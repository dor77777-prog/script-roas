import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from '../Sidebar';
import { ThemeProvider } from '../ThemeProvider';

function renderSidebar(props: {
  activeTab?: 'home'|'archive'|'pnl'|'trends'|'campaigns'|'products'|'detail';
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
  it('renders all 7 tab destinations + operator link + theme toggle', () => {
    renderSidebar();
    const expectedLabels = ['בית', 'טבלאות אופטימיזציה', 'P&L', 'מגמות', 'קמפיינים', 'מוצרים', 'פירוט'];
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

  it('marks the active item with aria-current="page"', () => {
    renderSidebar({ activeTab: 'pnl' });
    // Both rails mark the active item; assert at least one does.
    const activeButtons = screen
      .getAllByText('P&L')
      .map((el) => el.closest('button'))
      .filter((b): b is HTMLButtonElement => b !== null && b.getAttribute('aria-current') === 'page');
    expect(activeButtons.length).toBeGreaterThan(0);
  });
});
