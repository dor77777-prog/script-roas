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

  /**
   * OPERATOR-1 audit fix (2026-05-23): TikTok status classification uses
   * explicit ACTIVE-enough vs. OFF sets instead of strict equality to
   * ADGROUP_STATUS_DELIVERY_OK. The operator reported that the previous
   * strict-equality check painted active campaigns as "כבוי" whenever
   * TikTok temporarily reported BUDGET_EXCEED (daily-cap hit), AUDIT
   * (creative review), REVIEWING (alternate spelling some endpoints
   * return), or NOT_START (scheduled but not yet started).
   *
   * Pre-fix expectations covered partial strings (BUDGET_EXCEED, FROZEN,
   * AUDIT, etc. without ADGROUP_STATUS_ prefix) — but real TikTok API
   * responses always carry the prefix, so the suite is rewritten to test
   * the actual production status taxonomy.
   *
   * Reference list (10 statuses total — all must be exercised below):
   *   Delivering / preparing (5 — return false):
   *     ADGROUP_STATUS_DELIVERY_OK   ADGROUP_STATUS_BUDGET_EXCEED
   *     ADGROUP_STATUS_AUDIT         ADGROUP_STATUS_REVIEWING
   *     ADGROUP_STATUS_NOT_START
   *   Truly off (5 — return true):
   *     ADGROUP_STATUS_DISABLE       ADGROUP_STATUS_TIMEDOUT
   *     ADGROUP_STATUS_FROZEN        ADGROUP_STATUS_ARCHIVED
   *     ADGROUP_STATUS_DELETE
   */
  describe('TikTok — ACTIVE-enough vs. OFF sets (OPERATOR-1, 2026-05-23)', () => {
    const TIKTOK_ACTIVE_ENOUGH = [
      'ADGROUP_STATUS_DELIVERY_OK',
      'ADGROUP_STATUS_BUDGET_EXCEED',
      'ADGROUP_STATUS_AUDIT',
      'ADGROUP_STATUS_REVIEWING',
      'ADGROUP_STATUS_NOT_START',
    ] as const;
    const TIKTOK_OFF_STATUSES = [
      'ADGROUP_STATUS_DISABLE',
      'ADGROUP_STATUS_TIMEDOUT',
      'ADGROUP_STATUS_FROZEN',
      'ADGROUP_STATUS_ARCHIVED',
      'ADGROUP_STATUS_DELETE',
    ] as const;

    // Strict — exercise ALL 5 active-enough statuses.
    for (const status of TIKTOK_ACTIVE_ENOUGH) {
      it(`${status} → not off`, () => {
        expect(isCampaignOff(status, 'tiktok', '2026-05-20', '2026-05-20')).toBe(false);
      });
    }

    // Strict — exercise ALL 5 off statuses.
    for (const status of TIKTOK_OFF_STATUSES) {
      it(`${status} → off`, () => {
        expect(isCampaignOff(status, 'tiktok', '2026-05-20', '2026-05-20')).toBe(true);
      });
    }

    // Operator scenario: campaign was DISABLE → re-enabled → returns
    // DELIVERY_OK. Should now read as ON.
    it('re-enabled campaign (DISABLE → DELIVERY_OK) reads as ON', () => {
      expect(
        isCampaignOff('ADGROUP_STATUS_DELIVERY_OK', 'tiktok', '2026-05-20', '2026-05-20'),
      ).toBe(false);
    });

    // Operator scenario: campaign hit daily cap mid-day. TikTok Ads
    // Manager shows it as Active, but TikTok's status field returns
    // BUDGET_EXCEED until midnight. The chip MUST NOT flip to "off".
    it('BUDGET_EXCEED (daily cap hit mid-day) reads as ON (operator scenario)', () => {
      expect(
        isCampaignOff('ADGROUP_STATUS_BUDGET_EXCEED', 'tiktok', '2026-05-20', '2026-05-20'),
      ).toBe(false);
    });

    // Operator scenario: brand-new creative under TikTok review.
    it('AUDIT (creative review) reads as ON', () => {
      expect(
        isCampaignOff('ADGROUP_STATUS_AUDIT', 'tiktok', '2026-05-20', '2026-05-20'),
      ).toBe(false);
    });

    it('REVIEWING (alternate review spelling) reads as ON', () => {
      expect(
        isCampaignOff('ADGROUP_STATUS_REVIEWING', 'tiktok', '2026-05-20', '2026-05-20'),
      ).toBe(false);
    });

    it('NOT_START (scheduled, not yet at start time) reads as ON', () => {
      expect(
        isCampaignOff('ADGROUP_STATUS_NOT_START', 'tiktok', '2026-05-20', '2026-05-20'),
      ).toBe(false);
    });

    it('ACTIVE (Meta state on TikTok) → not in either TikTok set → falls through to date heuristic', () => {
      // 2026-05-20 - 2 = 2026-05-18 threshold. lastActive '2026-05-20' is on/after threshold → not off.
      expect(isCampaignOff('ACTIVE', 'tiktok', '2026-05-20', '2026-05-20')).toBe(false);
      // Old lastActive → date heuristic fires → off.
      expect(isCampaignOff('ACTIVE', 'tiktok', '2026-05-10', '2026-05-20')).toBe(true);
    });

    it('ENABLED (Google state on TikTok) → not in either TikTok set → falls through to date heuristic', () => {
      expect(isCampaignOff('ENABLED', 'tiktok', '2026-05-20', '2026-05-20')).toBe(false);
      expect(isCampaignOff('ENABLED', 'tiktok', '2026-05-10', '2026-05-20')).toBe(true);
    });

    it('unknown future TikTok status → falls through to date heuristic (fail-safe)', () => {
      // If TikTok ships a brand-new status value we haven't classified,
      // we trust the lastActiveDate heuristic rather than risk flipping
      // a live campaign to "off" on a single bad classification.
      expect(
        isCampaignOff('ADGROUP_STATUS_FUTURE_UNKNOWN', 'tiktok', '2026-05-20', '2026-05-20'),
      ).toBe(false);
      expect(
        isCampaignOff('ADGROUP_STATUS_FUTURE_UNKNOWN', 'tiktok', '2026-05-10', '2026-05-20'),
      ).toBe(true);
    });

    it('status is whitespace-trimmed and uppercased before lookup', () => {
      // TikTok API has been observed returning padded strings; the helper
      // normalises before lookup.
      expect(
        isCampaignOff('  adgroup_status_delivery_ok  ', 'tiktok', '2026-05-20', '2026-05-20'),
      ).toBe(false);
      expect(
        isCampaignOff('  adgroup_status_disable  ', 'tiktok', '2026-05-20', '2026-05-20'),
      ).toBe(true);
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
