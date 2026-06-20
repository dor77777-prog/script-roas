import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Sidebar } from '../Sidebar';
import { FocusMode } from '../FocusMode';
import { ThemeProvider } from '../ThemeProvider';

// Pin the desktop (fine-pointer) branch so the collapsed-rail tooltip path is
// deterministic — the rail tooltip is the only HelpTooltip in the app whose
// `content=` is a non-string ReactNode (label + ⌘N shortcut), so it is the
// canonical over-promotion regression for Task 1.4.
vi.mock('@/lib/hooks/useIsMobile', () => ({ useIsMobile: () => false }));

// Redesign 2026-06-20 — the brand subtitle under "Insight Owl" must list the
// LIVE store DISPLAY names (from useStores), not a hardcoded "uzoshop · zolplus
// · usmile". Mock a 4-store business (incl. a self-serve 4th store) with real
// display names so the dynamic-subtitle test is deterministic.
vi.mock('@/lib/useStores', () => ({
  useStores: () => ({
    stores: [
      { storeId: 'uzoshop',   storeName: 'uzoshop',   brandColor: null, isHeadless: false, hasTikTok: true,  status: 'active', displayOrder: 1, enableCustomerJourney: false },
      { storeId: 'zolplus',   storeName: 'Zol Plus',  brandColor: null, isHeadless: false, hasTikTok: false, status: 'active', displayOrder: 2, enableCustomerJourney: false },
      { storeId: 'usmile360', storeName: '360usmile', brandColor: null, isHeadless: true,  hasTikTok: true,  status: 'active', displayOrder: 3, enableCustomerJourney: false },
      { storeId: 'pdrn-skin', storeName: 'pdrn skin', brandColor: null, isHeadless: true,  hasTikTok: true,  status: 'active', displayOrder: 4, enableCustomerJourney: false },
    ],
  }),
}));

