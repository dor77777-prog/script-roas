// dashboard-web/src/components/__tests__/TopStrip.dom.test.tsx
//
// reskin-w2c — non-sticky Horizon TopStrip extracted from Dashboard.
//
// Pins:
//   • Renders the breadcrumb + page title for the active tab (home → "בית";
//     a different tab → its Hebrew label), proving the activeTab → label map.
//   • Renders the mobile-only hamburger (md:hidden) and fires
//     onOpenMobileSidebar when tapped.
//   • Renders the CommandPalette trigger pill.
//   • The AI-export control fires onOpenAiReport (home tab).
//   • The AI-export control is VISIBLE at mobile width (reskin-w8): the control
//     itself is never `hidden` (icon-only on phones, labeled from md+) and
//     always exposes an accessible name, so the action is reachable on
//     mobile-home — not only via the ⌘K palette command.
//   • The AI-export control is HOME-ONLY (absent on other tabs) — the report
//     modal listener (AiReportButton) only mounts on home, so the navbar
//     button would be a no-op elsewhere; the approved mockup is the home navbar.
//   • The strip is NOT sticky (className carries no `sticky`).
//   • Renders even while `data` is null (proves it mounts during loading).

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TopStrip } from '@/components/TopStrip';
import { ThemeProvider } from '@/components/ThemeProvider';
import type { DashboardData, Filters as DashFilters } from '@/lib/types';
import type { TabKey } from '@/lib/urlState';

// Minimal DashboardData-shaped stub — only `stores` is read by the palette's
// store-command loop; the rest is cast through `unknown` to satisfy the type.
const DATA: DashboardData = {
  stores: ['uzoshop', 'usmile360'],
  lastUpdated: '2026-06-13T00:00:00Z',
  dataLastWriteAt: '2026-06-13T00:00:00Z',
} as unknown as DashboardData;

const FILTERS: DashFilters = {
  store: 'All',
  range: { from: '2026-06-01', to: '2026-06-13' },
  preset: 'this_month',
} as unknown as DashFilters;

function renderStrip(overrides: {
  activeTab?: TabKey;
  data?: DashboardData | null;
  onOpenAiReport?: () => void;
  onOpenMobileSidebar?: () => void;
} = {}) {
  return render(
    <ThemeProvider>
      <TopStrip
        activeTab={overrides.activeTab ?? 'home'}
        data={overrides.data === undefined ? DATA : overrides.data}
        filters={FILTERS}
        setFilters={() => {}}
        setActiveTab={() => {}}
        onRefresh={() => {}}
        onOpenAiReport={overrides.onOpenAiReport ?? (() => {})}
        onOpenMobileSidebar={overrides.onOpenMobileSidebar ?? (() => {})}
        dataLastWriteAt={
          (overrides.data === null ? null : DATA.dataLastWriteAt) ?? null
        }
      />
    </ThemeProvider>,
  );
}

describe('reskin-w2c — <TopStrip>', () => {
  it('renders the breadcrumb + page title for the home tab ("בית")', () => {
    renderStrip({ activeTab: 'home' });
    const strip = screen.getByTestId('top-strip');
    // Breadcrumb "עמודים / בית" + the big title line "בית" both present.
    expect(strip.textContent).toContain('עמודים');
    expect(strip.textContent).toContain('בית');
  });

  it('derives the Hebrew title from a non-home activeTab (campaigns → קמפיינים)', () => {
    renderStrip({ activeTab: 'campaigns' });
    expect(screen.getByTestId('top-strip').textContent).toContain('קמפיינים');
  });

  it('renders a mobile-only hamburger that fires onOpenMobileSidebar', () => {
    const onOpenMobileSidebar = vi.fn();
    renderStrip({ onOpenMobileSidebar });
    const burger = screen.getByRole('button', { name: 'פתח תפריט' });
    expect(burger.className).toContain('md:hidden');
    fireEvent.click(burger);
    expect(onOpenMobileSidebar).toHaveBeenCalledTimes(1);
  });

  it('renders the CommandPalette trigger pill', () => {
    renderStrip();
    expect(
      screen.getByRole('button', { name: 'פתח פנל פקודות' }),
    ).toBeTruthy();
  });

  it('fires onOpenAiReport when the AI-export control is clicked (home tab)', () => {
    const onOpenAiReport = vi.fn();
    renderStrip({ activeTab: 'home', onOpenAiReport });
    fireEvent.click(screen.getByTestId('top-strip-ai-export'));
    expect(onOpenAiReport).toHaveBeenCalledTimes(1);
  });

  it('surfaces the AI-export control on mobile-home: visible (never `hidden`) + accessible name (reskin-w8)', () => {
    renderStrip({ activeTab: 'home' });
    const btn = screen.getByTestId('top-strip-ai-export');
    // The control itself must NOT be display-hidden at base (phone) width —
    // it's icon-only on phones, labeled from md+, but always present/usable.
    expect(btn.className).not.toContain('hidden');
    expect(btn.className).toContain('inline-flex');
    // It exposes an accessible name even when the text label is collapsed
    // (icon-only on phones), so it's reachable by name on mobile-home.
    expect(
      screen.getByRole('button', { name: 'ייצא דוח ל-AI' }),
    ).toBe(btn);
  });

  it('shows the AI-export control ONLY on the home tab (none on other tabs)', () => {
    // Home: present (the AiReportButton report modal listens there).
    const { unmount } = renderStrip({ activeTab: 'home' });
    expect(screen.queryByTestId('top-strip-ai-export')).toBeTruthy();
    unmount();
    // Non-home tabs: absent — no modal listener exists, so a navbar export
    // button would be a confusing dead control. Dedupe + home-scoping per the
    // canonical mockup (only the home navbar mockup carries the export button).
    for (const tab of ['campaigns', 'customers', 'pnl', 'trends'] as TabKey[]) {
      const r = renderStrip({ activeTab: tab });
      expect(screen.queryByTestId('top-strip-ai-export')).toBeNull();
      r.unmount();
    }
  });

  it('is NOT sticky (the floating navbar sits in normal flow)', () => {
    renderStrip();
    expect(screen.getByTestId('top-strip').className).not.toContain('sticky');
  });

  it('renders during loading when data is null (palette + chrome still mount)', () => {
    // The CommandPalette accepts a nullable data prop and the strip always
    // renders — proving the chrome is usable before the first fetch resolves.
    renderStrip({ data: null });
    expect(screen.getByTestId('top-strip')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'פתח פנל פקודות' }),
    ).toBeTruthy();
    // Title still derives from activeTab even with no data.
    expect(screen.getByTestId('top-strip').textContent).toContain('בית');
  });
});
