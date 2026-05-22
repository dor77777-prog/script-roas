import { describe, expect, it } from 'vitest';
import {
  isCampaignCurrentlyOff,
  isCampaignOff,
  OFF_RECENCY_DAYS,
} from '@/components/CampaignsTableRow';

/**
 * FIX-26: locks the contract of `isCampaignCurrentlyOff`. The helper drives
 * the "currently off" chip in CampaignsTableRow: a campaign that hasn't run
 * (spend > 0) in the last OFF_RECENCY_DAYS days is considered paused, and
 * the row gets a muted chip so the operator knows the historical-range
 * numbers don't reflect a live campaign.
 */

describe('isCampaignCurrentlyOff — locks FIX-26 contract', () => {
  it('OFF_RECENCY_DAYS is 2 (matches Apps Script collection cadence)', () => {
    expect(OFF_RECENCY_DAYS).toBe(2);
  });

  it('returns true when last active date is older than today − 2 days', () => {
    // Today: 2026-05-20 → threshold: 2026-05-18. Anything strictly < 18 fires.
    expect(isCampaignCurrentlyOff('2026-05-17', '2026-05-20')).toBe(true);
    expect(isCampaignCurrentlyOff('2026-05-10', '2026-05-20')).toBe(true);
    expect(isCampaignCurrentlyOff('2026-04-01', '2026-05-20')).toBe(true);
  });

  it('returns false when last active date is the threshold itself', () => {
    // Threshold = today − 2 days. lastActive === threshold means the
    // campaign ran on the threshold day, which counts as "still active".
    expect(isCampaignCurrentlyOff('2026-05-18', '2026-05-20')).toBe(false);
  });

  it('returns false when last active date is yesterday', () => {
    // The 2-day buffer protects against false-positives during Apps Script
    // collection latency — a campaign that ran yesterday is still active.
    expect(isCampaignCurrentlyOff('2026-05-19', '2026-05-20')).toBe(false);
  });

  it('returns false when last active date is today', () => {
    expect(isCampaignCurrentlyOff('2026-05-20', '2026-05-20')).toBe(false);
  });

  it('returns false when lastActiveDate is null (no spend ever in range)', () => {
    expect(isCampaignCurrentlyOff(null, '2026-05-20')).toBe(false);
  });

  it('fails open (returns false) when today is malformed', () => {
    expect(isCampaignCurrentlyOff('2026-05-10', 'not-a-date')).toBe(false);
    expect(isCampaignCurrentlyOff('2026-05-10', '20260520')).toBe(false);
    expect(isCampaignCurrentlyOff('2026-05-10', '')).toBe(false);
  });

  it('handles month boundaries correctly', () => {
    // Today: 2026-06-01 → threshold: 2026-05-30. lastActive=2026-05-29 fires.
    expect(isCampaignCurrentlyOff('2026-05-29', '2026-06-01')).toBe(true);
    // lastActive=2026-05-30 is the threshold itself → not off.
    expect(isCampaignCurrentlyOff('2026-05-30', '2026-06-01')).toBe(false);
  });

  it('handles year boundaries correctly', () => {
    // Today: 2027-01-01 → threshold: 2026-12-30. lastActive=2026-12-29 fires.
    expect(isCampaignCurrentlyOff('2026-12-29', '2027-01-01')).toBe(true);
    expect(isCampaignCurrentlyOff('2026-12-30', '2027-01-01')).toBe(false);
  });
});

/**
 * Phase 05.7.x — `isCampaignOff` consumes the real `effective_status`
 * from the platform when available, falling back to the FIX-26 date
 * heuristic otherwise. Active states per platform:
 *   Meta:   'ACTIVE'
 *   Google: 'ENABLED'
 *   TikTok: 'ADGROUP_STATUS_DELIVERY_OK'
 * Anything else (PAUSED, ARCHIVED, etc.) is treated as off.
 */
