// dashboard-web/src/components/operator/__tests__/StoreList.dom.test.tsx
//
// Self-serve stores Phase 6a — Task 6: StoreList + StoreRow DOM tests.
//
// StoreList/StoreRow are PRESENTATIONAL (no data fetch — the parent T7 StoresTab
// fetches GET /api/operator/stores and passes the rows down). These tests assert
// the active-only filter, the per-row content (name + brand swatch + platform
// badges), the edit callback wiring, and the empty state. Archive/restore/delete
// are Phase 6b and intentionally NOT covered here.
//
// Pattern mirrors AddStoreWizard.dom.test.tsx / AdStatePanel-style presentational
// components: render with props, assert on roles / text / test-ids, fire events.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';

import { StoreList, type StoreRowData } from '../StoreList';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// A fixture mirroring the GET /api/operator/stores row shape exactly.
const STORES: StoreRowData[] = [
  {
    storeId: 'uzoshop',
    name: 'uzoshop',
    brandColor: 'var(--store-uzo)',
    isHeadless: false,
    hasTikTok: true,
    status: 'active',
    displayOrder: 1,
    platforms: ['google', 'meta', 'shopify', 'tiktok'],
  },
  {
    storeId: 'usmile360',
    name: '360usmile',
    brandColor: 'var(--store-usm)',
    isHeadless: true,
    hasTikTok: false,
    status: 'active',
    displayOrder: 3,
    platforms: ['meta', 'shopify'],
  },
  {
    storeId: 'oldstore',
    name: 'Old Store',
    brandColor: 'var(--store-3)',
    isHeadless: false,
    hasTikTok: false,
    status: 'archived', // must NOT render in 6a
    displayOrder: 9,
    platforms: ['shopify'],
  },
];

describe('StoreList — active stores (Phase 6a Task 6)', () => {
  it('renders one row per ACTIVE store (archived excluded)', () => {
    render(<StoreList stores={STORES} onEdit={vi.fn()} />);
    // Each active store renders its own row (scoped by test-id; "uzoshop"
    // happens to equal its own slug in the fixture, so getByText is ambiguous).
    expect(screen.getByTestId('store-row-uzoshop')).toBeDefined();
    expect(screen.getByTestId('store-row-usmile360')).toBeDefined();
    expect(within(screen.getByTestId('store-row-usmile360')).getByText('360usmile')).toBeDefined();
    // The archived store must not be rendered in 6a.
    expect(screen.queryByText('Old Store')).toBeNull();
    expect(screen.queryByTestId('store-row-oldstore')).toBeNull();
  });

  it('renders the platform badges for each active store', () => {
    render(<StoreList stores={STORES} onEdit={vi.fn()} />);
    const uzoRow = screen.getByTestId('store-row-uzoshop');
    // uzoshop is configured with all four platforms.
    expect(within(uzoRow).getByText('Shopify')).toBeDefined();
    expect(within(uzoRow).getByText('Meta')).toBeDefined();
    expect(within(uzoRow).getByText('Google')).toBeDefined();
    expect(within(uzoRow).getByText('TikTok')).toBeDefined();

    // usmile360 only has Meta + Shopify configured → no Google/TikTok badge.
    const usmileRow = screen.getByTestId('store-row-usmile360');
    expect(within(usmileRow).getByText('Shopify')).toBeDefined();
    expect(within(usmileRow).getByText('Meta')).toBeDefined();
    expect(within(usmileRow).queryByText('Google')).toBeNull();
    expect(within(usmileRow).queryByText('TikTok')).toBeNull();
  });

  it('renders a token-driven brand-color swatch per row', () => {
    render(<StoreList stores={STORES} onEdit={vi.fn()} />);
    const swatch = screen.getByTestId('store-swatch-uzoshop');
    expect(swatch).toBeDefined();
    // Token-driven: the swatch background is a CSS var (no raw color literal).
    expect(swatch.getAttribute('style') ?? '').toContain('var(--store-uzo)');
  });

  it('calls onEdit with the store id when the edit button is clicked', () => {
    const onEdit = vi.fn();
    render(<StoreList stores={STORES} onEdit={onEdit} />);
    const usmileRow = screen.getByTestId('store-row-usmile360');
    fireEvent.click(within(usmileRow).getByRole('button', { name: /ערוך|edit/i }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith('usmile360');
  });

  it('renders a friendly Hebrew empty state when there are no active stores', () => {
    const onlyArchived: StoreRowData[] = [STORES[2]];
    render(<StoreList stores={onlyArchived} onEdit={vi.fn()} />);
    expect(screen.getByText(/אין חנויות פעילות/)).toBeDefined();
    // No rows rendered.
    expect(screen.queryByTestId('store-row-oldstore')).toBeNull();
  });

  it('renders the empty state for a completely empty list too', () => {
    render(<StoreList stores={[]} onEdit={vi.fn()} />);
    expect(screen.getByText(/אין חנויות פעילות/)).toBeDefined();
  });
});