afterEach(() => {
  // The sidebar pin persists to localStorage and FocusMode mutates
  // documentElement — reset both so the shortcut/collision tests start from a
  // known state and don't leak into each other.
  try { window.localStorage.clear(); } catch { /* sandboxed localStorage */ }
  document.documentElement.removeAttribute('data-focus-mode');
});

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
  it('brand subtitle lists the LIVE store display names dynamically (incl. a 4th store, real display names)', () => {
    // Mobile drawer renders the sidebar EXPANDED, so the subtitle is visible.
    renderSidebar({ isMobileOpen: true });
    expect(
      screen.getByText('uzoshop · Zol Plus · 360usmile · pdrn skin'),
    ).toBeInTheDocument();
    // The old hardcoded short-form string must be gone.
    expect(screen.queryByText('uzoshop · zolplus · usmile')).toBeNull();
  });

  it('renders all 9 tab destinations + operator link + theme toggle', () => {
    renderSidebar();
    // 'פעילות' (Activity) sits RIGHT AFTER 'בית' (Home) — first after Home.
    // Wave 2: 'לקוחות' (Customer Value) lands at slot 3 (after פעילות).
    const expectedLabels = ['בית', 'פעילות', 'לקוחות', 'טבלאות אופטימיזציה', 'P&L', 'מגמות', 'קמפיינים', 'מוצרים', 'פירוט'];
    for (const label of expectedLabels) {
      // reskin-w2: the desktop rail renders COLLAPSED by default (icon-only —
      // the label lives on the tab's aria-label, not as visible text) and the
      // mobile drawer is now a Radix portal that only mounts when open. So we
      // query by role+accessible-name, which resolves whether the label is
      // inline text OR an aria-label — presentation-agnostic.
      expect(screen.getAllByRole('tab', { name: label }).length).toBeGreaterThan(0);
    }
    const operatorLinks = screen.getAllByRole('link', { name: /ניהול/ });
    expect(operatorLinks.length).toBeGreaterThan(0);
    expect(operatorLinks[0]).toHaveAttribute('href', '/operator');
  });

  it('fires onTabChange with the correct key when an item is clicked', () => {
    const onTabChange = vi.fn();
    renderSidebar({ onTabChange });
    // Click the desktop rail's collapsed icon-tab via its accessible name.
    fireEvent.click(screen.getAllByRole('tab', { name: 'קמפיינים' })[0]);
    expect(onTabChange).toHaveBeenCalledWith('campaigns');
  });

  it('fires onTabChange("activity") when the פעילות item is clicked', () => {
    const onTabChange = vi.fn();
    renderSidebar({ onTabChange });
    fireEvent.click(screen.getAllByRole('tab', { name: 'פעילות' })[0]);
    expect(onTabChange).toHaveBeenCalledWith('activity');
  });

  it('fires onTabChange("customers") when the לקוחות item is clicked', () => {
    const onTabChange = vi.fn();
    renderSidebar({ onTabChange });
    fireEvent.click(screen.getAllByRole('tab', { name: 'לקוחות' })[0]);
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

  /**
   * Regression (Task 1.4 — over-promotion safety): the collapsed desktop rail
   * passes a NON-STRING ReactNode (label + ⌘N shortcut <span>) as the tooltip
   * content. Under the `auto` mode-selector that would auto-promote to a Radix
   * Popover (`role="dialog"`) — a heavyweight dialog surfacing on a simple
   * icon-hover. It must be pinned to `variant="text"` so it stays a slim
   * `role="tooltip"` and never a dialog.
   */
  it('collapsed rail tooltip stays a slim role=tooltip on focus (never a dialog)', async () => {
    const { container } = renderSidebar();
    const rail = container.querySelector('[data-testid="desktop-sidebar"]')!;
    const homeTab = Array.from(rail.querySelectorAll('nav [role="tab"]')).find(
      (b) => b.getAttribute('aria-label')?.trim() === 'בית',
    ) as HTMLElement;
    expect(homeTab).not.toBeNull();
    fireEvent.focus(homeTab);
    // The slim tooltip surfaces on focus...
    expect(await screen.findByRole('tooltip')).toHaveTextContent('בית');
    // ...and the rich Popover dialog must NEVER appear for this simple help.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  /**
   * W8-T5 — tab↔panel ARIA wiring. Each rail tab must carry a stable
   * `id="tab-${key}"` and point at the single main content panel via
   * `aria-controls="dashboard-tabpanel"` (the Dashboard <main> reciprocates
   * with role="tabpanel" + aria-labelledby={`tab-${activeTab}`}).
   */
  it('wires each tab with a stable id + aria-controls to the main panel', () => {
    const { container } = renderSidebar({ activeTab: 'home' });
    const rail = container.querySelector('[data-testid="desktop-sidebar"]')!;
    const tabs = Array.from(rail.querySelectorAll('nav [role="tab"]'));
    expect(tabs.length).toBeGreaterThan(0);
    for (const tab of tabs) {
      // Every tab points at the one main content panel.
      expect(tab.getAttribute('aria-controls')).toBe('dashboard-tabpanel');
      // …and carries a stable `tab-${key}` id for the panel's aria-labelledby.
      expect(tab.getAttribute('id')).toMatch(/^tab-[a-z]+$/);
    }
    // The home tab specifically resolves to `tab-home`.
    const home = tabs.find(
      (t) => t.getAttribute('aria-label')?.trim() === 'בית',
    );
    expect(home?.getAttribute('id')).toBe('tab-home');
  });

  it('marks the active item with aria-current="page"', () => {
    renderSidebar({ activeTab: 'pnl' });
    // Query the active tab by role+accessible-name (collapsed rail → aria-label).
    const activeButtons = screen
      .getAllByRole('tab', { name: 'P&L' })
      .filter((b) => b.getAttribute('aria-current') === 'page');
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

  /**
   * reskin-w2 shortcut-collision fix: the Sidebar pin AND FocusMode used to
   * both bind Cmd/Ctrl+\ — two document-level listeners firing on ONE
   * keypress. The pin keeps ⌘\ (more discoverable); FocusMode moved to ⌘.
   * These two tests render BOTH components together and assert each chord
   * drives exactly its own surface, never the other.
   */
  it('⌘\\ toggles the sidebar pin WITHOUT triggering focus-mode', () => {
    const { container } = render(
      <ThemeProvider>
        <Sidebar activeTab="home" onTabChange={() => {}} isMobileOpen={false} onMobileClose={() => {}} />
        <FocusMode />
      </ThemeProvider>,
    );
    const rail = container.querySelector('[data-testid="desktop-sidebar"]')! as HTMLElement;
    expect(rail.getAttribute('data-pinned')).toBe('false');
    expect(document.documentElement.getAttribute('data-focus-mode')).not.toBe('on');

    fireEvent.keyDown(document, { key: '\\', metaKey: true });

    // Pin flipped...
    expect(rail.getAttribute('data-pinned')).toBe('true');
    // ...and focus-mode did NOT come along for the ride (collision resolved).
    expect(document.documentElement.getAttribute('data-focus-mode')).not.toBe('on');
  });

  it('⌘. toggles focus-mode WITHOUT toggling the sidebar pin', () => {
    const { container } = render(
      <ThemeProvider>
        <Sidebar activeTab="home" onTabChange={() => {}} isMobileOpen={false} onMobileClose={() => {}} />
        <FocusMode />
      </ThemeProvider>,
    );
    const rail = container.querySelector('[data-testid="desktop-sidebar"]')! as HTMLElement;
    expect(rail.getAttribute('data-pinned')).toBe('false');

    fireEvent.keyDown(document, { key: '.', metaKey: true });

    // Focus-mode flipped on...
    expect(document.documentElement.getAttribute('data-focus-mode')).toBe('on');
    // ...and the pin stayed put.
    expect(rail.getAttribute('data-pinned')).toBe('false');
  });

  /**
   * reskin-w2 "modal/drawer must be Radix" fix (2026-06-03 ProductPickerModal
   * incident guard pattern): the mobile off-canvas drawer used to be a
   * hand-rolled fixed-overlay <aside>. It now routes through the Radix Sheet
   * primitive, so when open it must render as a real Radix dialog — role=dialog
   * + a data-state attribute Radix sets to 'open' — giving us the focus-trap /
   * scroll-lock / Esc-stack for free.
   */
  it('mobile drawer renders as a Radix dialog (role=dialog + data-state) when open', async () => {
    render(
      <ThemeProvider>
        <Sidebar activeTab="home" onTabChange={() => {}} isMobileOpen onMobileClose={() => {}} />
      </ThemeProvider>,
    );
    const drawer = await screen.findByTestId('mobile-drawer');
    // Radix Dialog content carries role=dialog...
    expect(drawer).toHaveAttribute('role', 'dialog');
    // ...and a data-state Radix flips between 'open' / 'closed'.
    expect(drawer).toHaveAttribute('data-state', 'open');
    // The nav contents come along (drawer body shares SidebarBody).
    expect(drawer.querySelectorAll('nav [role="tab"]').length).toBeGreaterThan(0);
  });

  it('mobile drawer is NOT in the DOM when closed (Radix unmounts the portal)', () => {
    render(
      <ThemeProvider>
        <Sidebar activeTab="home" onTabChange={() => {}} isMobileOpen={false} onMobileClose={() => {}} />
      </ThemeProvider>,
    );
    expect(screen.queryByTestId('mobile-drawer')).toBeNull();
  });
});
