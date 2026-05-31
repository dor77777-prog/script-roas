// dashboard-web/src/lib/hooks/__tests__/useStoreAdAccounts.dom.test.tsx
//
// Task 5.6 (Wave 5) — useStoreAdAccounts AdAccountMap shape.
//
// The hook reads /api/store-meta via SWR and reshapes the response into
// the canonical `AdAccountMap` keyed by storeId. The reshape is the
// only piece of real logic in the hook (the SWR call is dedup'd
// globally); we pin it so a future schema change at /api/store-meta
// can't silently drop a field and leave the deep-link URLs missing the
// account id (which would land operators on the wrong account but
// otherwise look successful).

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

// Mock SWR to return a deterministic store-meta response — same pattern
// CampaignDrawer tests use to avoid live network.
const mockResponse = {
  rows: [
    {
      storeId: 'store-uzo',
      metaAdAccountId: 'act_123',
      googleAdsCustomerId: '999-111-2222',
      tiktokAdvertiserId: null,
    },
    {
      storeId: 'store-usmile',
      metaAdAccountId: null,
      googleAdsCustomerId: null,
      tiktokAdvertiserId: '987654',
    },
  ],
};

vi.mock('swr', () => ({
  default: () => ({ data: mockResponse, isLoading: false }),
}));

import { useStoreAdAccounts } from '../useStoreAdAccounts';
import type { AdAccountMap } from '@/lib/campaignsLinks';

function Capture({ onMap }: { onMap: (m: AdAccountMap) => void }) {
  const map = useStoreAdAccounts();
  onMap(map);
  return null;
}

describe('useStoreAdAccounts', () => {
  it('reshapes /api/store-meta rows into a storeId-keyed AdAccountMap', () => {
    let captured: AdAccountMap | null = null;
    render(<Capture onMap={(m) => { captured = m; }} />);

    expect(captured).not.toBeNull();
    expect(captured).toEqual({
      'store-uzo': {
        metaAdAccountId: 'act_123',
        googleAdsCustomerId: '999-111-2222',
        tiktokAdvertiserId: null,
      },
      'store-usmile': {
        metaAdAccountId: null,
        googleAdsCustomerId: null,
        tiktokAdvertiserId: '987654',
      },
    });
  });
});
