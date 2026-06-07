// dashboard-web/src/components/operator/__tests__/SyncNowButtons.dom.test.tsx
//
// Phase 2 (self-serve stores) — Task 3: SyncNowButtons must list stores via
// useStores() instead of a hardcoded const. These tests verify:
//   1. With useStores() mocked to the 3 live stores, the same store buttons
//      render as today (byte-identical labels).
//   2. With a 4th store added, a 4th button appears.
//   3. Per-store buttons are rendered in displayOrder (uzoshop → zolplus → usmile360).
//
// Pattern: mirror MetaBucPanel.dom.test.tsx — mock @/lib/useStores directly
// (the hook), mock @/lib/operatorClient to avoid fetch side-effects.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { StoreInfo } from '@/lib/getStores';

// ---------------------------------------------------------------------------
// Mocks — must precede the import of the module under test.
// ---------------------------------------------------------------------------

const THREE_STORES: StoreInfo[] = [
  { storeId: 'uzoshop',   storeName: 'uzoshop',   brandColor: null, isHeadless: false, hasTikTok: true,  status: 'active', displayOrder: 1 },
  { storeId: 'zolplus',   storeName: 'Zol Plus',  brandColor: null, isHeadless: false, hasTikTok: false, status: 'active', displayOrder: 2 },
  { storeId: 'usmile360', storeName: '360usmile', brandColor: null, isHeadless: true,  hasTikTok: true,  status: 'active', displayOrder: 3 },
];

const FOUR_STORES: StoreInfo[] = [
  ...THREE_STORES,
  { storeId: 'newshop', storeName: 'New Shop', brandColor: null, isHeadless: false, hasTikTok: false, status: 'active', displayOrder: 4 },
];

let mockStores: StoreInfo[] = THREE_STORES;

vi.mock('@/lib/useStores', () => ({
  useStores: () => ({ stores: mockStores }),
}));

vi.mock('@/lib/operatorClient', () => ({
  operatorFetch: vi.fn(async () => ({
    status: 202,
    json: async () => ({ accepted: 1, eventIds: ['x'] }),
  })),
}));

import { SyncNowButtons } from '../SyncNowButtons';

afterEach(() => {
  cleanup();
  mockStores = THREE_STORES;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SyncNowButtons — useStores() integration (Phase 2 Task 3)', () => {
  it('renders a per-store button for each of the 3 live stores', () => {
    render(<SyncNowButtons />);
    // Each button shows the storeName from the hook
    expect(screen.getByText('uzoshop')).toBeDefined();
    expect(screen.getByText('Zol Plus')).toBeDefined();
    expect(screen.getByText('360usmile')).toBeDefined();
  });

  it('renders exactly 3 per-store buttons (plus 1 "all" button = 4 total)', () => {
    render(<SyncNowButtons />);
    const buttons = screen.getAllByRole('button');
    // 1 "Sync all" + 3 per-store = 4
    expect(buttons.length).toBe(4);
  });

  it('also renders the global "Sync now (כל החנויות)" button', () => {
    render(<SyncNowButtons />);
    // The global button text includes the Hebrew "כל החנויות" — unique to that button
    expect(screen.getByText(/כל החנויות/)).toBeDefined();
  });

  it('renders a button for a dynamically added 4th store', () => {
    mockStores = FOUR_STORES;
    render(<SyncNowButtons />);
    expect(screen.getByText('New Shop')).toBeDefined();
    // 1 "all" + 4 per-store = 5 buttons
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBe(5);
  });

  it('does NOT render a button labeled "newshop" when only the original 3 are present', () => {
    render(<SyncNowButtons />);
    expect(screen.queryByText('New Shop')).toBeNull();
  });

  it('per-store buttons are rendered in displayOrder: uzoshop → zolplus → usmile360', () => {
    render(<SyncNowButtons />);
    const buttons = screen.getAllByRole('button');
    // First button is the global "Sync all" button; per-store buttons follow.
    const perStoreNames = buttons.slice(1).map((b) => b.textContent?.trim());
    expect(perStoreNames[0]).toBe('uzoshop');
    expect(perStoreNames[1]).toBe('Zol Plus');
    expect(perStoreNames[2]).toBe('360usmile');
  });
});
