import { describe, expect, it } from 'vitest';
import {
  isCampaignCurrentlyOff,
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
