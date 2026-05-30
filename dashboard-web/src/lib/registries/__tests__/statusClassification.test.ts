// dashboard-web/src/lib/registries/__tests__/statusClassification.test.ts
//
// Phase D Task 8 — single source of truth for translating
// (regDeliveryStatus, regEffectiveStatus, legacyEffectiveStatus,
//  platform, lastActiveDate, today) → { label, tone, isOff, isBackfillUnknown }.

import { describe, expect, it } from 'vitest';
import { classifyCampaignStatus } from '@/lib/registries/statusClassification';

describe('classifyCampaignStatus', () => {
  const TODAY = '2026-05-30';

  it("DELIVERING → 'מציג' chip + isOff=false (green tone)", () => {
    const r = classifyCampaignStatus({
      regDeliveryStatus: 'DELIVERING', regEffectiveStatus: 'ACTIVE',
      regConfiguredStatus: 'ENABLED',
      legacyEffectiveStatus: 'ACTIVE', platform: 'Meta',
      lastActiveDate: TODAY, today: TODAY,
    });
    expect(r.isOff).toBe(false);
    expect(r.tone).toBe('green');
  });

  it("NOT_DELIVERING → 'כבוי' chip + isOff=true (gray)", () => {
    const r = classifyCampaignStatus({
      regDeliveryStatus: 'NOT_DELIVERING', regEffectiveStatus: 'PAUSED',
      regConfiguredStatus: 'PAUSED',
      legacyEffectiveStatus: 'PAUSED', platform: 'Meta',
      lastActiveDate: TODAY, today: TODAY,
    });
    expect(r.isOff).toBe(true);
    expect(r.tone).toBe('gray');
  });

  it("LIMITED (BUDGET_EXCEED) → 'מוגבל' chip + isOff=false (orange)", () => {
    const r = classifyCampaignStatus({
      regDeliveryStatus: 'LIMITED', regEffectiveStatus: 'ADGROUP_STATUS_BUDGET_EXCEED',
      regConfiguredStatus: 'ENABLED',
      legacyEffectiveStatus: 'ADGROUP_STATUS_BUDGET_EXCEED', platform: 'TikTok',
      lastActiveDate: TODAY, today: TODAY,
    });
    expect(r.isOff).toBe(false);
    expect(r.tone).toBe('orange');
  });

  it("PENDING_REVIEW → 'בבדיקה' (blue) + isOff=false", () => {
    const r = classifyCampaignStatus({
      regDeliveryStatus: 'PENDING_REVIEW', regEffectiveStatus: 'PENDING_REVIEW',
      regConfiguredStatus: 'ENABLED',
      legacyEffectiveStatus: 'PENDING_REVIEW', platform: 'Meta',
      lastActiveDate: TODAY, today: TODAY,
    });
    expect(r.isOff).toBe(false);
    expect(r.tone).toBe('blue');
  });

  it("BACKFILL_UNKNOWN configured → special 'טוען מ-Platform' chip flag", () => {
    const r = classifyCampaignStatus({
      regDeliveryStatus: 'DELIVERING', regEffectiveStatus: 'ACTIVE',
      regConfiguredStatus: 'BACKFILL_UNKNOWN',
      legacyEffectiveStatus: 'ACTIVE', platform: 'Meta',
      lastActiveDate: TODAY, today: TODAY,
    });
    expect(r.isBackfillUnknown).toBe(true);
  });

  it('reg fields null → falls back to legacyEffectiveStatus + 2-day heuristic', () => {
    const r = classifyCampaignStatus({
      regDeliveryStatus: null, regEffectiveStatus: null,
      regConfiguredStatus: null,
      legacyEffectiveStatus: 'PAUSED', platform: 'Meta',
      lastActiveDate: '2026-05-26', today: '2026-05-30',
    });
    expect(r.isOff).toBe(true);                                 // Meta PAUSED, legacy logic
  });

  it("UNKNOWN reg + null legacy + 4-day-old lastActive → isOff=true", () => {
    const r = classifyCampaignStatus({
      regDeliveryStatus: 'UNKNOWN', regEffectiveStatus: null,
      regConfiguredStatus: null,
      legacyEffectiveStatus: null, platform: 'Meta',
      lastActiveDate: '2026-05-26', today: '2026-05-30',
    });
    expect(r.isOff).toBe(true);                                 // 4-day heuristic, OFF_RECENCY_DAYS=2
  });
});
