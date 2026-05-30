// dashboard-web/src/components/__tests__/campaignDrawerStatusSectionFull.dom.test.tsx
//
// Phase D Task 13 — full status section renders 5 status fields, a
// 3-event timeline, and the BACKFILL_UNKNOWN warning when applicable.

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CampaignDrawerStatusSection } from '@/components/CampaignDrawerStatusSection';

describe('CampaignDrawerStatusSection (Phase D — full)', () => {
  it('renders configured / effective / delivery side-by-side', () => {
    render(
      <CampaignDrawerStatusSection
        configuredStatus="ENABLED"
        effectiveStatus="ACTIVE"
        deliveryStatus="DELIVERING"
        firstSeenAt="2026-05-20T00:00:00Z"
        statusChangedAt="2026-05-28T12:00:00Z"
        lastStatusSuccessAt="2026-05-30T09:50:00Z"
        lastLiveTickAt="2026-05-30T10:00:00Z"
        metricsLagMinutes={5}
      />,
    );
    expect(screen.getByText('ENABLED')).toBeInTheDocument();
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
    expect(screen.getByText('DELIVERING')).toBeInTheDocument();
  });

  it('shows BACKFILL_UNKNOWN warning chip when configuredStatus is the sentinel', () => {
    render(
      <CampaignDrawerStatusSection
        configuredStatus="BACKFILL_UNKNOWN"
        effectiveStatus="ACTIVE"
        deliveryStatus="DELIVERING"
        firstSeenAt={null}
        statusChangedAt={null}
        lastStatusSuccessAt={null}
        lastLiveTickAt={null}
        metricsLagMinutes={null}
      />,
    );
    expect(screen.getByText(/טוען מ-Platform/)).toBeInTheDocument();
  });

  it('renders the 3-event timeline labels', () => {
    render(
      <CampaignDrawerStatusSection
        configuredStatus="ENABLED"
        effectiveStatus="ACTIVE"
        deliveryStatus="DELIVERING"
        firstSeenAt="2026-05-20T00:00:00Z"
        statusChangedAt="2026-05-28T12:00:00Z"
        lastStatusSuccessAt="2026-05-30T09:50:00Z"
        lastLiveTickAt="2026-05-30T10:00:00Z"
        metricsLagMinutes={5}
      />,
    );
    expect(screen.getByText(/נראה לראשונה/)).toBeInTheDocument();
    expect(screen.getByText(/שינוי סטטוס אחרון/)).toBeInTheDocument();
    expect(screen.getByText(/סטטוס נדגם בהצלחה/)).toBeInTheDocument();
  });
});
