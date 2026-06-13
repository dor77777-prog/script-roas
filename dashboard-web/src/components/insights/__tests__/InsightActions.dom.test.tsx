// dashboard-web/src/components/insights/__tests__/InsightActions.dom.test.tsx
//
// Task 5.6 (Wave 5, P1-10 / Q7) — InsightActions action-bar contract.
//
// The component is the single point where every insight surface
// (InsightsBoard, WhatsWorking, CohortComparisonPanel, HealthScorePanel,
// AttributionAnalysisPanel) gets its action pair. The Q7 rule is:
//   1. PRIMARY  → opens the in-app campaign drawer (via custom event)
//   2. SECONDARY → deep-links to the platform's native Ads Manager
//
// These tests pin the contract so a future refactor can't silently flip
// the click target of the primary button (e.g. back to a single
// always-external link, which is what the pre-Q7 world had).

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import {
  InsightActions,
  OPEN_CAMPAIGN_DRAWER_EVENT,
  type OpenCampaignDrawerDetail,
} from '../InsightActions';

const META_ACCOUNTS = {
  'store-uzo': {
    metaAdAccountId: 'act_123456',
    googleAdsCustomerId: null,
    tiktokAdvertiserId: null,
  },
} as const;

describe('InsightActions', () => {
  beforeEach(() => {
    // Clean event listeners between tests.
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders primary "פתח קמפיין" + secondary Meta Ads Manager deep-link when given full context', () => {
    render(
      <InsightActions
        campaignId="cmp-1"
        campaignName="Test Campaign"
        platform="Meta"
        storeId="store-uzo"
        adAccounts={META_ACCOUNTS}
      />,
    );

    // Primary — button (not a link), opens drawer in-app per Q7.
    const primary = screen.getByRole('button', { name: /פתח קמפיין/ });
    expect(primary).toBeInTheDocument();
    expect(primary.tagName).toBe('BUTTON');
    // Horizon re-skin (W3.7) — the primary CTA adopts the brand button recipe
    // (mockup's filled "פתח"); the <Button variant="primary"> carries the
    // accent-btn fill, so the rendered class set must include it.
    expect(primary.className).toContain('bg-accent-btn');

    // Secondary — anchor (external link), deep-links to Meta with the
    // account-aware URL. The label uses Hebrew + the bdi-wrapped
    // platform name; assert by accessible name to dodge the bdi split.
    const secondary = screen.getByRole('link', { name: /פתח ב-Meta Ads Manager/ });
    expect(secondary).toBeInTheDocument();
    expect(secondary.getAttribute('href')).toContain('selected_campaign_ids=cmp-1');
    expect(secondary.getAttribute('href')).toContain('act=act_123456');
    expect(secondary.getAttribute('target')).toBe('_blank');
    expect(secondary.getAttribute('rel')).toBe('noopener noreferrer');
    // Re-skin (W3.7) — the deep-link is now routed through the <Button>
    // primitive (asChild → renders the <a>), so it inherits the secondary
    // recipe + a real focus-visible ring instead of the old hand-rolled
    // border/hover classes.
    expect(secondary.className).toContain('focus-visible:ring');
  });

  it('clicking primary dispatches `roas-open-campaign-drawer` with the typed detail', () => {
    const onOpen = vi.fn();
    window.addEventListener(OPEN_CAMPAIGN_DRAWER_EVENT, onOpen as EventListener);

    render(
      <InsightActions
        campaignId="cmp-9"
        platform="Google"
        storeId="store-usmile"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /פתח קמפיין/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    const detail = (onOpen.mock.calls[0][0] as CustomEvent<OpenCampaignDrawerDetail>).detail;
    expect(detail).toEqual({
      storeId: 'store-usmile',
      platform: 'Google',
      campaignId: 'cmp-9',
    });

    window.removeEventListener(OPEN_CAMPAIGN_DRAWER_EVENT, onOpen as EventListener);
  });

  it('clicking primary uses `onDrill` override when provided (drawer-mounted panels)', () => {
    const onDrill = vi.fn();
    const onOpen = vi.fn();
    window.addEventListener(OPEN_CAMPAIGN_DRAWER_EVENT, onOpen as EventListener);

    render(
      <InsightActions
        campaignId="cmp-2"
        platform="Meta"
        storeId="store-uzo"
        onDrill={onDrill}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /פתח קמפיין/ }));
    expect(onDrill).toHaveBeenCalledTimes(1);
    // `onDrill` overrides — global event MUST NOT fire.
    expect(onOpen).not.toHaveBeenCalled();

    window.removeEventListener(OPEN_CAMPAIGN_DRAWER_EVENT, onOpen as EventListener);
  });

  it('hidePrimary suppresses the in-app button but keeps the deep-link secondary', () => {
    render(
      <InsightActions
        campaignId="cmp-3"
        platform="TikTok"
        storeId="store-uzo"
        adAccounts={{
          'store-uzo': { metaAdAccountId: null, googleAdsCustomerId: null, tiktokAdvertiserId: '789' },
        }}
        hidePrimary
      />,
    );

    expect(screen.queryByRole('button', { name: /פתח קמפיין/ })).not.toBeInTheDocument();
    const link = screen.getByRole('link', { name: /פתח ב-TikTok Ads Manager/ });
    expect(link.getAttribute('href')).toContain('campaign_id=cmp-3');
    expect(link.getAttribute('href')).toContain('aadvid=789');
  });

  it('omits secondary for non-ads platforms (organic) but keeps primary when context allows', () => {
    render(
      <InsightActions
        campaignId="cmp-4"
        platform="organic"
        storeId="store-uzo"
      />,
    );
    // Primary still renders because the contract is "open the drawer"
    // — the drawer will show what we have for the row even if the
    // platform isn't an ad platform.
    expect(screen.getByRole('button', { name: /פתח קמפיין/ })).toBeInTheDocument();
    // Secondary MUST NOT render for organic — no Ads Manager exists.
    expect(screen.queryByRole('link', { name: /Ads Manager/ })).not.toBeInTheDocument();
  });

  it('renders nothing when there is no campaignId and no onDrill (store-level insight)', () => {
    const { container } = render(
      <InsightActions
        platform="Meta"
        storeId="store-uzo"
      />,
    );
    // No campaignId → canDrill is false (no onDrill either) AND
    // deepLink is null. Component MUST render nothing.
    expect(container).toBeEmptyDOMElement();
  });
});
