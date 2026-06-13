// dashboard-web/src/components/__tests__/TabFreshnessHeader.dom.test.tsx
//
// W7-T6 (Horizon re-skin Wave 7) — DOM tests for TabFreshnessHeader's confirm
// flow. The pre-run confirm was a native `window.confirm(...)`; it is now a
// focus-trapped Radix dialog (Sheet variant="modal") with ביטול / אישור.
//
// These tests pin the converted behaviour:
//   • clicking "רענן הכל" opens a real role=dialog (NOT window.confirm) —
//     window.confirm must NOT be called.
//   • the dialog preserves the cost copy (store-count line + duration).
//   • "אישור" fires the SAME refresh() the window.confirm-true path used to.
//   • "ביטול" closes WITHOUT refreshing.
//
// useDashboardRefresh + useStores are mocked so we control refresh()/isRefreshing
// and the store count without a network round-trip.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const refreshMock = vi.fn();
let isRefreshing = false;

vi.mock('@/lib/useDashboardRefresh', () => ({
  useDashboardRefresh: () => ({ isRefreshing, refresh: refreshMock }),
}));

vi.mock('@/lib/useStores', () => ({
  useStores: () => ({
    stores: [
      { storeId: 'uzoshop', storeName: 'uzoshop' },
      { storeId: 'zolplus', storeName: 'Zol Plus' },
      { storeId: 'usmile360', storeName: '360usmile' },
    ],
  }),
}));

import { TabFreshnessHeader } from '../TabFreshnessHeader';

beforeEach(() => {
  cleanup();
  refreshMock.mockReset();
  isRefreshing = false;
});

describe('<TabFreshnessHeader> confirm flow', () => {
  it('clicking "רענן הכל" opens a Radix dialog, NOT window.confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<TabFreshnessHeader dataLastWriteAt={new Date().toISOString()} />);

    // No dialog before the click.
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'רענן את כל הדשבורד' }));

    // A real role=dialog appears (focus-trapped Radix), and window.confirm is
    // NEVER consulted.
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeTruthy();
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('the dialog preserves the cost copy (dynamic store count + duration)', async () => {
    render(<TabFreshnessHeader dataLastWriteAt={new Date().toISOString()} />);
    fireEvent.click(screen.getByRole('button', { name: 'רענן את כל הדשבורד' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('רענון מלא ירוץ עכשיו?');
    // Dynamic store count (3 mocked stores) is interpolated, not a stale literal.
    expect(dialog.textContent).toContain('3 החנויות');
    // The honest duration figure survives.
    expect(dialog.textContent).toContain('60-120 שניות');
  });

  it('"אישור" fires refresh() exactly once', async () => {
    render(<TabFreshnessHeader dataLastWriteAt={new Date().toISOString()} />);
    fireEvent.click(screen.getByRole('button', { name: 'רענן את כל הדשבורד' }));

    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'אישור' }));

    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('"ביטול" closes the dialog WITHOUT refreshing', async () => {
    render(<TabFreshnessHeader dataLastWriteAt={new Date().toISOString()} />);
    fireEvent.click(screen.getByRole('button', { name: 'רענן את כל הדשבורד' }));

    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'ביטול' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
