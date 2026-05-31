'use client';

/**
 * Task 5.5 (Wave 5) — Status sub-tab.
 *
 * Hosts the full Phase D status + freshness panel
 * (CampaignDrawerStatusSection). Pre-split, this section sat right below
 * the drawer header in the Overview content; moving it to a dedicated
 * tab keeps the Overview focused on "what's the performance" and the
 * Status tab focused on "is the data even fresh, and what state is the
 * campaign in".
 */

import { CampaignDrawerStatusSection } from '../CampaignDrawerStatusSection';

export interface CampaignDrawerStatusProps {
  configuredStatus: string | null;
  effectiveStatus: string | null;
  deliveryStatus: string | null;
  firstSeenAt: string | null;
  statusChangedAt: string | null;
  lastStatusSuccessAt: string | null;
  lastLiveTickAt: string | null;
  metricsLagMinutes: number | null;
}

export function CampaignDrawerStatus(props: CampaignDrawerStatusProps) {
  return (
    <div data-testid="campaign-drawer-tab-status">
      <CampaignDrawerStatusSection {...props} />
    </div>
  );
}
