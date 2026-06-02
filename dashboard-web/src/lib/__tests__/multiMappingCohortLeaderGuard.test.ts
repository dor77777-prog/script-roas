import { describe, it, expect } from 'vitest';
import { qualifiesAsLeader } from '@/lib/multiMappingCohort';

// The trophy guard is display-only: leaderQualifies = isLeader && roasShopify >= 2.
// Extract it as a PURE function so it's tested with plain inputs — no cohort
// fixture needed, and the ranking/mapping math is never touched.
describe('qualifiesAsLeader — leader-badge display guard (2026-06-02)', () => {
  it('FALSE when not the leader, regardless of ROAS', () => {
    expect(qualifiesAsLeader(false, 5)).toBe(false);
  });
  it('FALSE when leader but ROAS < 2 (no trophy on a losing cohort)', () => {
    expect(qualifiesAsLeader(true, 1.4)).toBe(false);
  });
  it('TRUE when leader and ROAS >= 2', () => {
    expect(qualifiesAsLeader(true, 3.1)).toBe(true);
  });
  it('FALSE when leader but roasShopify is null/undefined', () => {
    expect(qualifiesAsLeader(true, null)).toBe(false);
  });
});
