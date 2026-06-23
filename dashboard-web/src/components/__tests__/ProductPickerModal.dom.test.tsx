// dashboard-web/src/components/__tests__/ProductPickerModal.dom.test.tsx
//
// Regression guard for the 2026-06-03 "can't search / can't map products"
// bug (every campaign + platform). ROOT CAUSE: the picker opens ON TOP of
// the CampaignDrawer, which is a MODAL Radix dialog (Sheet). A modal Radix
// dialog marks everything outside its content `aria-hidden` +
// `pointer-events:none` (inert). The picker used to be a hand-rolled
// `<div className="fixed …">` — outside that scope — so it rendered VISIBLE
// but DEAD to clicks/typing. The fix routes it through the shared `Sheet`
// primitive so it's a real NESTED Radix dialog that escapes the parent's
// inert scope.
//
// jsdom does NOT compute `inert` / `pointer-events`, so a behavioural test
// can't reproduce the dead-clicks symptom directly. Instead we assert the
// STRUCTURAL invariant that prevents the regression: the picker renders
// through Radix (role="dialog" + the Radix `data-state` marker), NOT a plain
// div. Plus functional smoke (search filters, toggle selects, save emits).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const CATALOG_ROWS = [
  { storeId: 'uzoshop', productId: 'p-alpha', title: 'Alpha Mascara' },
  { storeId: 'uzoshop', productId: 'p-beta', title: 'Beta Overol' },
  { storeId: 'other', productId: 'p-gamma', title: 'Gamma (wrong store)' },
];
const SALES_ROWS = [
  { storeId: 'uzoshop', productId: 'p-alpha', units: 5, revenue: 200, netRevenue: 190, productTitle: 'Alpha Mascara' },
];

// Mock SWR's default export so the picker gets deterministic catalog/sales
// data synchronously (no fetch/waitFor flakiness).
vi.mock('swr', () => ({
  default: (key: string | null) => {
    if (key === '/api/product-catalog') {
      return { data: { rows: CATALOG_ROWS, lastUpdated: '' }, isLoading: false };
    }
    if (key === '/api/products') {
      return { data: { rows: SALES_ROWS, lastUpdated: '', dataLastWriteAt: null }, isLoading: false };
    }
    return { data: undefined, isLoading: false };
  },
}));

import { ProductPickerModal } from '@/components/ProductPickerModal';

function renderPicker(overrides: Partial<React.ComponentProps<typeof ProductPickerModal>> = {}) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(
    <ProductPickerModal
      open
      onClose={onClose}
      storeId="uzoshop"
      storeName="UZOSHOP"
      campaignName="יונים בטיקטוק"
      initial={[]}
      onSave={onSave}
      {...overrides}
    />,
  );
  return { onSave, onClose };
}

describe('<ProductPickerModal> — interactive nested dialog (anti-inert regression guard)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders through Radix (role=dialog + data-state) — NOT a hand-rolled inert div', () => {
    renderPicker();
    const dialog = screen.getByRole('dialog');
    // Radix Dialog.Content stamps a `data-state` attribute. A plain
    // hand-rolled <div role="dialog"> would not — this is what guards
    // against regressing to the inert overlay.
    expect(dialog.getAttribute('data-state')).toBe('open');
  });

  it('does not render any dialog when open=false', () => {
    renderPicker({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lists the store catalog products and excludes other stores', () => {
    renderPicker();
    expect(screen.getByText('Alpha Mascara')).toBeInTheDocument();
    expect(screen.getByText('Beta Overol')).toBeInTheDocument();
    expect(screen.queryByText('Gamma (wrong store)')).toBeNull();
  });

  it('filters the list as the operator types in the search box', () => {
    renderPicker();
    const search = screen.getByPlaceholderText('חפש מוצר…');
    fireEvent.change(search, { target: { value: 'beta' } });
    expect(screen.queryByText('Alpha Mascara')).toBeNull();
    expect(screen.getByText('Beta Overol')).toBeInTheDocument();
  });

  it('toggles selection on click (the "X נבחרו" counter updates)', () => {
    renderPicker();
    fireEvent.click(screen.getByText('Alpha Mascara').closest('button')!);
    expect(screen.getByText('1')).toBeInTheDocument(); // <strong>1</strong> נבחרו
  });

  it('emits the selected ids on save and closes', () => {
    const { onSave, onClose } = renderPicker();
    fireEvent.click(screen.getByText('Alpha Mascara').closest('button')!);
    fireEvent.click(screen.getByRole('button', { name: /שמור/ }));
    expect(onSave).toHaveBeenCalledWith(['p-alpha']);
    expect(onClose).toHaveBeenCalled();
  });
});

describe('<ProductPickerModal> — ad-set scope (2026-06-23)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('campaign scope (no adSetName): header names the CAMPAIGN, not an ad-set', () => {
    renderPicker({ campaignName: 'קמפיין ראשי' });
    // Campaign-level header copy ("…לקמפיין") is unchanged (sr-only title +
    // the visible uppercase label both carry it).
    expect(screen.getAllByText(/לקמפיין/).length).toBeGreaterThan(0);
    // The ad-set-scope label is absent.
    expect(screen.queryByText(/לאד-סט/)).toBeNull();
  });

  it('ad-set scope (adSetName present): header names the AD-SET being mapped', () => {
    renderPicker({ campaignName: 'קמפיין ראשי', adSetId: 'as-7', adSetName: 'אד-סט נשים 25-34' });
    // Ad-set scope header copy mentions the ad-set (sr-only + visible label).
    expect(screen.getAllByText(/לאד-סט/).length).toBeGreaterThan(0);
    // The ad-set name is shown in the title block.
    expect(screen.getByText('אד-סט נשים 25-34')).toBeInTheDocument();
  });

  it('ad-set scope: initial selection seeds from the ad-set own mapping (passed via initial)', () => {
    renderPicker({ adSetId: 'as-7', adSetName: 'AS 7', initial: ['p-alpha'] });
    // p-alpha pre-selected → counter shows 1.
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('Alpha Mascara').closest('button')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('ad-set scope: save emits the selected ids (parent routes to setMappedProductsForAdSet)', () => {
    const { onSave, onClose } = renderPicker({ adSetId: 'as-7', adSetName: 'AS 7', initial: [] });
    fireEvent.click(screen.getByText('Beta Overol').closest('button')!);
    fireEvent.click(screen.getByRole('button', { name: /שמור/ }));
    expect(onSave).toHaveBeenCalledWith(['p-beta']);
    expect(onClose).toHaveBeenCalled();
  });
});
