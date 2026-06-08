// dashboard-web/src/components/operator/__tests__/RemovedStores.dom.test.tsx
//
// Self-serve stores Phase 6b — Task 3: RemovedStores ("חנויות שהוסרו") DOM tests.
//
// RemovedStores is PRESENTATIONAL (no data fetch — the parent StoresTab fetches
// GET /api/operator/stores and passes the rows down). It renders ONLY the
// archived stores (status === 'archived'), each tagged "הוסרה" (a muted Badge)
// with a "שחזר" (restore) action that calls up via onRestore(storeId). When there
// are no archived stores it renders nothing (no info loss — there's simply no
// removed-area to show). DELETE is DEFERRED (a later task) — there is NO
// "מחק לצמיתות" affordance here yet.
//
// Pattern mirrors StoreList.dom.test.tsx: render with props, assert on roles /
// text / test-ids, fire events.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';

import { RemovedStores } from '../RemovedStores';
import type { StoreRowData } from '../StoreList';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// A fixture mirroring the GET /api/operator/stores row shape exactly: a mix of
// active + archived. RemovedStores must show ONLY the archived ones.
const STORES: StoreRowData[] = [
  {
    storeId: 'uzoshop',
    name: 'uzoshop',
    brandColor: 'var(--store-uzo)',
    isHeadless: false,
    hasTikTok: true,
    status: 'active', // must NOT appear in the removed-area
    displayOrder: 1,
    platforms: ['google', 'meta', 'shopify', 'tiktok'],
    hasWebhookSecret: true,
  },
  {
    storeId: 'oldstore',
    name: 'Old Store',
    brandColor: 'var(--store-3)',
    isHeadless: false,
    hasTikTok: false,
    status: 'archived',
    displayOrder: 9,
    platforms: ['shopify'],
    hasWebhookSecret: false,
  },
  {
    storeId: 'gonestore',
    name: 'Gone Store',
    brandColor: null,
    isHeadless: true,
    hasTikTok: false,
    status: 'archived',
    displayOrder: 10,
    platforms: ['shopify', 'meta'],
    hasWebhookSecret: false,
  },
];

describe('RemovedStores — חנויות שהוסרו area (Phase 6b Task 3)', () => {
  it('renders one row per ARCHIVED store (active excluded)', () => {
    render(<RemovedStores stores={STORES} onRestore={vi.fn()} />);
    expect(screen.getByTestId('removed-store-row-oldstore')).toBeDefined();
    expect(screen.getByTestId('removed-store-row-gonestore')).toBeDefined();
    expect(within(screen.getByTestId('removed-store-row-oldstore')).getByText('Old Store')).toBeDefined();
    // Active stores never appear in the removed-area.
    expect(screen.queryByTestId('removed-store-row-uzoshop')).toBeNull();
    expect(screen.queryByText('uzoshop')).toBeNull();
  });

  it('tags each removed store with a "הוסרה" badge', () => {
    render(<RemovedStores stores={STORES} onRestore={vi.fn()} />);
    const row = screen.getByTestId('removed-store-row-oldstore');
    expect(within(row).getByText(/הוסרה/)).toBeDefined();
  });

  it('renders a "שחזר" action per removed store and calls onRestore(storeId)', () => {
    const onRestore = vi.fn();
    render(<RemovedStores stores={STORES} onRestore={onRestore} />);
    const row = screen.getByTestId('removed-store-row-oldstore');
    fireEvent.click(within(row).getByRole('button', { name: /שחזר/ }));
    expect(onRestore).toHaveBeenCalledWith('oldstore');
  });

  it('the restore action carries an accessible name scoped to the store', () => {
    render(<RemovedStores stores={STORES} onRestore={vi.fn()} />);
    const row = screen.getByTestId('removed-store-row-gonestore');
    expect(within(row).getByRole('button', { name: /שחזר.*Gone Store/ })).toBeDefined();
  });

  it('does NOT render a delete affordance yet (delete is deferred)', () => {
    render(<RemovedStores stores={STORES} onRestore={vi.fn()} />);
    const row = screen.getByTestId('removed-store-row-oldstore');
    expect(within(row).queryByRole('button', { name: /מחק/ })).toBeNull();
  });

  it('renders NOTHING when there are no archived stores (empty removed-area)', () => {
    const onlyActive: StoreRowData[] = [STORES[0]];
    const { container } = render(<RemovedStores stores={onlyActive} onRestore={vi.fn()} />);
    // No removed-area heading and no rows.
    expect(screen.queryByText(/חנויות שהוסרו/)).toBeNull();
    expect(screen.queryByTestId('removed-store-row-oldstore')).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it('renders NOTHING for a completely empty list too', () => {
    const { container } = render(<RemovedStores stores={[]} onRestore={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the removed-area heading when there is at least one archived store', () => {
    render(<RemovedStores stores={STORES} onRestore={vi.fn()} />);
    expect(screen.getByText(/חנויות שהוסרו/)).toBeDefined();
  });
});
