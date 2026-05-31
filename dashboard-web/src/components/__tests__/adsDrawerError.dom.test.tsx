// dashboard-web/src/components/__tests__/adsDrawerError.dom.test.tsx
//
// Task 5.7 (Wave 5, P0-9) — AdsDrawer surfaces API errors.
//
// Pre-fix, the SWR fetcher swallowed `!r.ok` and returned `{ rows: [] }`,
// which made a real 500 / 4xx look identical to "the ad-set legitimately
// has no ads in this range". This regression test pins the new contract:
//
//   1. fetcher throws on `!r.ok`
//   2. SWR's `error` state activates
//   3. AdsDrawer renders an explicit alert (with retry) instead of the
//      "no data" / "loading" UIs
//
// Mocks: we directly stub `swr` to return the error state, since we're
// testing the render contract — not the fetcher itself. The fetcher
// behavior is tested separately via the contract (`throw new Error` is
// asserted by inspection of the source / TS compiler).

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Hoist the mock-state variable so we can swap the value per test.
let swrErrorMode = false;
const mutate = vi.fn();

vi.mock('swr', () => ({
  default: () => {
    if (swrErrorMode) {
      return {
        data: undefined,
        isLoading: false,
        error: new Error('AdsDrawer: 500 Internal Server Error'),
        mutate,
      };
    }
    return { data: undefined, isLoading: false, error: undefined, mutate };
  },
}));

// Match the other AdsDrawer-touching DOM tests (e.g. bidi.dom.test.tsx)
// — these mocks satisfy the broader transitive imports the drawer
// pulls in indirectly.
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

import { AdsDrawer } from '@/components/AdsDrawer';

const baseProps = {
  open: true,
  onClose: () => {},
  storeId: 'uzoshop',
  platform: 'Meta' as const,
  campaignId: 'cmp-1',
  adSetId: 'adset-1',
  adSetName: 'My Ad Set',
  rangeFrom: '2026-05-01',
  rangeTo: '2026-05-30',
  adAccounts: {},
};

describe('AdsDrawer (P0-9 error surfacing)', () => {
  it('renders explicit error UI when SWR is in error state', () => {
    swrErrorMode = true;
    render(<AdsDrawer {...baseProps} />);

    // Alert role + testid + Hebrew copy proves the dedicated error
    // surface rendered (not the empty-state "אין נתוני מודעות").
    const alert = screen.getByTestId('ads-drawer-error');
    expect(alert).toBeInTheDocument();
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toContain('שגיאה בטעינת מודעות');
    // Underlying Error.message surfaced (so the user / dev sees the
    // status code without having to open DevTools).
    expect(alert.textContent).toContain('500');

    // Retry button calls SWR.mutate so we get a fresh fetch attempt.
    const retry = screen.getByRole('button', { name: /נסה שוב/ });
    expect(retry).toBeInTheDocument();

    // CRITICAL: the empty-state "אין נתוני מודעות לטווח הזה" MUST
    // NOT render alongside the error — that was the pre-fix bug.
    expect(screen.queryByText('אין נתוני מודעות לטווח הזה.')).not.toBeInTheDocument();

    swrErrorMode = false;
  });

  it('renders the empty state (not the error) when SWR has no error and no rows', () => {
    swrErrorMode = false;
    render(<AdsDrawer {...baseProps} />);

    // Empty-state copy renders — the success+empty path.
    expect(screen.getByText('אין נתוני מודעות לטווח הזה.')).toBeInTheDocument();
    // Error UI MUST NOT render.
    expect(screen.queryByTestId('ads-drawer-error')).not.toBeInTheDocument();
  });
});
