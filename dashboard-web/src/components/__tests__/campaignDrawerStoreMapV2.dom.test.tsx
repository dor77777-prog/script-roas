// dashboard-web/src/components/__tests__/campaignDrawerStoreMapV2.dom.test.tsx
//
// Phase A.5 v2 — CampaignDrawer Store mapping section + product-map migration.
//
// Strategy: minimal-section-render (approach a).
// The full CampaignDrawer needs ~15 SWR mocks + Next.js router stubs.
// Instead we mount a tiny <StoreSection> component that mirrors the
// dropdown handler and the effectiveStoreId/effectiveStoreName logic
// extracted from CampaignDrawer.tsx. This lets the tests:
//   1. Assert on writeCampaignStoreMap call shapes (bug-4/bug-5 coverage)
//   2. Assert on setMappedProducts migration calls (bug-6/bug-8 coverage — v2 NEW)
//   3. Verify effectiveStoreName STORE_DISPLAY_NAMES resolution
// without touching any network or SWR.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';

// ---------------------------------------------------------------------------
// Hoist mocks (vi.hoisted pattern — must be before module imports).
// ---------------------------------------------------------------------------
const { writeStoreMapMock, setMappedProductsMock } = vi.hoisted(() => ({
  writeStoreMapMock: vi.fn(),
  setMappedProductsMock: vi.fn(),
}));

// Mutable state that both mocks read/write so the component under test
// observes the same mutations the real helpers would produce.
let storeMapState: Record<string, string> = {};
let productMapState: Record<string, string[]> = {};

vi.mock('@/lib/campaignStoreMap', () => ({
  readCampaignStoreMap: () => ({ ...storeMapState }),
  writeCampaignStoreMap: (m: Record<string, string>) => {
    writeStoreMapMock(m);
    storeMapState = { ...m };
  },
  campaignStoreKey: (p: string, a: string, c: string) => `${p}::${a}::${c}`,
  // resolveStoreForCampaign not used by the drawer directly — stub for safety.
  resolveStoreForCampaign: vi.fn(),
}));

vi.mock('@/lib/campaignProductMap', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    readProductMap: () => ({ ...productMapState }),
    setMappedProducts: (
      sid: string,
      platform: string,
      cid: string,
      productIds: string[],
    ) => {
      setMappedProductsMock(sid, platform, cid, productIds);
      const key = `${sid}::${platform}::${cid}`;
      productMapState = { ...productMapState };
      if (productIds.length === 0) {
        delete productMapState[key];
      } else {
        productMapState[key] = productIds;
      }
    },
  };
});

// cloudSync is imported transitively via campaignStoreMap — stub it so no
// network requests are attempted even if the real module slips through.
vi.mock('@/lib/cloudSync', () => ({ pushCloudKey: vi.fn() }));

// ---------------------------------------------------------------------------
// Import helpers AFTER mocks are registered.
// ---------------------------------------------------------------------------
import {
  writeCampaignStoreMap,
  campaignStoreKey,
  type CampaignStoreMap,
} from '@/lib/campaignStoreMap';
import {
  campaignKey,
  setMappedProducts,
  type ProductMap,
} from '@/lib/campaignProductMap';
import {
  resolveSharedTikTokAdvertiserId,
  type AdAccountMap,
} from '@/lib/campaignsLinks';

// ---------------------------------------------------------------------------
// Minimal test component — mirrors the dropdown section from CampaignDrawer.
// Accepts the same inputs the drawer uses for this section and provides the
// same handler body verbatim so the tests cover real drawer logic.
// ---------------------------------------------------------------------------
const STORE_DISPLAY_NAMES: Record<string, string> = {
  uzoshop: 'uzoshop',
  zolplus: 'Zol Plus',
  usmile360: '360usmile',
};

interface StoreSectionProps {
  storeId: string;
  campaignId: string;
  advertiserId: string; // '' means no TikTok account configured
  initialStoreMap?: CampaignStoreMap;
  initialProductMap?: ProductMap;
}

