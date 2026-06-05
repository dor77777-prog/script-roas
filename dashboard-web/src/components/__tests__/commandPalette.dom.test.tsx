// dashboard-web/src/components/__tests__/commandPalette.dom.test.tsx
//
// WS6 — command-palette action upgrades.
// Covers two of the three behavioural upgrades:
//   1. Picking a campaign result deep-links via drillToCampaigns({ store,
//      platform, campaign:{ storeId, platform, campaignId } }) — opening that
//      campaign's drawer through ?c_drill — rather than only setting the store
//      filter + switching tab. The title-case CampaignRow.platform is mapped
//      to the lowercase drill key (Meta → meta), mirroring Dashboard's
//      roas-open-campaign-drawer bridge.
//   2. A "מעבר ל-תשלומים" (go to Payments) navigation action is present.

import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Hoisted mocks (must precede the imports that load these modules).
// ---------------------------------------------------------------------------

// drillToCampaigns is the deep-link helper; spy on it while keeping every
// other urlState export (types/readers/writers) intact. The spy is created via
// vi.hoisted so it exists before the hoisted vi.mock factory runs.
const { drillToCampaignsSpy } = vi.hoisted(() => ({ drillToCampaignsSpy: vi.fn() }));
vi.mock('@/lib/urlState', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, drillToCampaigns: drillToCampaignsSpy };
});

// The palette warms a SWR cache for /api/campaigns + /api/products once it is
// opened. Feed a single Meta campaign row so the campaign result renders.
// TODAY_IL is computed inside the factory (vi.mock is hoisted above imports)
// so the campaign row survives the palette's 30-day Asia/Jerusalem cutoff.
vi.mock('swr', () => {
  const todayIl = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return {
    default: (key: string | null) => {
      // The palette now fetches /api/campaigns?from=…&to=… (a 30-day window) —
      // param-less 400s and yields no rows. Require the date params so a
      // regression to a param-less key surfaces as an empty corpus here.
      if (typeof key === 'string' && key.startsWith('/api/campaigns') && key.includes('from=')) {
        return {
          data: {
            rows: [
              {
                date: todayIl,
                storeId: 'uzoshop',
                storeName: 'uzoshop',
                platform: 'Meta',
                campaignId: 'camp-42',
                campaignName: 'Summer Sale 2026',
                spend: 500,
                conversionValue: 2000,
              },
            ],
          },
          isLoading: false,
        };
      }
      return { data: undefined, isLoading: false };
    },
  };
});

// ---------------------------------------------------------------------------
// Imports after mocks.
// ---------------------------------------------------------------------------
import { CommandPalette } from '@/components/CommandPalette';
import { ThemeProvider } from '@/components/ThemeProvider';
import type { DashboardData, Filters as DashFilters } from '@/lib/types';

function renderPalette(overrides: {
  setFilters?: (next: DashFilters) => void;
  setActiveTab?: (next: 'home' | 'campaigns' | 'payments') => void;
} = {}) {
  const data: DashboardData = {
    stores: ['uzoshop', 'usmile360'],
    perStore: [],
    perStoreDaily: [],
    perStoreAndPlatformDaily: [],
    perPlatformDaily: [],
    totalsDaily: [],
    perPlatformPerStoreTotals: [],
    perStoreCogsTotals: [],
    ordersDaily: [],
    lastUpdated: '2026-06-04T00:00:00Z',
    dataLastWriteAt: null,
  } as unknown as DashboardData;

  const filters: DashFilters = {
    store: 'All',
    range: { from: '2026-05-01', to: '2026-05-30' },
    preset: 'last_30_days',
  } as unknown as DashFilters;

  const utils = render(
    <ThemeProvider>
      <CommandPalette
        data={data}
        filters={filters}
        setFilters={overrides.setFilters ?? (() => {})}
        activeTab="home"
        setActiveTab={(overrides.setActiveTab as (n: string) => void) ?? (() => {})}
        onRefresh={() => {}}
        onOpenAiReport={() => {}}
      />
    </ThemeProvider>,
  );

  // Open the palette via its trigger pill so the modal + warmed cache mount.
  const trigger = utils.container.querySelector<HTMLButtonElement>(
    'button[aria-label="פתח פנל פקודות"]',
  );
  expect(trigger).not.toBeNull();
  act(() => {
    trigger!.click();
  });
  return utils;
}

describe('WS6 — CommandPalette action upgrades', () => {
  it('campaign result deep-links via drillToCampaigns (store + lowercase platform + campaign)', () => {
    const setFilters = vi.fn();
    const setActiveTab = vi.fn();
    renderPalette({ setFilters, setActiveTab });

    // Campaign results only surface once a query matches them (the empty-query
    // default set is tabs + presets + stores + actions). Type the campaign
    // name to bring its result into view.
    const input = document.querySelector<HTMLInputElement>('input[type="search"]');
    expect(input).not.toBeNull();
    act(() => {
      fireEvent.change(input!, { target: { value: 'Summer Sale' } });
    });

    // The mock campaign row renders as a result button labelled with the
    // campaign name (wrapped in <bdi>). Find and click it.
    const nameBdi = Array.from(
      document.querySelectorAll<HTMLElement>('bdi[dir="ltr"]'),
    ).find((b) => b.textContent === 'Summer Sale 2026');
    expect(nameBdi).toBeDefined();
    const resultButton = nameBdi!.closest('button');
    expect(resultButton).not.toBeNull();

    act(() => {
      resultButton!.click();
    });

    // It must deep-link, not merely set the store filter + switch tab.
    expect(drillToCampaignsSpy).toHaveBeenCalledTimes(1);
    expect(drillToCampaignsSpy).toHaveBeenCalledWith({
      store: 'uzoshop',
      platform: 'meta', // title-case 'Meta' → lowercase drill key
      campaign: { storeId: 'uzoshop', platform: 'meta', campaignId: 'camp-42' },
    });
    // The old behaviour (setActiveTab('campaigns')) is replaced by the deep-link.
    expect(setActiveTab).not.toHaveBeenCalled();
  });

  it('lists a "מעבר ל-תשלומים" (Payments) navigation action', () => {
    renderPalette();
    expect(screen.getByText('מעבר ל-תשלומים')).toBeDefined();
  });
});
