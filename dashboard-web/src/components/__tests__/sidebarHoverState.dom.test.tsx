import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sidebar } from '@/components/Sidebar';
import { ThemeProvider } from '@/components/ThemeProvider';

function renderSidebar() {
  return render(
    <ThemeProvider>
      <Sidebar
        activeTab="home"
        onTabChange={() => {}}
        isMobileOpen={false}
        onMobileClose={() => {}}
      />
    </ThemeProvider>,
  );
}

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

  it('active nav item carries a 1-px ring for depth (visually distinct from hover)', () => {
    renderSidebar();
    // Both rails render — grab the first Home button (desktop rail).
    const active = screen.getAllByRole('tab', { name: /בית/ })[0];
    expect(active.className).toMatch(/ring-1/);
  });
});
