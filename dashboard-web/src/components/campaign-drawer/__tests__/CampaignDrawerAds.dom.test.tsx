// dashboard-web/src/components/campaign-drawer/__tests__/CampaignDrawerAds.dom.test.tsx
//
// Per-ad-set ROAS chip (operator request 2026-06-01).
//
// Coverage:
//   1. Each ad-set row renders a colored ROAS chip showing the formatted ROAS.
//   2. A 0-ROAS ad-set renders the gray '—' chip (consistent with the table).
//   3. The chip renders even when ad-drill is unsupported (e.g. Google PMax) —
//      those rows still carry ROAS, just no "פתח מודעות" drill button.

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { CampaignDrawerAds } from '@/components/campaign-drawer/CampaignDrawerAds';

type AdSet = Parameters<typeof CampaignDrawerAds>[0]['adSets'][number];

function makeSet(overrides: Partial<AdSet> = {}): AdSet {
  return {
    id: 'adset-1',
    name: 'Ad Set 1',
    storeId: 'uzoshop',
    platform: 'Meta',
    campaignId: 'campaign-1',
    spend: 100,
    value: 350,
    clicks: 50,
    impressions: 1000,
    conversions: 5,
    adSetBudgetCad: null,
    roas: 3.5,
    ...overrides,
  };
}

describe('CampaignDrawerAds — per-ad-set ROAS chip', () => {
  it('renders a ROAS chip with the formatted value for an ad-set', () => {
    render(
      <CampaignDrawerAds
        adSets={[makeSet({ roas: 3.5 })]}
        platform="Meta"
        onDrillAds={() => {}}
        rangeIncludesToday={false}
      />,
    );
    // formatNumber(3.5) === '3.50'
    expect(screen.getByText('3.50')).toBeTruthy();
  });

  it('renders the gray "—" chip for a 0-ROAS ad-set', () => {
    render(
      <CampaignDrawerAds
        adSets={[makeSet({ roas: 0 })]}
        platform="Meta"
        onDrillAds={() => {}}
        rangeIncludesToday={false}
      />,
    );
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('renders the chip even when ad-drill is unsupported (Google PMax)', () => {
    render(
      <CampaignDrawerAds
        adSets={[makeSet({ roas: 2.4, platform: 'Google' })]}
        platform="Google"
        onDrillAds={() => {}}
        rangeIncludesToday={false}
      />,
    );
    // Chip present (formatNumber(2.4) === '2.40')…
    expect(screen.getByText('2.40')).toBeTruthy();
    // …but no drill button for the unsupported platform.
    expect(screen.queryByText('פתח מודעות')).toBeNull();
  });
});
