// dashboard-web/src/components/__tests__/campaignsTableStoreColumnTikTok.dom.test.tsx
//
// Phase A.5 Task 7 — CampaignsTable Store column + dropdown for TikTok rows.
// Runs under jsdom (vitest.config.dom.ts) via `npm run test:components`.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Aggregated } from '@/lib/campaignsAggregator';
import type { CampaignStoreMap } from '@/lib/campaignStoreMap';
import type { AdAccountMap } from '@/lib/campaignsLinks';

// --- Mocks -------------------------------------------------------------------

const writeMock = vi.fn();
let mapState: Record<string, string> = {};

vi.mock('@/lib/campaignStoreMap', () => ({
  readCampaignStoreMap: () => mapState,
  writeCampaignStoreMap: (map: Record<string, string>) => {
    writeMock(map);
    mapState = map;
  },
  campaignStoreKey: (p: string, a: string, c: string) => `${p}::${a}::${c}`,
}));

// SWR emits a warning in jsdom when fetch isn't properly stubbed.
// Replace with a no-op so tests don't spray console noise.
vi.mock('swr', () => ({
  default: () => ({ data: undefined, error: undefined, isLoading: false }),
  useSWRConfig: () => ({ mutate: vi.fn() }),
}));

// cloudSync is not relevant to the Store dropdown; silence the import.
vi.mock('@/lib/cloudSync', () => ({ pushCloudKey: vi.fn() }));

beforeEach(() => {
  mapState = {};
  writeMock.mockReset();
});

// --- Helpers -----------------------------------------------------------------

/** Minimal Aggregated row fixture. Platform casing follows the API: 'TikTok' / 'Meta'. */
function makeRow(overrides: Partial<Aggregated> & { platform: string; campaignId: string }): Aggregated {
  return {
    key: `uzoshop::${overrides.platform}::${overrides.campaignId}`,
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    campaignName: `Test Campaign ${overrides.campaignId}`,
    adSetId: undefined,
    adSetName: undefined,
    spend: 100,
    impressions: 1000,
    clicks: 10,
    conversions: 2,
    conversionValue: 300,
    campaignBudgetCad: null,
    adSetBudgetCad: null,
    budgetType: '',
    lastActiveDate: '2026-05-29',
    effectiveStatus: 'ADGROUP_STATUS_DELIVERY_OK',
    ...overrides,
  };
}

/** TikTok advertiser_id used in the test fixtures. */
const TEST_ADVERTISER_ID = '999';

/** Minimal AdAccountMap that carries tiktokAdvertiserId for uzoshop. */
const TEST_AD_ACCOUNTS: AdAccountMap = {
  uzoshop: {
    metaAdAccountId: null,
    googleAdsCustomerId: null,
    tiktokAdvertiserId: TEST_ADVERTISER_ID,
  },
};

// CampaignsTableRow is the implementation target — import AFTER mocks.
// eslint-disable-next-line import/first
import { CampaignsTableRow } from '../CampaignsTableRow';

/** Wraps a row in a minimal <table><tbody> so the TR is valid DOM. */
function renderRow(
  row: Aggregated,
  extraProps: { storeMap?: CampaignStoreMap; hasTikTokRows?: boolean } = {},
) {
  const { storeMap = {}, hasTikTokRows = true } = extraProps;
  return render(
    <table>
      <tbody>
        <CampaignsTableRow
          a={row}
          i={0}
          mode="campaign"
          trueRevenueByKey={new Map()}
          mappedCampaignKeys={new Set()}
          health={undefined}
          columnOrder={['spend', 'roas']}
          dailySeries={undefined}
          adAccounts={TEST_AD_ACCOUNTS}
          optimized={new Set()}
          today="2026-05-29"
          onToggleOptimized={() => {}}
          onDrillCampaign={() => {}}
          onDrillAd={() => {}}
          storeMap={storeMap}
          hasTikTokRows={hasTikTokRows}
        />
      </tbody>
    </table>,
  );
}

// --- Tests -------------------------------------------------------------------

describe('CampaignsTable Store column — TikTok rows', () => {
  it('renders dropdown only on TikTok rows', () => {
    const tikTokRow = makeRow({ platform: 'TikTok', campaignId: 'C1' });
    const metaRow = makeRow({ platform: 'Meta', campaignId: 'M1' });

    renderRow(tikTokRow);
    expect(screen.getByTestId('store-select-C1')).toBeInTheDocument();

    // Re-render for Meta row — no store-select expected.
    renderRow(metaRow);
    expect(screen.queryByTestId('store-select-M1')).not.toBeInTheDocument();
  });

  it('default value is "(לא ממופה)" when key not in map', () => {
    mapState = {};
    const row = makeRow({ platform: 'TikTok', campaignId: 'C1' });
    renderRow(row, { storeMap: {} });

    const select = screen.getByTestId('store-select-C1') as HTMLSelectElement;
    expect(select.value).toBe('__unmapped__');

    const cell = screen.getByTestId('store-cell-C1');
    expect(cell.className).toContain('text-status-orange');
  });

  it('renders mapped value when key in map', () => {
    const key = `tiktok::${TEST_ADVERTISER_ID}::C1`;
    mapState = { [key]: 'usmile360' };
    const row = makeRow({ platform: 'TikTok', campaignId: 'C1' });
    renderRow(row, { storeMap: mapState });

    const select = screen.getByTestId('store-select-C1') as HTMLSelectElement;
    expect(select.value).toBe('usmile360');
  });

  it('changing dropdown calls writeCampaignStoreMap with new map', () => {
    mapState = {};
    const row = makeRow({ platform: 'TikTok', campaignId: 'C1' });
    renderRow(row, { storeMap: {} });

    const select = screen.getByTestId('store-select-C1');
    fireEvent.change(select, { target: { value: 'usmile360' } });

    expect(writeMock).toHaveBeenCalledTimes(1);
    const written = writeMock.mock.calls[0][0] as Record<string, string>;
    expect(written[`tiktok::${TEST_ADVERTISER_ID}::C1`]).toBe('usmile360');
  });
});
