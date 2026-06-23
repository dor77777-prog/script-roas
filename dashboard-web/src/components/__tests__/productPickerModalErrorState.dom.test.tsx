// dashboard-web/src/components/__tests__/productPickerModalErrorState.dom.test.tsx
//
// P1-4e (2026-06-10 state-honesty sweep) — ProductPickerModal error surfacing.
//
// Pre-fix both fetchers swallowed `!r.ok` and returned `{ rows: [] }`:
//   • a real API failure rendered "אין מוצרים זמינים לחנות הזאת. ודא
//     ש-products-daily מאוכלס." — sending the operator to debug the WRONG
//     table for a server failure;
//   • a failed catalog fetch raised the misleading "הקטלוג עוד לא סונכרן"
//     sync-now banner.
// Now the fetchers throw and the picker renders an explicit role=alert strip
// with retry; the empty copy is reserved for settled SUCCESS.
//
// Mock pattern mirrors ProductPickerModal.dom.test.tsx (per-key swr stub).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

type SwrState = { data?: unknown; isLoading: boolean; error?: unknown; mutate?: () => void };
let catalogState: SwrState = { data: undefined, isLoading: false };
let salesState: SwrState = { data: undefined, isLoading: false };

vi.mock('swr', () => ({
  default: (key: string | null) => {
    if (key === '/api/product-catalog') return catalogState;
    if (typeof key === 'string' && key.startsWith('/api/products')) return salesState;
    return { data: undefined, isLoading: false };
  },
}));

import { ProductPickerModal } from '@/components/ProductPickerModal';

function renderPicker() {
  render(
    <ProductPickerModal
      open
      onClose={vi.fn()}
      storeId="uzoshop"
      storeName="UZOSHOP"
      campaignName="קמפיין בדיקה"
      initial={[]}
      onSave={vi.fn()}
    />,
  );
}

describe('<ProductPickerModal> — P1-4e error surfacing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    catalogState = { data: undefined, isLoading: false };
    salesState = { data: undefined, isLoading: false };
  });

  it('a failed catalog fetch renders the role=alert strip — NOT the "products-daily" empty copy, NOT the sync-now banner', () => {
    catalogState = { data: undefined, isLoading: false, error: new Error('catalog 500'), mutate: vi.fn() };
    salesState = { data: { rows: [], lastUpdated: '', dataLastWriteAt: null }, isLoading: false, mutate: vi.fn() };
    renderPicker();

    const alert = screen.getByTestId('product-picker-error');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toContain('/api/product-catalog');
    expect(alert.textContent).toContain('catalog 500');
    expect(screen.getByRole('button', { name: /נסה שוב/ })).toBeInTheDocument();
    // The wrong-table debug copy must not render…
    expect(screen.queryByText(/ודא ש-products-daily מאוכלס/)).toBeNull();
    // …and neither does the misleading "catalog not synced yet" banner.
    expect(screen.queryByText(/הקטלוג עוד לא סונכרן/)).toBeNull();
  });

  it('a failed sales fetch (catalog ok but empty for the store) also renders the strip, naming /api/products', () => {
    catalogState = { data: { rows: [], lastUpdated: '' }, isLoading: false, mutate: vi.fn() };
    salesState = { data: undefined, isLoading: false, error: new Error('products 500'), mutate: vi.fn() };
    renderPicker();

    const alert = screen.getByTestId('product-picker-error');
    expect(alert.textContent).toContain('/api/products');
    expect(screen.queryByText(/ודא ש-products-daily מאוכלס/)).toBeNull();
  });

  it('settled SUCCESS with zero products still shows the legitimate empty copy (no error strip)', () => {
    catalogState = { data: { rows: [], lastUpdated: '' }, isLoading: false, mutate: vi.fn() };
    salesState = { data: { rows: [], lastUpdated: '', dataLastWriteAt: null }, isLoading: false, mutate: vi.fn() };
    renderPicker();

    expect(screen.getByText(/אין מוצרים זמינים לחנות הזאת/)).toBeInTheDocument();
    expect(screen.queryByTestId('product-picker-error')).toBeNull();
  });
});
