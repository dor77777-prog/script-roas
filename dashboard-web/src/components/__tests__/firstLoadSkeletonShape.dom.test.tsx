// dashboard-web/src/components/__tests__/firstLoadSkeletonShape.dom.test.tsx
//
// Reskin W8-T1 — the genuine first-mount loading silhouette must match the
// ACTIVE tab, not the Home shape.
//
// `activeTab` is URL-initialized in <Dashboard> (its useState reads
// window.location), so a cold-start deep-link to `/?tab=campaigns` (or any
// other non-home tab) reaches the `isLoading` branch with `activeTab` already
// pointing at a non-home surface. The old loading block was hard-wired to the
// Home silhouette (hero band + 6-up KPI grid) REGARDLESS of `activeTab`, so the
// campaigns/products/detail surfaces flashed a KPI-grid silhouette before their
// (tabular) data arrived — the skeleton lied about what was loading.
//
// `FirstLoadSkeleton` (exported from Dashboard) is exactly what the `isLoading`
// branch renders — `{isLoading && <FirstLoadSkeleton activeTab={activeTab} />}`
// — so rendering it per tab tests the real wiring in isolation, without the
// heavy SWR + child-component mock surface a full <Dashboard> render needs.

// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { FirstLoadSkeleton } from '@/components/Dashboard';
import type { TabKey } from '@/lib/urlState';

// jsdom's matchMedia is undefined; StateBlock's useReducedMotion reads it.
// Default to reduce=true (the DOM runner's convention) so the shimmer is gated
// and the shape assertions stand on the static markup.
beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// The canonical per-tab silhouette map this test pins. Tabular/row-list
// surfaces → 'table'; KPI/summary-card surfaces → 'card'.
const EXPECTED: Record<TabKey, 'card' | 'table'> = {
  campaigns: 'table',
  products: 'table',
  archive: 'table',
  detail: 'table',
  activity: 'table',
  home: 'card',
  customers: 'card',
  payments: 'card',
  pnl: 'card',
  trends: 'card',
};

describe('FirstLoadSkeleton — silhouette follows the active tab', () => {
  it('renders the TABLE shape on a campaigns cold start (vertical stack, NOT a KPI grid)', () => {
    render(<FirstLoadSkeleton activeTab="campaigns" />);
    const root = screen.getByTestId('first-load-skeleton');
    // Stable contract the rest of the app / future tests can key off.
    expect(root.getAttribute('data-shape')).toBe('table');

    // The inner StateBlock wrapper is a flex-col vertical stack, never a grid.
    const wrapper = within(root).getByTestId('state-skeleton-wrapper');
    expect(wrapper.className).toContain('flex-col');
    expect(wrapper.className).not.toContain('grid');

    // A table surface opens with NO hero band — the chunky h-40 hero
    // placeholder is a card-only lead row.
    expect(root.querySelector('.h-40')).toBeNull();
  });

  it('renders the CARD shape on a home cold start (4-up grid + hero band)', () => {
    render(<FirstLoadSkeleton activeTab="home" />);
    const root = screen.getByTestId('first-load-skeleton');
    expect(root.getAttribute('data-shape')).toBe('card');

    // Card surfaces lead with a full-width hero band placeholder.
    expect(root.querySelector('.h-40')).not.toBeNull();

    // The inner StateBlock wrapper is the responsive KPI grid.
    const wrapper = within(root).getByTestId('state-skeleton-wrapper');
    expect(wrapper.className).toContain('grid');
    expect(wrapper.className).toContain('lg:grid-cols-4');
    expect(wrapper.className).not.toContain('flex-col');
  });

  it.each(Object.entries(EXPECTED) as Array<[TabKey, 'card' | 'table']>)(
    'maps tab "%s" to the "%s" silhouette',
    (tab, shape) => {
      render(<FirstLoadSkeleton activeTab={tab} />);
      const root = screen.getByTestId('first-load-skeleton');
      expect(root.getAttribute('data-shape')).toBe(shape);

      const wrapper = within(root).getByTestId('state-skeleton-wrapper');
      if (shape === 'table') {
        expect(wrapper.className).toContain('flex-col');
        expect(wrapper.className).not.toContain('grid');
      } else {
        expect(wrapper.className).toContain('grid');
        expect(wrapper.className).not.toContain('flex-col');
      }
    },
  );

  it('preserves the sr-only "טוען נתונים…" live-region announcement on every tab', () => {
    for (const tab of Object.keys(EXPECTED) as TabKey[]) {
      render(<FirstLoadSkeleton activeTab={tab} />);
      // StateBlock renders `message` inside the aria-busy="true" container.
      const busy = screen.getByTestId('state-skeleton');
      expect(busy.getAttribute('aria-busy')).toBe('true');
      expect(within(busy).getByText('טוען נתונים…')).toBeInTheDocument();
      cleanup();
    }
  });

  it('keeps every placeholder aria-hidden (no real content leaked while loading)', () => {
    render(<FirstLoadSkeleton activeTab="products" />);
    const root = screen.getByTestId('first-load-skeleton');
    root.querySelectorAll('.skeleton').forEach((el) => {
      expect(el.getAttribute('aria-hidden')).toBe('true');
      expect(el.textContent).toBe('');
    });
  });
});
