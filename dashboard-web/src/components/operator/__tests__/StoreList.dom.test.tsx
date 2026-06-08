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
    hasWebhookSecret: true,
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
    hasWebhookSecret: false,
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
    hasWebhookSecret: false,
  },
];

// zolplus-shaped fixture (mirrors the existing prod store): Shopify only, no
// Meta / Google / TikTok / webhook — the operator must be able to CONNECT them.
const ZOLPLUS: StoreRowData = {
  storeId: 'zolplus',
  name: 'Zol Plus',
  brandColor: 'var(--store-3)',
  isHeadless: false,
  hasTikTok: false,
  status: 'active',
  displayOrder: 2,
  platforms: ['shopify'],
  hasWebhookSecret: false,
};

describe('StoreList — active stores (Phase 6a Task 6)', () => {
  it('renders one row per ACTIVE store (archived excluded)', () => {
    render(<StoreList stores={STORES} onManage={vi.fn()} />);
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
    render(<StoreList stores={STORES} onManage={vi.fn()} />);
    const uzoRow = screen.getByTestId('store-row-uzoshop');
    // uzoshop is configured with all four platforms.
    expect(within(uzoRow).getByText('Shopify')).toBeDefined();
    expect(within(uzoRow).getByText('Meta')).toBeDefined();
    expect(within(uzoRow).getByText('Google')).toBeDefined();
    expect(within(uzoRow).getByText('TikTok')).toBeDefined();
  });

  it('renders a token-driven brand-color swatch per row', () => {
    render(<StoreList stores={STORES} onManage={vi.fn()} />);
    const swatch = screen.getByTestId('store-swatch-uzoshop');
    expect(swatch).toBeDefined();
    // Token-driven: the swatch background is a CSS var (no raw color literal).
    expect(swatch.getAttribute('style') ?? '').toContain('var(--store-uzo)');
  });

  it('renders a friendly Hebrew empty state when there are no active stores', () => {
    const onlyArchived: StoreRowData[] = [STORES[2]];
    render(<StoreList stores={onlyArchived} onManage={vi.fn()} />);
    expect(screen.getByText(/אין חנויות פעילות/)).toBeDefined();
    // No rows rendered.
    expect(screen.queryByTestId('store-row-oldstore')).toBeNull();
  });

  it('renders the empty state for a completely empty list too', () => {
    render(<StoreList stores={[]} onManage={vi.fn()} />);
    expect(screen.getByText(/אין חנויות פעילות/)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// D1 — the per-store CREDENTIAL MATRIX (connected / missing per platform +
// webhook). Status is NEVER colour-only: every cell carries an icon + Hebrew
// text. D2 — connect / edit-per-platform actions call onManage(storeId, focus).
// ---------------------------------------------------------------------------
describe('StoreRow — credential matrix (Phase 6a D1)', () => {
  // A store with the spec's exact mix: meta connected, google missing, tiktok
  // enabled, webhook missing.
  const MIXED: StoreRowData = {
    storeId: 'mixedstore',
    name: 'Mixed Store',
    brandColor: 'var(--store-uzo)',
    isHeadless: false,
    hasTikTok: true,
    status: 'active',
    displayOrder: 5,
    platforms: ['shopify', 'meta', 'tiktok'], // google MISSING
    hasWebhookSecret: false, // webhook MISSING
  };

  function rowFor(store: StoreRowData) {
    render(<StoreList stores={[store]} onManage={vi.fn()} />);
    return screen.getByTestId(`store-row-${store.storeId}`);
  }

  it('renders a matrix cell for all FOUR platforms + the webhook', () => {
    const row = rowFor(MIXED);
    // Each cell is identifiable by a stable test-id so the status is unambiguous.
    for (const key of ['shopify', 'meta', 'google', 'tiktok', 'webhook']) {
      expect(within(row).getByTestId(`cred-cell-mixedstore-${key}`)).toBeDefined();
    }
  });

  it('Shopify is always connected (every store has it)', () => {
    const cell = within(rowFor(MIXED)).getByTestId('cred-cell-mixedstore-shopify');
    expect(cell.getAttribute('data-status')).toBe('connected');
    // Status is NOT colour-only — a textual cue is present (icon has a label/role).
    expect(within(cell).getByText(/מחובר/)).toBeDefined();
  });

  it('Meta shows connected (✓) when present', () => {
    const cell = within(rowFor(MIXED)).getByTestId('cred-cell-mixedstore-meta');
    expect(cell.getAttribute('data-status')).toBe('connected');
    expect(within(cell).getByText(/מחובר/)).toBeDefined();
  });

  it('Google shows missing (⚠) when absent', () => {
    const cell = within(rowFor(MIXED)).getByTestId('cred-cell-mixedstore-google');
    expect(cell.getAttribute('data-status')).toBe('missing');
    expect(within(cell).getByText(/חסר/)).toBeDefined();
  });

  it('TikTok shows enabled (shared) when has_tiktok', () => {
    const cell = within(rowFor(MIXED)).getByTestId('cred-cell-mixedstore-tiktok');
    expect(cell.getAttribute('data-status')).toBe('connected');
    expect(within(cell).getByText(/מופעל/)).toBeDefined();
  });

  it('TikTok shows not-enabled (⚠) when has_tiktok is false', () => {
    const noTk: StoreRowData = { ...MIXED, storeId: 'notk', hasTikTok: false, platforms: ['shopify', 'meta'] };
    const cell = within(rowFor(noTk)).getByTestId('cred-cell-notk-tiktok');
    expect(cell.getAttribute('data-status')).toBe('missing');
    expect(within(cell).getByText(/לא מופעל/)).toBeDefined();
  });

  it('Webhook shows missing (⚠) when hasWebhookSecret is false', () => {
    const cell = within(rowFor(MIXED)).getByTestId('cred-cell-mixedstore-webhook');
    expect(cell.getAttribute('data-status')).toBe('missing');
    expect(within(cell).getByText(/חסר/)).toBeDefined();
  });

  it('Webhook shows set (✓) when hasWebhookSecret is true', () => {
    const wh: StoreRowData = { ...MIXED, storeId: 'whset', hasWebhookSecret: true };
    const cell = within(rowFor(wh)).getByTestId('cred-cell-whset-webhook');
    expect(cell.getAttribute('data-status')).toBe('connected');
    expect(within(cell).getByText(/מוגדר/)).toBeDefined();
  });

  it('status is never colour-only — every cell carries readable Hebrew status text', () => {
    const row = rowFor(MIXED);
    // Sanity: the matrix surface, not the brand badges, holds the status words.
    expect(within(row).getAllByText(/מחובר|חסר|מופעל|מוגדר/).length).toBeGreaterThanOrEqual(5);
  });
});

describe('StoreRow — connect / edit per-platform actions (Phase 6a D2)', () => {
  const MIXED: StoreRowData = {
    storeId: 'mixedstore',
    name: 'Mixed Store',
    brandColor: 'var(--store-uzo)',
    isHeadless: false,
    hasTikTok: true,
    status: 'active',
    displayOrder: 5,
    platforms: ['shopify', 'meta', 'tiktok'],
    hasWebhookSecret: false,
  };

  function setup(store: StoreRowData) {
    const onManage = vi.fn();
    render(<StoreList stores={[store]} onManage={onManage} />);
    return { onManage, row: screen.getByTestId(`store-row-${store.storeId}`) };
  }

  it('a MISSING platform shows "חבר" and calls onManage(storeId, focus)', () => {
    const { onManage, row } = setup(MIXED);
    const cell = within(row).getByTestId('cred-cell-mixedstore-google');
    fireEvent.click(within(cell).getByRole('button', { name: /חבר/ }));
    expect(onManage).toHaveBeenCalledWith('mixedstore', 'google');
  });

  it('a CONNECTED platform shows "החלף/ערוך" and calls onManage(storeId, focus)', () => {
    const { onManage, row } = setup(MIXED);
    const cell = within(row).getByTestId('cred-cell-mixedstore-meta');
    fireEvent.click(within(cell).getByRole('button', { name: /החלף|ערוך/ }));
    expect(onManage).toHaveBeenCalledWith('mixedstore', 'meta');
  });

  it('a missing webhook shows "חבר" and focuses the webhook field', () => {
    const { onManage, row } = setup(MIXED);
    const cell = within(row).getByTestId('cred-cell-mixedstore-webhook');
    fireEvent.click(within(cell).getByRole('button', { name: /חבר/ }));
    expect(onManage).toHaveBeenCalledWith('mixedstore', 'webhook');
  });

  it('a not-enabled TikTok shows "הפעל/חבר" and focuses tiktok', () => {
    const noTk: StoreRowData = { ...MIXED, storeId: 'notk', hasTikTok: false, platforms: ['shopify', 'meta'] };
    const { onManage, row } = setup(noTk);
    const cell = within(row).getByTestId('cred-cell-notk-tiktok');
    fireEvent.click(within(cell).getByRole('button', { name: /הפעל|חבר/ }));
    expect(onManage).toHaveBeenCalledWith('notk', 'tiktok');
  });

  it('Shopify connected exposes a rotate/edit action (focus shopify)', () => {
    const { onManage, row } = setup(MIXED);
    const cell = within(row).getByTestId('cred-cell-mixedstore-shopify');
    fireEvent.click(within(cell).getByRole('button', { name: /החלף|ערוך/ }));
    expect(onManage).toHaveBeenCalledWith('mixedstore', 'shopify');
  });

  it('works for the existing zolplus store: Google + TikTok are CONNECTABLE', () => {
    const { onManage, row } = setup(ZOLPLUS);
    // zolplus has only Shopify → Google + TikTok + webhook all show as missing.
    expect(within(row).getByTestId('cred-cell-zolplus-google').getAttribute('data-status')).toBe('missing');
    expect(within(row).getByTestId('cred-cell-zolplus-tiktok').getAttribute('data-status')).toBe('missing');
    expect(within(row).getByTestId('cred-cell-zolplus-webhook').getAttribute('data-status')).toBe('missing');
    // And the operator can connect Google from here.
    fireEvent.click(within(within(row).getByTestId('cred-cell-zolplus-google')).getByRole('button', { name: /חבר/ }));
    expect(onManage).toHaveBeenCalledWith('zolplus', 'google');
  });
});

// ---------------------------------------------------------------------------
// Phase 6b Task 3 — ARCHIVE action on an active row. Each active StoreRow gets
// an "העבר לארכיון" affordance that calls up via onArchive(storeId). (Reversible;
// the store then moves to the "חנויות שהוסרו" removed-area. NO delete here.)
// ---------------------------------------------------------------------------
describe('StoreRow — archive action (Phase 6b Task 3)', () => {
  const ACTIVE: StoreRowData = {
    storeId: 'uzoshop',
    name: 'uzoshop',
    brandColor: 'var(--store-uzo)',
    isHeadless: false,
    hasTikTok: true,
    status: 'active',
    displayOrder: 1,
    platforms: ['google', 'meta', 'shopify', 'tiktok'],
    hasWebhookSecret: true,
  };

  it('renders an "העבר לארכיון" action on each active row', () => {
    render(<StoreList stores={[ACTIVE]} onManage={vi.fn()} onArchive={vi.fn()} />);
    const row = screen.getByTestId('store-row-uzoshop');
    expect(within(row).getByRole('button', { name: /העבר לארכיון/ })).toBeDefined();
  });

  it('clicking "העבר לארכיון" calls onArchive(storeId)', () => {
    const onArchive = vi.fn();
    render(<StoreList stores={[ACTIVE]} onManage={vi.fn()} onArchive={onArchive} />);
    const row = screen.getByTestId('store-row-uzoshop');
    fireEvent.click(within(row).getByRole('button', { name: /העבר לארכיון/ }));
    expect(onArchive).toHaveBeenCalledWith('uzoshop');
  });

  it('does NOT render a delete affordance on the active row (delete is deferred)', () => {
    render(<StoreList stores={[ACTIVE]} onManage={vi.fn()} onArchive={vi.fn()} />);
    const row = screen.getByTestId('store-row-uzoshop');
    expect(within(row).queryByRole('button', { name: /מחק/ })).toBeNull();
  });

  it('the archive action carries an accessible name scoped to the store', () => {
    render(<StoreList stores={[ACTIVE]} onManage={vi.fn()} onArchive={vi.fn()} />);
    const row = screen.getByTestId('store-row-uzoshop');
    // Accessible name includes both the action and the store name.
    expect(within(row).getByRole('button', { name: /העבר לארכיון.*uzoshop/ })).toBeDefined();
  });
});