function StoreSection({
  storeId,
  campaignId,
  advertiserId,
  initialStoreMap = {},
  initialProductMap = {},
}: StoreSectionProps) {
  const [storeMap, setStoreMapLocal] = useState<CampaignStoreMap>(initialStoreMap);
  const [productMap] = useState<ProductMap>(initialProductMap);

  const key = advertiserId
    ? campaignStoreKey('tiktok', advertiserId, campaignId)
    : '';
  const currentValue = key ? storeMap[key] : undefined;

  // effectiveStoreId — same logic as the drawer memo (simplified: platform
  // is always TikTok in this component so the platform guard is omitted).
  const effectiveStoreId = (() => {
    if (!advertiserId) return storeId;
    return storeMap[campaignStoreKey('tiktok', advertiserId, campaignId)] ?? storeId;
  })();

  // effectiveStoreName — same logic as the drawer memo.
  const effectiveStoreName =
    STORE_DISPLAY_NAMES[effectiveStoreId] ?? effectiveStoreId;

  return (
    <div>
      <select
        data-testid="drawer-store-select"
        disabled={!advertiserId}
        value={currentValue ?? '__unmapped__'}
        onChange={(e) => {
          if (!key) return;
          const oldEffectiveStoreId = currentValue ?? storeId;
          const newRawValue = e.target.value;
          const newEffectiveStoreId =
            newRawValue === '__unmapped__' ? storeId : newRawValue;

          // 1. Update the campaign-store-map.
          const next: CampaignStoreMap = { ...storeMap };
          if (newRawValue === '__unmapped__') {
            delete next[key];
          } else {
            next[key] = newRawValue;
          }
          writeCampaignStoreMap(next);
          setStoreMapLocal(next);

          // 2. Migrate productMap entry from old store key to new store key.
          if (oldEffectiveStoreId !== newEffectiveStoreId) {
            const oldProductKey = campaignKey(oldEffectiveStoreId, 'TikTok', campaignId);
            const existing = productMap[oldProductKey];
            if (existing && existing.length > 0) {
              setMappedProducts(newEffectiveStoreId, 'TikTok', campaignId, existing);
              setMappedProducts(oldEffectiveStoreId, 'TikTok', campaignId, []);
            }
          }
        }}
      >
        <option value="__unmapped__">(לא ממופה · ברירת מחדל uzoshop)</option>
        <option value="uzoshop">uzoshop</option>
        <option value="zolplus">Zol Plus</option>
        <option value="usmile360">360usmile</option>
      </select>
      {/* Expose derived values as data-testid spans so assertions can read them */}
      <span data-testid="effective-store-id">{effectiveStoreId}</span>
      <span data-testid="effective-store-name">{effectiveStoreName}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  storeMapState = {};
  productMapState = {};
  writeStoreMapMock.mockReset();
  setMappedProductsMock.mockReset();
  window.localStorage.clear();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('CampaignDrawer Store section (Phase A.5 v2)', () => {
  const ADVERTISER_ID = 'adv999';
  const CAMPAIGN_ID = 'camp123';
  const STORE_ID = 'uzoshop';
  const EXPECTED_KEY = `tiktok::${ADVERTISER_ID}::${CAMPAIGN_ID}`;

  it('picking usmile360 calls writeCampaignStoreMap with the correct mapping shape', () => {
    render(
      <StoreSection
        storeId={STORE_ID}
        campaignId={CAMPAIGN_ID}
        advertiserId={ADVERTISER_ID}
      />,
    );

    fireEvent.change(screen.getByTestId('drawer-store-select'), {
      target: { value: 'usmile360' },
    });

    expect(writeStoreMapMock).toHaveBeenCalledTimes(1);
    expect(writeStoreMapMock).toHaveBeenCalledWith({
      [EXPECTED_KEY]: 'usmile360',
    });
  });

  it('picking usmile360 migrates productMap from uzoshop key to usmile360 key (v2 NEW feature)', () => {
    // Pre-populate productMap under the old (uzoshop) key.
    const initialProductMap: ProductMap = {
      [`${STORE_ID}::TikTok::${CAMPAIGN_ID}`]: ['prod-A', 'prod-B'],
    };
    productMapState = { ...initialProductMap };

    render(
      <StoreSection
        storeId={STORE_ID}
        campaignId={CAMPAIGN_ID}
        advertiserId={ADVERTISER_ID}
        initialProductMap={initialProductMap}
      />,
    );

    fireEvent.change(screen.getByTestId('drawer-store-select'), {
      target: { value: 'usmile360' },
    });

    // Should write products under the NEW store key.
    expect(setMappedProductsMock).toHaveBeenCalledWith(
      'usmile360', 'TikTok', CAMPAIGN_ID, ['prod-A', 'prod-B'],
    );
    // Should clear the OLD store key.
    expect(setMappedProductsMock).toHaveBeenCalledWith(
      STORE_ID, 'TikTok', CAMPAIGN_ID, [],
    );
    expect(setMappedProductsMock).toHaveBeenCalledTimes(2);
  });

  it('picking __unmapped__ deletes the storeMap entry and migrates productMap back to storeId key', () => {
    // Start with a mapping to usmile360 + products already under usmile360.
    const initialStoreMap: CampaignStoreMap = { [EXPECTED_KEY]: 'usmile360' };
    const initialProductMap: ProductMap = {
      [`usmile360::TikTok::${CAMPAIGN_ID}`]: ['prod-X'],
    };
    storeMapState = { ...initialStoreMap };
    productMapState = { ...initialProductMap };

    render(
      <StoreSection
        storeId={STORE_ID}
        campaignId={CAMPAIGN_ID}
        advertiserId={ADVERTISER_ID}
        initialStoreMap={initialStoreMap}
        initialProductMap={initialProductMap}
      />,
    );

    fireEvent.change(screen.getByTestId('drawer-store-select'), {
      target: { value: '__unmapped__' },
    });

    // storeMap entry should be deleted (empty object).
    expect(writeStoreMapMock).toHaveBeenCalledWith({});

    // Products should migrate from usmile360 back to uzoshop.
    expect(setMappedProductsMock).toHaveBeenCalledWith(
      STORE_ID, 'TikTok', CAMPAIGN_ID, ['prod-X'],
    );
    expect(setMappedProductsMock).toHaveBeenCalledWith(
      'usmile360', 'TikTok', CAMPAIGN_ID, [],
    );
  });

  it('no product migration when there are no products under the old key', () => {
    // productMap is empty — picking a new store should still call
    // writeCampaignStoreMap but NOT call setMappedProducts.
    render(
      <StoreSection
        storeId={STORE_ID}
        campaignId={CAMPAIGN_ID}
        advertiserId={ADVERTISER_ID}
      />,
    );

    fireEvent.change(screen.getByTestId('drawer-store-select'), {
      target: { value: 'zolplus' },
    });

    expect(writeStoreMapMock).toHaveBeenCalledTimes(1);
    expect(setMappedProductsMock).not.toHaveBeenCalled();
  });

  // Phase C soak hotfix (2026-05-30) — regression test for the bug where
  // the dropdown looked up the advertiser id via `adAccounts[storeId]`. For
  // any campaign whose CURRENT attribution is usmile360 / zolplus (i.e. the
  // operator already mapped it via the drawer + cron-live-heavy migrated
  // the campaigns_daily row → drawer's `storeId` prop = 'usmile360'),
  // `adAccounts['usmile360'].tiktokAdvertiserId` returned '' → dropdown
  // disabled + empty storeMap key → "unmapped (default uzoshop)" badge for
  // a campaign the operator HAD already mapped. The fix routes through
  // `resolveSharedTikTokAdvertiserId(adAccounts)` which scans every store
  // and returns the single shared id.
  describe('shared-advertiser-id resolution (regression — drawer hotfix 2026-05-30)', () => {
    function StoreSectionWithAdAccounts(props: {
      storeId: string;
      campaignId: string;
      adAccounts: AdAccountMap;
      initialStoreMap?: CampaignStoreMap;
    }) {
      const advertiserId = resolveSharedTikTokAdvertiserId(props.adAccounts);
      return (
        <StoreSection
          storeId={props.storeId}
          campaignId={props.campaignId}
          advertiserId={advertiserId}
          initialStoreMap={props.initialStoreMap}
        />
      );
    }

    const ADV = 'TT-UZO-9999';

    it('dropdown is ENABLED when drawer renders for usmile360 attribution + uzoshop is the only advertiser-bearing store', () => {
      const accounts: AdAccountMap = {
        uzoshop: { metaAdAccountId: 'M-UZO', googleAdsCustomerId: 'G-UZO', tiktokAdvertiserId: ADV },
        zolplus: { metaAdAccountId: 'M-ZOL', googleAdsCustomerId: null },
        usmile360: { metaAdAccountId: 'M-USM', googleAdsCustomerId: null },
      };
      render(
        <StoreSectionWithAdAccounts
          storeId="usmile360"
          campaignId="C-USMILE-1"
          adAccounts={accounts}
        />,
      );
      const select = screen.getByTestId('drawer-store-select') as HTMLSelectElement;
      expect(select.disabled).toBe(false);
    });

    it('shows the EXISTING mapping when drawer renders for usmile360 attribution + advertiser only on uzoshop', () => {
      // Operator previously mapped C-USMILE-1 → 'usmile360' from uzoshop's view.
      // The storeMap entry uses the (sole) shared advertiser id, NOT the
      // tenant store's empty id. After the soak hotfix, opening the same
      // campaign from any attribution view resolves the SAME key and
      // surfaces the mapping correctly.
      const accounts: AdAccountMap = {
        uzoshop: { metaAdAccountId: 'M-UZO', googleAdsCustomerId: 'G-UZO', tiktokAdvertiserId: ADV },
        usmile360: { metaAdAccountId: 'M-USM', googleAdsCustomerId: null },
        zolplus: { metaAdAccountId: 'M-ZOL', googleAdsCustomerId: null },
      };
      const initial: CampaignStoreMap = {
        [`tiktok::${ADV}::C-USMILE-1`]: 'usmile360',
      };
      render(
        <StoreSectionWithAdAccounts
          storeId="usmile360"
          campaignId="C-USMILE-1"
          adAccounts={accounts}
          initialStoreMap={initial}
        />,
      );
      const select = screen.getByTestId('drawer-store-select') as HTMLSelectElement;
      expect(select.disabled).toBe(false);
      expect(select.value).toBe('usmile360');
      // effectiveStoreId resolves through the storeMap → usmile360 → '360usmile'.
      expect(screen.getByTestId('effective-store-name').textContent).toBe('360usmile');
    });

    it('dropdown is DISABLED only when literally no store has a TikTok advertiser id (true "TikTok not deployed yet")', () => {
      const accounts: AdAccountMap = {
        uzoshop: { metaAdAccountId: 'M-UZO', googleAdsCustomerId: 'G-UZO' },
        zolplus: { metaAdAccountId: 'M-ZOL', googleAdsCustomerId: null },
      };
      render(
        <StoreSectionWithAdAccounts
          storeId="uzoshop"
          campaignId="C-1"
          adAccounts={accounts}
        />,
      );
      const select = screen.getByTestId('drawer-store-select') as HTMLSelectElement;
      expect(select.disabled).toBe(true);
    });
  });

  it('effectiveStoreName + STORE_DISPLAY_NAMES resolve correctly for all known stores', () => {
    // Each case requires fresh React state — use unmount+render (key prop
    // trick would also work, but three separate renders makes the intent clear).

    // Case 1: unmapped → effectiveStoreId is storeId (uzoshop) → name 'uzoshop'.
    const { unmount: u1 } = render(
      <StoreSection
        storeId="uzoshop"
        campaignId={CAMPAIGN_ID}
        advertiserId={ADVERTISER_ID}
      />,
    );
    expect(screen.getByTestId('effective-store-name').textContent).toBe('uzoshop');
    u1();

    // Case 2: mapped to usmile360 → effectiveStoreName is '360usmile'.
    const { unmount: u2 } = render(
      <StoreSection
        storeId="uzoshop"
        campaignId={CAMPAIGN_ID}
        advertiserId={ADVERTISER_ID}
        initialStoreMap={{ [EXPECTED_KEY]: 'usmile360' }}
      />,
    );
    expect(screen.getByTestId('effective-store-name').textContent).toBe('360usmile');
    u2();

    // Case 3: mapped to zolplus → effectiveStoreName is 'Zol Plus'.
    const { unmount: u3 } = render(
      <StoreSection
        storeId="uzoshop"
        campaignId={CAMPAIGN_ID}
        advertiserId={ADVERTISER_ID}
        initialStoreMap={{ [EXPECTED_KEY]: 'zolplus' }}
      />,
    );
    expect(screen.getByTestId('effective-store-name').textContent).toBe('Zol Plus');
    u3();

    // Case 4: unknown storeId → fallback to the raw id itself.
    render(
      <StoreSection
        storeId="uzoshop"
        campaignId={CAMPAIGN_ID}
        advertiserId={ADVERTISER_ID}
        initialStoreMap={{ [EXPECTED_KEY]: 'some-future-store' }}
      />,
    );
    expect(screen.getByTestId('effective-store-name').textContent).toBe('some-future-store');
  });
});
