// @vitest-environment jsdom
//
// DQ-1 ReconcilePanel — operator data-quality surface (Wave 3 data-trust).
//
// Self-fetches GET /api/operator/reconcile (same `ReconcileResponse` the Home
// ReconcileBanner consumes). Two states from the mockup
// (docs/superpowers/mockups/2026-06-04-data-trust/data-trust.html):
//   • violations.length === 0 → calm green "✓ הכל תואם — כל הבדיקות עברו".
//   • violations.length  >  0 → a TableBase of
//       בדיקה · חנות·פלטפורמה · תאריך · צפוי · בפועל · פער
//     numeric cells right-aligned through <Money>, delta in text-status-warningFg.
//
// SWR cache is isolated per-render via SWRConfig + new Map(); fetch is stubbed.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, waitFor, screen, fireEvent, act } from '@testing-library/react';
import { SWRConfig } from 'swr';

vi.mock('@/lib/hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('@/lib/cloudSync', () => ({ pushCloudKey: vi.fn() }));

import { ReconcilePanel } from '@/components/operator/ReconcilePanel';
import type { ReconcileResponse } from '@/app/api/reconcile/route';
import { readReconcileAcks } from '@/lib/reconcileAckStore';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
beforeEach(() => { window.localStorage.clear(); });

function stubFetch(body: ReconcileResponse) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => body } as unknown as Response)),
  );
}

function renderPanel() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ReconcilePanel />
    </SWRConfig>,
  );
}

describe('ReconcilePanel (DQ-1)', () => {
  it('renders the calm green all-clear line when there are no violations', async () => {
    stubFetch({ violations: [] });
    renderPanel();

    const ok = await screen.findByText(/הכל תואם/);
    expect(ok).toBeInTheDocument();
    // green on-color foreground token (never a text-color-from-band) — lives on
    // the coloured container wrapping the all-clear line.
    expect(ok.closest('[class*="text-status-greenFg"]')).not.toBeNull();
    // No mismatch table when everything agrees.
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('renders a row per violation with the check, the expected/actual values, and the delta', async () => {
    stubFetch({
      violations: [
        {
          label: 'INV-7 Meta spend 30/05/uzoshop',
          detail: 'data_daily 1204 vs campaigns_daily 1180',
        },
        {
          label: 'INV-10 orders vs data revenue 30/05/zolplus',
          detail: 'data_daily 3010 vs orders_attribution 3142',
        },
      ],
    });
    renderPanel();

    // Table appears (not the all-clear line).
    const table = await screen.findByRole('table');
    expect(table).toBeInTheDocument();
    expect(screen.queryByText(/הכל תואם/)).not.toBeInTheDocument();

    // Both checks rendered.
    expect(screen.getByText(/INV-7/)).toBeInTheDocument();
    expect(screen.getByText(/INV-10/)).toBeInTheDocument();

    // store·platform parsed out of the label.
    expect(screen.getByText(/uzoshop/)).toBeInTheDocument();
    expect(screen.getByText(/zolplus/)).toBeInTheDocument();

    // Expected / actual Money values present (bare grouped, no currency prefix).
    expect(screen.getByText('1,204')).toBeInTheDocument();
    expect(screen.getByText('1,180')).toBeInTheDocument();
    expect(screen.getByText('3,010')).toBeInTheDocument();
    expect(screen.getByText('3,142')).toBeInTheDocument();

    // Delta cells, warning-foreground coloured. INV-7: 1180-1204 = −24 (typographic minus).
    const delta = screen.getByText('−24');
    expect(delta).toBeInTheDocument();
    // The coloured wrapper carries the on-color warning token.
    const coloured = delta.closest('[class*="text-status-warningFg"]');
    expect(coloured).not.toBeNull();
  });

  it('does not crash and shows the all-clear line while the first fetch is pending / null', async () => {
    // fetch never resolves a body with violations → fetchJsonOrNull may yield null.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) } as unknown as Response)));
    renderPanel();
    // Soft path: null data is treated as "no known violations" → calm line.
    await waitFor(() => expect(screen.getByText(/הכל תואם/)).toBeInTheDocument());
  });

  it('marking a finding reviewed hides exactly that row and persists the ack', async () => {
    stubFetch({
      violations: [
        { label: 'INV-7 Meta spend 2026-06-22/uzoshop', detail: 'data_daily 1204 vs campaigns_daily 1180' },
        { label: 'INV-10 orders vs data revenue 2026-06-22/zolplus', detail: 'data_daily 3010 vs orders_attribution 3142' },
      ],
    });
    renderPanel();

    await screen.findByText(/INV-7/);
    expect(screen.getByText(/INV-10/)).toBeInTheDocument();

    // One ack button per material row. Click the first (the INV-7/uzoshop row).
    const ackButtons = screen.getAllByRole('button', { name: /סמן כנבדק/ });
    expect(ackButtons.length).toBe(2);
    act(() => { fireEvent.click(ackButtons[0]); });

    // INV-7 row gone; INV-10 sibling still shown.
    await waitFor(() => expect(screen.queryByText(/INV-7/)).not.toBeInTheDocument());
    expect(screen.getByText(/INV-10/)).toBeInTheDocument();

    // Ack persisted to the cloud-synced store under the INV-7 fingerprint.
    const acks = readReconcileAcks();
    expect(acks['INV-7 Meta spend::uzoshop::Meta::2026-06-22']).toBeDefined();
  });

  it('the "show reviewed" toggle reveals acked rows with an un-ack control that restores them', async () => {
    stubFetch({
      violations: [
        { label: 'INV-10 orders vs data revenue 2026-06-22/uzoshop', detail: 'data_daily 3010 vs orders_attribution 3142' },
      ],
    });
    renderPanel();

    await screen.findByText(/INV-10/);
    act(() => { fireEvent.click(screen.getByRole('button', { name: /סמן כנבדק/ })); });

    // Row hidden; a "show reviewed (1)" toggle appears.
    await waitFor(() => expect(screen.queryByText(/INV-10/)).not.toBeInTheDocument());
    const toggle = screen.getByRole('button', { name: /הצג שנבדקו/ });
    expect(toggle.textContent ?? '').toMatch(/1/);

    // Expand → the acked row + its un-ack control are shown.
    act(() => { fireEvent.click(toggle); });
    expect(screen.getByText(/INV-10/)).toBeInTheDocument();
    const undo = screen.getByRole('button', { name: /בטל סימון/ });
    expect(undo).toBeInTheDocument();

    // Un-ack restores it to the active list.
    act(() => { fireEvent.click(undo); });
    await waitFor(() => {
      expect(readReconcileAcks()['INV-10 orders vs data revenue::uzoshop::::2026-06-22']).toBeUndefined();
    });
    expect(screen.getByRole('button', { name: /סמן כנבדק/ })).toBeInTheDocument();
  });
});
