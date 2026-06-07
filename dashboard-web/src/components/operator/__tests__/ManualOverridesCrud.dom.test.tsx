// dashboard-web/src/components/operator/__tests__/ManualOverridesCrud.dom.test.tsx
//
// Phase 2 (self-serve stores) — Task 3: ManualOverridesCrud must list stores via
// useStores() instead of a hardcoded const. These tests verify:
//   1. With useStores() mocked to the 3 live stores, the same store <option>s
//      render as today (byte-identical values/labels).
//   2. With a 4th store added, a 4th <option> appears.
//   3. Default selected store is stores[0].storeId = 'uzoshop'.
//
// Pattern: mirrors manualOverridesTikTokOption.dom.test.tsx — mock swr +
// @/lib/operatorClient + @/lib/useStores.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { StoreInfo } from '@/lib/getStores';

// ---------------------------------------------------------------------------
// Mocks — must precede the import of the module under test.
// ---------------------------------------------------------------------------

vi.mock('swr', () => ({
  default: () => ({
    data: { rows: [] },
    error: undefined,
    isLoading: false,
    mutate: vi.fn(),
  }),
}));

vi.mock('@/lib/operatorClient', () => ({
  operatorFetch: vi.fn(async () => ({
    json: async () => ({ rows: [] }),
    status: 200,
  })),
}));

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

import { ManualOverridesCrud } from '../ManualOverridesCrud';

afterEach(() => {
  cleanup();
  mockStores = THREE_STORES;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ManualOverridesCrud — useStores() integration (Phase 2 Task 3)', () => {
  it('renders an <option> for each of the 3 live stores in the store select', () => {
    const { container } = render(<ManualOverridesCrud />);
    const storeOptions = Array.from(container.querySelectorAll('option')).filter(
      (o) => ['uzoshop', 'zolplus', 'usmile360'].includes(o.getAttribute('value') ?? ''),
    );
    expect(storeOptions.length).toBe(3);
    const values = storeOptions.map((o) => o.getAttribute('value'));
    expect(values).toContain('uzoshop');
    expect(values).toContain('zolplus');
    expect(values).toContain('usmile360');
  });

  it('uses storeName as the display label (not the raw storeId for ones with different names)', () => {
    const { container } = render(<ManualOverridesCrud />);
    const options = Array.from(container.querySelectorAll('option'));
    const zolOption = options.find((o) => o.getAttribute('value') === 'zolplus');
    expect(zolOption?.textContent?.trim()).toBe('Zol Plus');
    const usmileOption = options.find((o) => o.getAttribute('value') === 'usmile360');
    expect(usmileOption?.textContent?.trim()).toBe('360usmile');
  });

  it('defaults the store select to uzoshop (stores[0])', () => {
    const { container } = render(<ManualOverridesCrud />);
    // The store NativeSelect is the first <select> in the form
    const selects = container.querySelectorAll('select');
    const storeSelect = selects[0] as HTMLSelectElement;
    expect(storeSelect.value).toBe('uzoshop');
  });

  it('renders an <option> for a dynamically added 4th store', () => {
    mockStores = FOUR_STORES;
    const { container } = render(<ManualOverridesCrud />);
    const options = Array.from(container.querySelectorAll('option'));
    const newOption = options.find((o) => o.getAttribute('value') === 'newshop');
    expect(newOption).toBeDefined();
    expect(newOption?.textContent?.trim()).toBe('New Shop');
  });

  it('does NOT render a "newshop" option when only the original 3 stores are present', () => {
    const { container } = render(<ManualOverridesCrud />);
    const options = Array.from(container.querySelectorAll('option'));
    const newOption = options.find((o) => o.getAttribute('value') === 'newshop');
    expect(newOption).toBeUndefined();
  });

  it('still renders tiktok as a platform option (existing guard)', () => {
    const { container } = render(<ManualOverridesCrud />);
    const values = Array.from(container.querySelectorAll('option')).map((o) =>
      o.getAttribute('value'),
    );
    expect(values).toContain('meta');
    expect(values).toContain('google');
    expect(values).toContain('tiktok');
  });
});
