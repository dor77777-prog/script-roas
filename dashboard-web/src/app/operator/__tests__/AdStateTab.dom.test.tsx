// dashboard-web/src/app/operator/__tests__/AdStateTab.dom.test.tsx
//
// Self-serve stores — AdStateTab must derive TikTok membership from the live
// store list (stores.has_tiktok via useStores), NOT a hardcoded set, so a 4th
// store with has_tiktok=true renders a TikTok toggle in 'מצב פרסום'.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

vi.mock('@/lib/operatorClient', () => ({
  operatorFetch: vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ map: {} }) })),
}));

// useStores → the 4th store carries hasTikTok=true.
vi.mock('@/lib/useStores', () => ({
  useStores: () => ({
    stores: [
      { storeId: 'pdrn-skin', storeName: 'pdrn skin', brandColor: 'var(--store-7)', isHeadless: true, hasTikTok: true, status: 'active', displayOrder: 4, enableCustomerJourney: false },
    ],
  }),
}));

import { AdStateTab } from '../AdStateTab';

beforeEach(() => {
  // /api/store-meta returns the 4th store with Meta + TikTok creds present.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        rows: [
          { storeId: 'pdrn-skin', storeName: 'pdrn skin', metaAdAccountId: '9', googleAdsCustomerId: null, tiktokAdvertiserId: '7012345', planDisplayName: '', shopifyPlus: false, partnerDevelopment: false, updatedAt: null, lastError: null },
        ],
      }),
    })) as unknown as typeof fetch,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AdStateTab — self-serve TikTok membership', () => {
  it('renders a TikTok toggle for a 4th store with has_tiktok=true', async () => {
    render(<AdStateTab />);
    // The TikTok cell is applicable (membership from useStores) → a toggle, not
    // the "לא מחובר" not-connected hint.
    await waitFor(() => {
      expect(screen.getByTestId('toggle-pdrn-skin-tiktok')).toBeTruthy();
    });
    // Sanity: the store row rendered under its DISPLAY name.
    expect(screen.getByText('pdrn skin')).toBeTruthy();
  });
});