describe('isCampaignOff — locks Phase 05.7.x effective_status contract', () => {
  describe('Meta — ACTIVE is the only on-state', () => {
    it('ACTIVE → not off', () => {
      expect(isCampaignOff('ACTIVE', 'meta', '2026-05-20', '2026-05-20')).toBe(false);
    });
    it('PAUSED → off', () => {
      expect(isCampaignOff('PAUSED', 'meta', '2026-05-20', '2026-05-20')).toBe(true);
    });
    it('CAMPAIGN_PAUSED → off', () => {
      expect(isCampaignOff('CAMPAIGN_PAUSED', 'meta', '2026-05-20', '2026-05-20')).toBe(true);
    });
    it('ADSET_PAUSED → off', () => {
      expect(isCampaignOff('ADSET_PAUSED', 'meta', '2026-05-20', '2026-05-20')).toBe(true);
    });
    it('ARCHIVED → off', () => {
      expect(isCampaignOff('ARCHIVED', 'meta', '2026-05-20', '2026-05-20')).toBe(true);
    });
    it('DISAPPROVED → off (effective_status from Meta when ads rejected)', () => {
      expect(isCampaignOff('DISAPPROVED', 'meta', '2026-05-20', '2026-05-20')).toBe(true);
    });
    it('WITH_ISSUES → off (Meta flags spent without serving)', () => {
      expect(isCampaignOff('WITH_ISSUES', 'meta', '2026-05-20', '2026-05-20')).toBe(true);
    });
    it('lowercase active → off (status comparison is case-insensitive after upper)', () => {
      // The helper normalises to upper, so 'active' should equal 'ACTIVE'.
      expect(isCampaignOff('active', 'meta', '2026-05-20', '2026-05-20')).toBe(false);
    });
  });

  describe('Google — ENABLED is the only on-state', () => {
    it('ENABLED → not off', () => {
      expect(isCampaignOff('ENABLED', 'google', '2026-05-20', '2026-05-20')).toBe(false);
    });
    it('PAUSED → off (Google distinguishes from Meta PAUSED but same semantics)', () => {
      expect(isCampaignOff('PAUSED', 'google', '2026-05-20', '2026-05-20')).toBe(true);
    });
    it('REMOVED → off', () => {
      expect(isCampaignOff('REMOVED', 'google', '2026-05-20', '2026-05-20')).toBe(true);
    });
    it('ACTIVE (Meta state on Google) → off (Google never returns ACTIVE)', () => {
      // Sanity check: cross-platform leakage is rejected, not silently
      // accepted. If Meta-style 'ACTIVE' ever leaked into a Google row,
      // we'd rather show off than green-light a non-active campaign.
      expect(isCampaignOff('ACTIVE', 'google', '2026-05-20', '2026-05-20')).toBe(true);
    });
  });

  describe('TikTok — ADGROUP_STATUS_DELIVERY_OK is the only on-state', () => {
    it('ADGROUP_STATUS_DELIVERY_OK → not off', () => {
      expect(
        isCampaignOff('ADGROUP_STATUS_DELIVERY_OK', 'tiktok', '2026-05-20', '2026-05-20'),
      ).toBe(false);
    });
    it('ADGROUP_STATUS_DISABLE → off', () => {
      expect(isCampaignOff('ADGROUP_STATUS_DISABLE', 'tiktok', '2026-05-20', '2026-05-20')).toBe(
        true,
      );
    });
    it('BUDGET_EXCEED → off', () => {
      expect(isCampaignOff('BUDGET_EXCEED', 'tiktok', '2026-05-20', '2026-05-20')).toBe(true);
    });
    it('FROZEN → off', () => {
      expect(isCampaignOff('FROZEN', 'tiktok', '2026-05-20', '2026-05-20')).toBe(true);
    });
    it('DELETE → off', () => {
      expect(isCampaignOff('DELETE', 'tiktok', '2026-05-20', '2026-05-20')).toBe(true);
    });
    it('AUDIT → off (TikTok review state)', () => {
      expect(isCampaignOff('AUDIT', 'tiktok', '2026-05-20', '2026-05-20')).toBe(true);
    });
    it('ACTIVE (Meta state on TikTok) → off (TikTok never returns ACTIVE)', () => {
      expect(isCampaignOff('ACTIVE', 'tiktok', '2026-05-20', '2026-05-20')).toBe(true);
    });
    it('ENABLED (Google state on TikTok) → off', () => {
      expect(isCampaignOff('ENABLED', 'tiktok', '2026-05-20', '2026-05-20')).toBe(true);
    });
  });

  describe('fallback to date heuristic when status is null', () => {
    it('null effectiveStatus + old lastActiveDate → off (date heuristic fires)', () => {
      // 2026-05-17 is 3 days before 2026-05-20, past the 2-day buffer.
      expect(isCampaignOff(null, 'meta', '2026-05-17', '2026-05-20')).toBe(true);
    });
    it('null effectiveStatus + recent lastActiveDate → not off (still within buffer)', () => {
      // 2026-05-19 is yesterday — within the 2-day buffer.
      expect(isCampaignOff(null, 'meta', '2026-05-19', '2026-05-20')).toBe(false);
    });
    it('null effectiveStatus + null lastActiveDate → not off (no signal at all)', () => {
      expect(isCampaignOff(null, 'meta', null, '2026-05-20')).toBe(false);
    });
    it('empty-string effectiveStatus is treated as null (falsy)', () => {
      // The `if (effectiveStatus)` guard skips empty strings, so we fall
      // through to the date heuristic.
      expect(isCampaignOff('', 'meta', '2026-05-17', '2026-05-20')).toBe(true);
    });
  });

  describe('unknown platform falls back to date heuristic', () => {
    it('unknown platform + non-empty status → falls through to date heuristic', () => {
      // We don't want to mis-flag a row as off just because we got a
      // status string we don't know how to interpret. Falling back to
      // the date heuristic is the safe option.
      expect(isCampaignOff('SOME_NEW_STATE', 'snapchat', '2026-05-17', '2026-05-20')).toBe(true);
      expect(isCampaignOff('SOME_NEW_STATE', 'snapchat', '2026-05-19', '2026-05-20')).toBe(false);
    });
    it('empty platform string → falls through to date heuristic', () => {
      expect(isCampaignOff('ACTIVE', '', '2026-05-17', '2026-05-20')).toBe(true);
    });
  });

  describe('case normalisation', () => {
    it('platform is matched case-insensitively', () => {
      // 'Meta' / 'META' / 'meta' all behave the same.
      expect(isCampaignOff('ACTIVE', 'META', '2026-05-20', '2026-05-20')).toBe(false);
      expect(isCampaignOff('ACTIVE', 'Meta', '2026-05-20', '2026-05-20')).toBe(false);
    });
    it('status whitespace is trimmed', () => {
      // The Meta API sometimes returns padded strings; status is trimmed
      // before comparison.
      expect(isCampaignOff('  ACTIVE  ', 'meta', '2026-05-20', '2026-05-20')).toBe(false);
    });
  });

  describe('status wins over date heuristic when both available', () => {
    it('explicit ACTIVE wins even when last active date is old', () => {
      // Platform says it's on right now — trust the platform, not our
      // 2-day cadence buffer. (This case is the whole point of the
      // Phase 05.7.x upgrade.)
      expect(isCampaignOff('ACTIVE', 'meta', '2026-04-01', '2026-05-20')).toBe(false);
    });
    it('explicit PAUSED wins even when campaign ran today', () => {
      // Symmetric: platform says off, even though we have spend today
      // (e.g., the operator paused the campaign 30 min ago).
      expect(isCampaignOff('PAUSED', 'meta', '2026-05-20', '2026-05-20')).toBe(true);
    });
  });
});
