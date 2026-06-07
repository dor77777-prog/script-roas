// dashboard-web/src/components/operator/__tests__/BackfillPicker.dom.test.tsx
//
// Phase 2 (self-serve stores) — Task 3: BackfillPicker must list stores via
// useStores() instead of a hardcoded const. These tests verify:
//   1. With useStores() mocked to the 3 live stores, the same checkboxes
//      render as today (byte-identical labels).
//   2. With a 4th store added, that store's checkbox appears.
//
// Pattern: mirrors MetaBucPanel.dom.test.tsx + manualOverridesTikTokOption.dom.test.tsx

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
    render(<BackfillPicker />);
    expect(screen.getByText('New Shop')).toBeDefined();
    const { container } = render(<BackfillPicker />);
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes.length).toBe(4);
  });

  it('does NOT render a "New Shop" checkbox when only the original 3 are present', () => {
    render(<BackfillPicker />);
    expect(screen.queryByText('New Shop')).toBeNull();
  });
});
