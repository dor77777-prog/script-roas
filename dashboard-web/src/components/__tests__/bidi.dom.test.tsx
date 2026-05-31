// dashboard-web/src/components/__tests__/bidi.dom.test.tsx
//
// Task 12 — bidi isolation on mixed Hebrew+English surfaces.
// Asserts that dynamic LTR strings (campaign name, platform name, store name)
// are wrapped in <bdi dir="ltr"> so RTL layout doesn't mirror them.

import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Hoist mocks (must appear before any imports that load these modules).
// ---------------------------------------------------------------------------
vi.mock('swr', () => ({
  default: () => ({ data: undefined, isLoading: false }),
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

// ---------------------------------------------------------------------------
// Imports after mocks.
// ---------------------------------------------------------------------------
import { CampaignDrawer } from '@/components/CampaignDrawer';
import { CampaignsTopList, type CampaignTopListPoint } from '@/components/CampaignsTopList';
import { AdsDrawer } from '@/components/AdsDrawer';
import { CommandPalette } from '@/components/CommandPalette';
import { ThemeProvider } from '@/components/ThemeProvider';
import { fmtMoney, fmtMoneyString } from '@/lib/format';
import type { CampaignRow } from '@/lib/campaigns';
import type { DashboardData, Filters as DashFilters } from '@/lib/types';

// ---------------------------------------------------------------------------
// Minimal CampaignRow factory.
// ---------------------------------------------------------------------------
function makeRow(overrides: Partial<CampaignRow> = {}): CampaignRow {
  return {
    date: '2026-05-30',
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    platform: 'Meta',
    campaignId: 'campaign-123',
    campaignName: 'Summer Sale 2026',
    adSetId: 'adset-1',
    adSetName: 'Ad Set 1',
    spend: 100,
    impressions: 1000,
    clicks: 50,
    conversions: 5,
    conversionValue: 200,
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

describe('Task 12 — bidi isolation on mixed Hebrew+English surfaces', () => {
  it('CampaignDrawer title wraps campaign name in <bdi dir="ltr">', () => {
    render(
      <CampaignDrawer
        open
        onClose={() => {}}
        rows={[makeRow()]}
        campaignId="campaign-123"
        storeId="uzoshop"
        adAccounts={{}}
        rangeFrom="2026-05-01"
        rangeTo="2026-05-30"
      />,
    );
    const heading = screen.getByRole('heading', { level: 2 });
    const bdi = heading.querySelector('bdi[dir="ltr"]');
    expect(bdi).not.toBeNull();
    expect(bdi!.textContent).toBe('Summer Sale 2026');
  });

  it('CampaignDrawer "Open in {platform} Ads Manager" link isolates platform name', () => {
    render(
      <CampaignDrawer
        open
        onClose={() => {}}
        rows={[makeRow()]}
        campaignId="campaign-123"
        storeId="uzoshop"
        adAccounts={{}}
        rangeFrom="2026-05-01"
        rangeTo="2026-05-30"
      />,
    );
    const link = screen.getByRole('link', { name: /Ads Manager/ });
    expect(link.querySelector('bdi[dir="ltr"]')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Wave 4 / Task 4.2 — regressions for 6 newly-isolated interpolation sites.
// ---------------------------------------------------------------------------
describe('Wave 4 / Task 4.2 — additional <bdi> isolation regressions', () => {
  // CampaignsTopList — line 54 (PlatformRow store) + 104 (Row campaign name)
  it('CampaignsTopList wraps campaign name AND store name in <bdi dir="ltr">', () => {
    const data: CampaignTopListPoint[] = [
      { name: 'Summer Sale 2026', platform: 'Meta', storeName: 'uzoshop', roas: 4.2, cac: 12, spend: 500 },
      { name: 'Bad Camp 99', platform: 'TikTok', storeName: 'usmile360', roas: 0.5, cac: 200, spend: 200 },
    ];
    const { container } = render(<CampaignsTopList data={data} title="Test" />);

    // Campaign names (rendered via the Row block, line 104+).
    const nameBdi = Array.from(container.querySelectorAll<HTMLElement>('bdi[dir="ltr"]'))
      .find(b => b.textContent === 'Summer Sale 2026');
    expect(nameBdi).toBeDefined();

    // Store names (rendered via PlatformRow, line 54+).
    const storeBdi = Array.from(container.querySelectorAll<HTMLElement>('bdi[dir="ltr"]'))
      .find(b => b.textContent === 'uzoshop');
    expect(storeBdi).toBeDefined();
  });

  // AdsDrawer — line 336 ("ad-set" literal) + ad-set name in <Heading>.
  it('AdsDrawer header isolates the "ad-set" literal AND the ad-set name', () => {
    render(
      <AdsDrawer
        open
        onClose={() => {}}
        storeId="uzoshop"
        platform="Meta"
        campaignId="campaign-123"
        adSetId="adset-1"
        adSetName="My Ad Set 2026"
        rangeFrom="2026-05-01"
        rangeTo="2026-05-30"
        adAccounts={{}}
      />,
    );
    // Sheet portals into document.body; query the whole document.
    const allBdi = Array.from(document.querySelectorAll<HTMLElement>('bdi[dir="ltr"]'));
    // "ad-set" literal wrapped in <bdi>.
    expect(allBdi.find(b => b.textContent === 'ad-set')).toBeDefined();
    // Ad-set name wrapped in <bdi>.
    expect(allBdi.find(b => b.textContent === 'My Ad Set 2026')).toBeDefined();
  });

  // Wave 4 / Task 4.1 — CampaignsTopList verdict arrow uses the lucide SVG
  // `ArrowLeft`, NOT a Unicode "→". Under RTL the legacy glyph pointed away
  // from the verdict text it referenced. The full pin lives in
  // `campaignsTopListArrow.dom.test.tsx`; this is a cross-link assertion so
  // the bidi suite covers the same Wave-4 contract end-to-end.
  it('CampaignsTopList verdicts carry an SVG arrow (no Unicode → glyph)', () => {
    const data: CampaignTopListPoint[] = [
      { name: 'Hero Camp', platform: 'Meta', storeName: 'uzoshop', roas: 5.0, cac: 12, spend: 1000 },
      { name: 'Dud Camp',  platform: 'Meta', storeName: 'uzoshop', roas: 0.3, cac: 200, spend: 500 },
    ];
    const { container } = render(<CampaignsTopList data={data} title="Test" />);
    const verdicts = container.querySelectorAll<HTMLElement>(
      '[data-testid="campaigns-top-list-verdict"]',
    );
    expect(verdicts.length).toBeGreaterThan(0);
    for (const v of verdicts) {
      expect(v.textContent ?? '').not.toContain('→'); // U+2192 rightwards arrow
      expect(
        v.querySelector('[data-testid="campaigns-top-list-verdict-arrow"]')?.tagName.toLowerCase(),
      ).toBe('svg');
    }
  });

  // CommandPalette — line 273 (campaign subtitle/label) + 322 (product subtitle).
  // The palette renders inside a modal layer that's hidden until open; we open
  // it by passing the Cmd+K key, but that's harder than just rendering with
  // open-by-default via the button. Easier: render and click the trigger.
  it('CommandPalette store list wraps store id in <bdi dir="ltr">', () => {
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
      lastUpdated: '2026-05-30T00:00:00Z',
      dataLastWriteAt: null,
    } as unknown as DashboardData;

    const filters: DashFilters = {
      store: 'All',
      range: { from: '2026-05-01', to: '2026-05-30' },
      preset: 'last_30_days',
    } as unknown as DashFilters;

    const { container } = render(
      <ThemeProvider>
        <CommandPalette
          data={data}
          filters={filters}
          setFilters={() => {}}
          activeTab="home"
          setActiveTab={() => {}}
          onRefresh={() => {}}
          onOpenAiReport={() => {}}
        />
      </ThemeProvider>,
    );

    // Click the trigger pill to open the palette. act() flushes the
    // setOpen state update so the modal portal is in the DOM before we
    // query for <bdi> wrappers.
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="פתח פנל פקודות"]',
    );
    expect(trigger).not.toBeNull();
    act(() => { trigger!.click(); });

    // After open, the modal renders all stores as <bdi> entries.
    const storeBdi = Array.from(document.querySelectorAll<HTMLElement>('bdi[dir="ltr"]'))
      .find(b => b.textContent === 'uzoshop');
    expect(storeBdi).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Wave 4 / Task 4.3 — fmtMoney / fmtMoneyString currency formatting contract.
//
// Hand-built `` `CAD ${n}` `` interpolations used to drop the <bdi> wrapper,
// which under Hebrew layout reordered the CAD prefix and the numeric tail
// across other RTL text on the same line (the number visually drifted before
// or after labels it didn't belong to). Wave 4.3 routed every site through
// the format-lib siblings — JSX users get `fmtMoney` (returns <bdi dir="ltr">)
// and string consumers get `fmtMoneyString` (the plain ASCII form, safe for
// aria-label / title / log fields where the host text is already wrapped
// elsewhere). These tests pin both contracts.
// ---------------------------------------------------------------------------
describe('Wave 4 / Task 4.3 — fmtMoney/fmtMoneyString bidi contract', () => {
  it('fmtMoney returns a <bdi dir="ltr"> node so the currency stays glued to the number in RTL', () => {
    const { container } = render(<>{fmtMoney(1234)}</>);
    const bdi = container.querySelector('bdi[dir="ltr"]');
    expect(bdi).not.toBeNull();
    // Currency code and the formatted number both live inside the same bdi.
    expect(bdi!.textContent).toMatch(/CAD/);
    expect(bdi!.textContent).toMatch(/1,234/);
  });

  it('fmtMoney with explicit currency code propagates the code into the bdi', () => {
    const { container } = render(<>{fmtMoney(99, 'USD')}</>);
    const bdi = container.querySelector('bdi[dir="ltr"]');
    expect(bdi).not.toBeNull();
    expect(bdi!.textContent).toMatch(/USD/);
  });

  it('fmtMoneyString returns a plain ASCII string (no DOM, no bidi controls)', () => {
    const out = fmtMoneyString(1234);
    expect(typeof out).toBe('string');
    // Sanity: code precedes the number with exactly one space.
    expect(out).toBe('CAD 1,234');
    // No stray U+2068/U+2069 directional isolates (those would only ever be
    // appropriate inside JSX — strings should be plain ASCII).
    expect(out).not.toMatch(/[⁦-⁩]/);
  });

  it('fmtMoneyString preserves the minus sign via fixMinus normalisation', () => {
    // fixMinus rewrites the ASCII "-" to the Unicode minus "−" (U+2212), which
    // bidi-renders correctly inside RTL hosts. The string flavour goes
    // through the same path so plain-text consumers don't regress.
    const out = fmtMoneyString(-50);
    expect(out).toMatch(/[−-]50/); // either glyph is fine — both are minus.
  });
});
