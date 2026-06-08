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
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';

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

  it('renders a "מחק לצמיתות" destructive affordance per removed store when onDelete is wired (Phase 6b T3-delete)', () => {
    render(<RemovedStores stores={STORES} onRestore={vi.fn()} onDelete={vi.fn()} />);
    const row = screen.getByTestId('removed-store-row-oldstore');
    expect(within(row).getByRole('button', { name: /מחק לצמיתות.*Old Store/ })).toBeDefined();
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

// ---------------------------------------------------------------------------
// Phase 6b T3-delete — the IRREVERSIBLE delete-confirm modal.
//
// Clicking "מחק לצמיתות" on an archived row opens a Radix Dialog (role=dialog,
// per the modal-over-Sheet rule — a hand-rolled overlay would be inert). The
// modal makes the irreversibility unmistakable, lists what gets wiped, and the
// confirm button is DISABLED until the operator types the EXACT store name. On
// confirm it calls onDelete(storeId, confirmName); on the returned ok it closes,
// on a returned error it stays open + shows the message.
// ---------------------------------------------------------------------------
describe('RemovedStores — delete-confirm modal (Phase 6b T3-delete)', () => {
  function openDeleteModal(name = 'Old Store') {
    const row = screen.getByTestId('removed-store-row-oldstore');
    fireEvent.click(within(row).getByRole('button', { name: new RegExp(`מחק לצמיתות.*${name}`) }));
  }

  it('opens a REAL dialog (role=dialog) when "מחק לצמיתות" is clicked', async () => {
    render(<RemovedStores stores={STORES} onRestore={vi.fn()} onDelete={vi.fn()} />);
    openDeleteModal();
    // A real Radix dialog — NOT a hand-rolled inert overlay div.
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeDefined();
    // The destructive, irreversible copy is present.
    expect(within(dialog).getByText(/מחיקת חנות לצמיתות/)).toBeDefined();
    expect(within(dialog).getByText(/בלתי-הפיכה/)).toBeDefined();
  });

  it('keeps the confirm DISABLED until the typed name EXACTLY matches', async () => {
    render(<RemovedStores stores={STORES} onRestore={vi.fn()} onDelete={vi.fn()} />);
    openDeleteModal();
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: /מחק לצמיתות/ }) as HTMLButtonElement;
    const input = within(dialog).getByLabelText(/הקלד את שם החנות/) as HTMLInputElement;

    // Empty → disabled.
    expect(confirm.disabled).toBe(true);
    // Wrong → still disabled.
    fireEvent.change(input, { target: { value: 'Old Stor' } });
    expect(confirm.disabled).toBe(true);
    // A leading/trailing mismatch → still disabled (exact === only).
    fireEvent.change(input, { target: { value: 'old store' } });
    expect(confirm.disabled).toBe(true);
    // Exact → enabled.
    fireEvent.change(input, { target: { value: 'Old Store' } });
    expect(confirm.disabled).toBe(false);
  });

  it('on confirm calls onDelete with the id + {confirmName}, then closes on ok', async () => {
    const onDelete = vi.fn(async () => ({ ok: true as const }));
    render(<RemovedStores stores={STORES} onRestore={vi.fn()} onDelete={onDelete} />);
    openDeleteModal();
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/הקלד את שם החנות/), {
      target: { value: 'Old Store' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /מחק לצמיתות/ }));

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('oldstore', 'Old Store'));
    // On success the dialog closes.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps the modal OPEN and shows the server error when onDelete reports a failure (e.g. 409)', async () => {
    const onDelete = vi.fn(async () => ({ ok: false as const, error: 'archive the store before deleting it' }));
    render(<RemovedStores stores={STORES} onRestore={vi.fn()} onDelete={onDelete} />);
    openDeleteModal();
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/הקלד את שם החנות/), {
      target: { value: 'Old Store' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /מחק לצמיתות/ }));

    await waitFor(() => expect(onDelete).toHaveBeenCalled());
    // Dialog stays open and surfaces the server error (role=alert).
    expect(await screen.findByRole('alert')).toBeDefined();
    expect(screen.getByText(/archive the store before deleting it/)).toBeDefined();
    expect(screen.getByRole('dialog')).toBeDefined();
  });

  it('cancel ("ביטול") closes the modal without calling onDelete', async () => {
    const onDelete = vi.fn();
    render(<RemovedStores stores={STORES} onRestore={vi.fn()} onDelete={onDelete} />);
    openDeleteModal();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /ביטול/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('no delete affordance is rendered when onDelete is omitted (back-compat)', () => {
    render(<RemovedStores stores={STORES} onRestore={vi.fn()} />);
    const row = screen.getByTestId('removed-store-row-oldstore');
    expect(within(row).queryByRole('button', { name: /מחק לצמיתות/ })).toBeNull();
  });
});
