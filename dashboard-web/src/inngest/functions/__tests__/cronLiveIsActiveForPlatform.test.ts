// dashboard-web/src/inngest/functions/__tests__/cronLiveIsActiveForPlatform.test.ts
//
// OPERATOR-1 audit fix (2026-05-23): regression tests for cron-live's
// `isActiveForPlatform` helper. The helper decides whether an ad-set's
// current `effective_status` qualifies for placeholder enrollment (an
// UPSERT of TODAY's campaigns_daily row in the refresh-effective-status
// step).
//
// Pre-fix behavior:
//   TikTok branch returned `norm === 'ADGROUP_STATUS_DELIVERY_OK'` —
//   any other TikTok status (BUDGET_EXCEED, AUDIT, REVIEWING, NOT_START)
//   was treated as NOT-ACTIVE. The operator reported (2026-05-23) that
//   campaigns showing as Active in TikTok Ads Manager were missing from
//   the dashboard's placeholder rows — root cause: TikTok returns
//   BUDGET_EXCEED when the daily cap is hit (paused TODAY only, resumes
//   tomorrow) but Ads Manager paints those as Active.
//
// Post-fix behavior:
//   TikTok branch consults TIKTOK_ACTIVE_ENOUGH (5 statuses) — matches
//   the dashboard chip helper `CampaignsTableRow.isCampaignOff`. The two
//   are explicitly mirrored so dashboard chip + cron enrollment stay in
//   agreement.

import { describe, it, expect } from 'vitest';
import { isActiveForPlatform } from '../cronLive';

describe('isActiveForPlatform — Meta', () => {
  it('ACTIVE is the only on-state', () => {
    expect(isActiveForPlatform('meta', 'ACTIVE')).toBe(true);
  });
  it('PAUSED → off', () => {
    expect(isActiveForPlatform('meta', 'PAUSED')).toBe(false);
  });
  it('CAMPAIGN_PAUSED → off', () => {
    expect(isActiveForPlatform('meta', 'CAMPAIGN_PAUSED')).toBe(false);
  });
  it('ADSET_PAUSED → off', () => {
    expect(isActiveForPlatform('meta', 'ADSET_PAUSED')).toBe(false);
  });
  it('ARCHIVED → off', () => {
    expect(isActiveForPlatform('meta', 'ARCHIVED')).toBe(false);
  });
  it('DISAPPROVED → off (Meta returns this when ads rejected)', () => {
    expect(isActiveForPlatform('meta', 'DISAPPROVED')).toBe(false);
  });
  it('WITH_ISSUES → off (Meta flags spent without serving)', () => {
    expect(isActiveForPlatform('meta', 'WITH_ISSUES')).toBe(false);
  });
  it('lowercase active normalises to ACTIVE → on', () => {
    expect(isActiveForPlatform('meta', 'active')).toBe(true);
  });
});

describe('isActiveForPlatform — Google', () => {
  it('ENABLED is the only on-state', () => {
    expect(isActiveForPlatform('google', 'ENABLED')).toBe(true);
  });
  it('PAUSED → off', () => {
    expect(isActiveForPlatform('google', 'PAUSED')).toBe(false);
  });
  it('REMOVED → off', () => {
    expect(isActiveForPlatform('google', 'REMOVED')).toBe(false);
  });
  it('ACTIVE (Meta state on Google) → off (Google never returns ACTIVE)', () => {
    // Cross-platform leakage is rejected, not silently accepted.
    expect(isActiveForPlatform('google', 'ACTIVE')).toBe(false);
  });
});

/**
 * OPERATOR-1 (audit 2026-05-23) — strict coverage of all 10 TikTok
 * statuses.
 *
 * TIKTOK_ACTIVE_ENOUGH (5 — return true):
 *   ADGROUP_STATUS_DELIVERY_OK   ADGROUP_STATUS_BUDGET_EXCEED
 *   ADGROUP_STATUS_AUDIT         ADGROUP_STATUS_REVIEWING
 *   ADGROUP_STATUS_NOT_START
 *
 * TIKTOK_OFF (5 — return false):
 *   ADGROUP_STATUS_DISABLE       ADGROUP_STATUS_TIMEDOUT
 *   ADGROUP_STATUS_FROZEN        ADGROUP_STATUS_ARCHIVED
 *   ADGROUP_STATUS_DELETE
 */
