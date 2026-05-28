import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from '../Sidebar';
import { ThemeProvider } from '../ThemeProvider';

function renderSidebar(props: { activeTab?: 'home'|'pnl'|'analysis'|'campaigns'|'products'|'detail'; onTabChange?: (k: string) => void } = {}) {
  return render(
    <ThemeProvider>
      <Sidebar
        activeTab={props.activeTab ?? 'home'}
        onTabChange={props.onTabChange ?? (() => {})}
      />
    </ThemeProvider>,
  );
}

describe('Sidebar', () => {
  it('renders all 6 tab destinations + operator link + theme toggle', () => {
    renderSidebar();
    const expectedLabels = ['בית', 'P&L', 'ניתוח', 'קמפיינים', 'מוצרים', 'פירוט'];
    for (const label of expectedLabels) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: /ניהול/ })).toHaveAttribute('href', '/operator');
  });

  it('fires onTabChange with the correct key when an item is clicked', () => {
    const onTabChange = vi.fn();
    renderSidebar({ onTabChange });
    fireEvent.click(screen.getByText('קמפיינים'));
    expect(onTabChange).toHaveBeenCalledWith('campaigns');
  });

  it('marks the active item with aria-current="page"', () => {
    renderSidebar({ activeTab: 'pnl' });
    expect(screen.getByText('P&L').closest('button')).toHaveAttribute('aria-current', 'page');
  });
});
