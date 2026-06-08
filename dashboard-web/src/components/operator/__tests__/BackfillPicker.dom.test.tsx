// dashboard-web/src/components/operator/__tests__/BackfillPicker.dom.test.tsx
//
// Phase 2 (self-serve stores) — Task 3: BackfillPicker must list stores via
// useStores() instead of a hardcoded const. These tests verify:
//   1. With useStores() mocked to the 3 live stores, the same checkboxes
//      render as today (byte-identical labels).
//   2. With a 4th store added, that store's checkbox appears.
//   3. Checkboxes are rendered in displayOrder (uzoshop → zolplus → usmile360).
//   4. A 4th store arriving after mount is CHECKED by default (union fix).
//
// Pattern: mirrors MetaBucPanel.dom.test.tsx + manualOverridesTikTokOption.dom.test.tsx

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import type { StoreInfo } from '@/lib/getStores';

// ---------------------------------------------------------------------------
// Mocks — must precede the import of the module under test.
// ---------------------------------------------------------------------------

const THREE_STORES: StoreInfo[] = [
  { storeId: 'uzoshop',   storeName: 'uzoshop',   brandColor: null, isHeadless: false, hasTikTok: true,  status: 'active', displayOrder: 1, enableCustomerJourney: false },
  { storeId: 'zolplus',   storeName: 'Zol Plus',  brandColor: null, isHeadless: false, hasTikTok: false, status: 'active', displayOrder: 2, enableCustomerJourney: false },
  { storeId: 'usmile360', storeName: '360usmile', brandColor: null, isHeadless: true,  hasTikTok: true,  status: 'active', displayOrder: 3, enableCustomerJourney: false },
];

const FOUR_STORES: StoreInfo[] = [
  ...THREE_STORES,
  { storeId: 'newshop', storeName: 'New Shop', brandColor: null, isHeadless: false, hasTikTok: false, status: 'active', displayOrder: 4, enableCustomerJourney: false },
];

let mockStores: StoreInfo[] = THREE_STORES;

vi.mock('@/lib/useStores', () => ({
  useStores: () => ({ stores: mockStores }),
}));

vi.mock('@/lib/operatorClient', () => ({
  operatorFetch: vi.fn(async () => ({
    status: 202,
    json: async () => ({ accepted: 1, eventIds: ['x'], range: { from: '2026-05-01', to: '2026-06-01' }, storeIds: [] }),
  })),
}));

import { BackfillPicker } from '../BackfillPicker';

afterEach(() => {
  cleanup();
  mockStores = THREE_STORES;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BackfillPicker — useStores() integration (Phase 2 Task 3)', () => {
  it('renders a checkbox for each of the 3 live stores', () => {
    render(<BackfillPicker />);
    // Labels next to each checkbox carry the storeName
    expect(screen.getByText('uzoshop')).toBeDefined();
    expect(screen.getByText('Zol Plus')).toBeDefined();
    expect(screen.getByText('360usmile')).toBeDefined();
  });

  it('renders exactly 3 store checkboxes', () => {
    const { container } = render(<BackfillPicker />);
    // Each store row has an <input type="checkbox">
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes.length).toBe(3);
  });

  it('all 3 store checkboxes are checked by default', () => {
    const { container } = render(<BackfillPicker />);
    const checkboxes = Array.from(container.querySelectorAll('input[type="checkbox"]'));
    expect(checkboxes.every((cb) => (cb as HTMLInputElement).checked)).toBe(true);
  });

  it('renders a checkbox for a dynamically added 4th store', () => {
    mockStores = FOUR_STORES;
    const { container } = render(<BackfillPicker />);
    expect(screen.getByText('New Shop')).toBeDefined();
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes.length).toBe(4);
  });

  it('does NOT render a "New Shop" checkbox when only the original 3 are present', () => {
    render(<BackfillPicker />);
    expect(screen.queryByText('New Shop')).toBeNull();
  });

  it('checkboxes are rendered in displayOrder: uzoshop → zolplus → usmile360', () => {
    const { container } = render(<BackfillPicker />);
    // Grab all checkbox labels in DOM order — each <label> wraps the <input> + <span>
    const labels = Array.from(container.querySelectorAll('label')).filter(
      (l) => l.querySelector('input[type="checkbox"]'),
    );
    const names = labels.map((l) => l.querySelector('span')?.textContent?.trim());
    expect(names).toEqual(['uzoshop', 'Zol Plus', '360usmile']);
  });

  it('4th store arriving post-mount is CHECKED by default (union fix)', () => {
    // Start with 3 stores, then simulate SWR resolving more stores.
    mockStores = THREE_STORES;
    const { rerender, container } = render(<BackfillPicker />);

    // Now the hook "resolves" to 4 stores (simulates SWR updating after mount).
    mockStores = FOUR_STORES;
    act(() => {
      rerender(<BackfillPicker />);
    });

    // The 4th store's checkbox must be CHECKED by default (union effect).
    const checkboxes = Array.from(
      container.querySelectorAll('input[type="checkbox"]'),
    ) as HTMLInputElement[];
    expect(checkboxes.length).toBe(4);
    // Find the one for 'New Shop' — it's last in displayOrder.
    const newShopCb = checkboxes[checkboxes.length - 1];
    expect(newShopCb.checked).toBe(true);
  });
});