describe('isActiveForPlatform — TikTok (OPERATOR-1, 2026-05-23)', () => {
  const TIKTOK_ACTIVE_ENOUGH = [
    'ADGROUP_STATUS_DELIVERY_OK',
    'ADGROUP_STATUS_BUDGET_EXCEED',
    'ADGROUP_STATUS_AUDIT',
    'ADGROUP_STATUS_REVIEWING',
    'ADGROUP_STATUS_NOT_START',
  ] as const;
  const TIKTOK_OFF = [
    'ADGROUP_STATUS_DISABLE',
    'ADGROUP_STATUS_TIMEDOUT',
    'ADGROUP_STATUS_FROZEN',
    'ADGROUP_STATUS_ARCHIVED',
    'ADGROUP_STATUS_DELETE',
  ] as const;

  for (const status of TIKTOK_ACTIVE_ENOUGH) {
    it(`${status} → active (enrolled as placeholder)`, () => {
      expect(isActiveForPlatform('tiktok', status)).toBe(true);
    });
  }

  for (const status of TIKTOK_OFF) {
    it(`${status} → not active (no placeholder enrollment)`, () => {
      expect(isActiveForPlatform('tiktok', status)).toBe(false);
    });
  }

  // Operator's exact production scenario.
  it('re-enabled campaign (DISABLE → DELIVERY_OK) qualifies for enrollment', () => {
    expect(isActiveForPlatform('tiktok', 'ADGROUP_STATUS_DELIVERY_OK')).toBe(true);
  });

  it('BUDGET_EXCEED (operator scenario: daily cap hit mid-day) qualifies', () => {
    // TikTok Ads Manager shows the campaign as Active until tomorrow.
    // Pre-fix code excluded it from placeholder enrollment, so the row
    // would disappear from the dashboard until the daily budget reset.
    expect(isActiveForPlatform('tiktok', 'ADGROUP_STATUS_BUDGET_EXCEED')).toBe(true);
  });

  it('AUDIT (new creative under TikTok review) qualifies', () => {
    expect(isActiveForPlatform('tiktok', 'ADGROUP_STATUS_AUDIT')).toBe(true);
  });

  it('REVIEWING (alternate review spelling) qualifies', () => {
    expect(isActiveForPlatform('tiktok', 'ADGROUP_STATUS_REVIEWING')).toBe(true);
  });

  it('NOT_START (scheduled, before start time) qualifies', () => {
    expect(isActiveForPlatform('tiktok', 'ADGROUP_STATUS_NOT_START')).toBe(true);
  });

  it('whitespace + lowercase is normalised before lookup', () => {
    expect(
      isActiveForPlatform('tiktok', '  adgroup_status_delivery_ok  '),
    ).toBe(true);
    expect(
      isActiveForPlatform('tiktok', '  adgroup_status_disable  '),
    ).toBe(false);
  });

  it('unknown future TikTok status → not active (fail-safe; no phantom enrollment)', () => {
    // Cron's fail-safe is the opposite of the dashboard chip's
    // (chip falls back to date heuristic). Here we'd rather skip
    // enrolling a placeholder row than invent one for a status we
    // can't classify — the existing rolling-window spend pipeline
    // still maintains the row from its own data path.
    expect(isActiveForPlatform('tiktok', 'ADGROUP_STATUS_FUTURE_UNKNOWN')).toBe(false);
  });

  it('cross-platform leakage rejected (Meta ACTIVE on TikTok branch → off)', () => {
    expect(isActiveForPlatform('tiktok', 'ACTIVE')).toBe(false);
  });

  it('cross-platform leakage rejected (Google ENABLED on TikTok branch → off)', () => {
    expect(isActiveForPlatform('tiktok', 'ENABLED')).toBe(false);
  });
});

describe('isActiveForPlatform — unknown platform', () => {
  it('returns false for any unrecognised platform name', () => {
    // Safer to skip enrollment than to invent a placeholder row for an
    // unmapped platform.
    expect(isActiveForPlatform('snapchat', 'ACTIVE')).toBe(false);
    expect(isActiveForPlatform('', 'ACTIVE')).toBe(false);
  });
});
