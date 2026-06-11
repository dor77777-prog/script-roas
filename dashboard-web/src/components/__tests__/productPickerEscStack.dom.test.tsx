// dashboard-web/src/components/__tests__/productPickerEscStack.dom.test.tsx
//
// 2026-06-11 adversarial-review fix — Esc one-keystroke-one-dismissal parity
// for the ProductPickerModal (the wave-8A item-1 contract missed it).
//
// Pre-fix: the picker is a nested Radix dialog (Sheet variant="modal") that
// opens OVER the CampaignDrawer and relies on Radix's DEFAULT Esc-dismiss
// (no preventDefault — see the 2026-06-03 nested-dialog incident comment in
// ProductPickerModal.tsx; it must STAY a nested Radix dialog). Sequence on
// one Esc: Radix (document capture, picker = highest layer) dismissed the
// picker, then the SAME unmarked keydown bubbled to the shared drawer-stack
// window listener which closed the top stack entry = the CampaignDrawer.
// One Esc collapsed BOTH layers (#WR-01 class).
//
// Post-fix: the picker marks the events it consumes
// (`onEscapeKeyDown={markEscHandledByInnerLayer}` — same contract as
// ui/tooltip/RichSheet.tsx), so the drawer-stack listener skips them:
//   Esc #1 → closes ONLY the picker; the CampaignDrawer survives.
//   Esc #2 → closes the CampaignDrawer.
//
// Harness copied from adsOverModalStack.dom.test.tsx (the AdsDrawer-over-
// CampaignDrawer Esc test); Esc is dispatched on document.body exactly like
// escDoubleDismiss.dom.test.tsx so Radix's document CAPTURE listener runs
// first, then the drawer stack's window BUBBLE listener — same order as a
// real keystroke.

import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

// Keep all SWR fetches null so we don't stub the network (matches
// adsOverModalStack.dom.test.tsx). Both the drawer and the picker handle
// undefined data (the picker shows its empty state — irrelevant here, the
// test only exercises the Esc layering).
vi.mock('swr', () => ({
  default: () => ({ data: undefined, isLoading: false, error: undefined, mutate: vi.fn() }),
}));

vi.mock('@/lib/cloudSync', () => ({
  pushCloudKey: vi.fn(),
  pullCloudKey: vi.fn(),
  syncAll: vi.fn(),
}));

vi.mock('@/lib/campaignStoreMap', () => ({
  readCampaignStoreMap: () => ({}),
  writeCampaignStoreMap: vi.fn(),
  campaignStoreKey: (a: string, b: string, c: string) => `${a}::${b}::${c}`,
  resolveStoreForCampaign: vi.fn(() => null),
}));

vi.mock('@/lib/campaignProductMap', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    readProductMap: () => ({}),
    setMappedProducts: vi.fn(),
  };
});

import { CampaignDrawer } from '@/components/CampaignDrawer';
import type { CampaignRow } from '@/lib/campaigns';

function makeRow(overrides: Partial<CampaignRow> = {}): CampaignRow {
  return {
    date: '2026-05-30',
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    platform: 'Meta',
    campaignId: 'cmp-esc',
    campaignName: 'Esc Stack Campaign',
    adSetId: 'adset-1',
    adSetName: 'Ad Set One',
    spend: 100,
    impressions: 1000,
    clicks: 50,
    conversions: 5,
    conversionValue: 280,
    campaignBudgetCad: null,
    adSetBudgetCad: null,
    budgetType: '',
    effectiveStatus: 'ACTIVE',
    lastLiveTickAt: null,
    regConfiguredStatus: null,
    regEffectiveStatus: null,
    regDeliveryStatus: null,
    regFirstSeenAt: null,
    regStatusChangedAt: null,
    regLastStatusSuccessAt: null,
    ...overrides,
  };
}

function openModal() {
  const onClose = vi.fn();
  render(
    <CampaignDrawer
      open
      onClose={onClose}
      rows={[makeRow()]}
      campaignId="cmp-esc"
      storeId="uzoshop"
      adAccounts={{}}
      rangeFrom="2026-05-01"
      rangeTo="2026-05-30"
    />,
  );
  return { onClose };
}

// Open the picker from the Overview tab (default tab): the mapped-products
// accordion renders the "שייך מוצרים" button (no mapped ids → that label).
// The accordion is a <details>; jsdom keeps its content reachable.
function openPicker() {
  const btn = screen.getByRole('button', { name: /שייך מוצרים/ });
  act(() => {
    fireEvent.click(btn);
  });
}

/** Dispatch a document-level Escape exactly like a real keystroke: Radix's
 *  capture listener on `document` runs first, then the drawer stack's window
 *  bubble listener (same helper as escDoubleDismiss.dom.test.tsx). */
function pressEscape() {
  act(() => {
    fireEvent.keyDown(document.body, { key: 'Escape' });
  });
}

/** The picker's search box only exists while the nested dialog is open. */
function pickerIsOpen(): boolean {
  return screen.queryByPlaceholderText('חפש מוצר…') !== null;
}

describe('ProductPickerModal over the Campaign modal — Esc closes ONE layer per keystroke', () => {
  it('Esc #1 closes ONLY the picker (drawer survives); Esc #2 closes the drawer', async () => {
    const { onClose } = openModal();
    expect(screen.getByTestId('campaign-drawer-hero')).toBeInTheDocument();

    openPicker();
    await waitFor(() => {
      expect(pickerIsOpen()).toBe(true);
    });

    // Esc #1 — Radix dismisses the picker (highest layer); the marked event
    // must NOT also pop the drawer stack.
    pressEscape();
    await waitFor(() => {
      expect(pickerIsOpen()).toBe(false);
    });
    expect(screen.getByTestId('campaign-drawer-hero')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    // Esc #2 — now the CampaignDrawer is addressed (drawer stack top).
    pressEscape();
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('with the picker closed, a single Esc still closes the drawer (marker never leaks)', async () => {
    const { onClose } = openModal();
    expect(screen.getByTestId('campaign-drawer-hero')).toBeInTheDocument();

    // Open + close the picker via its cancel button first, so any stale
    // marker state from the picker's lifecycle would be exposed.
    openPicker();
    await waitFor(() => expect(pickerIsOpen()).toBe(true));
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'ביטול' }));
    });
    await waitFor(() => expect(pickerIsOpen()).toBe(false));

    pressEscape();
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
