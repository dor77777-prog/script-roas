// dashboard-web/src/lib/__tests__/platformConfig.test.ts
//
// AUDIT U-01 (2026-05-24) — regression tests for the shared TikTok
// active-enough set introduced to break the writer↔reader asymmetry
// in cronLive.ts (writer) ↔ postgresReaders.ts (reader).
//
// The whole point of extracting this set into `@/lib/platformConfig`
// is that the writer (`isActiveForPlatform` in cronLive.ts) and the
// reader (`readCampaignsDailyRows` in postgresReaders.ts) consume the
// SAME values. If a future edit silently mutates one entry on either
// side, OR if either consumer reverts to an inline literal, the
// dashboard chip + cron enrollment drift apart again.
//
// These tests do two jobs:
//   (1) PIN the exact 5-string contents of TIKTOK_ACTIVE_ENOUGH so any
//       mutation is caught by CI.
//   (2) Lock the symmetry contract: pre-fix, postgresReaders.ts checked
//       only 'ADGROUP_STATUS_DELIVERY_OK' inline. The fix means a
//       BUDGET_EXCEED row should now also count as currently-active.

import { describe, it, expect } from 'vitest';
import { TIKTOK_ACTIVE_ENOUGH } from '@/lib/platformConfig';

describe('TIKTOK_ACTIVE_ENOUGH (AUDIT U-01)', () => {
  it('contains exactly the 5 TikTok "delivering / preparing" statuses', () => {
    // Convert to a sorted array so the assertion is order-agnostic
    // (Set iteration order is insertion-order in JS, but we don't want
    // a future re-ordering of the literal to break this test silently).
    const actual = [...TIKTOK_ACTIVE_ENOUGH].sort();
    const expected = [
      'ADGROUP_STATUS_AUDIT',
      'ADGROUP_STATUS_BUDGET_EXCEED',
      'ADGROUP_STATUS_DELIVERY_OK',
      'ADGROUP_STATUS_NOT_START',
      'ADGROUP_STATUS_REVIEWING',
    ];
    expect(actual).toEqual(expected);
    expect(TIKTOK_ACTIVE_ENOUGH.size).toBe(5);
  });

  it('DELIVERY_OK is in the set (delivering normally)', () => {
    expect(TIKTOK_ACTIVE_ENOUGH.has('ADGROUP_STATUS_DELIVERY_OK')).toBe(true);
  });

  it('BUDGET_EXCEED is in the set (daily cap hit, resumes tomorrow)', () => {
    // Operator's exact 2026-05-23 production scenario — the bug the
    // U-01 fix targets.
    expect(TIKTOK_ACTIVE_ENOUGH.has('ADGROUP_STATUS_BUDGET_EXCEED')).toBe(true);
  });

  it('AUDIT is in the set (creative under review)', () => {
    expect(TIKTOK_ACTIVE_ENOUGH.has('ADGROUP_STATUS_AUDIT')).toBe(true);
  });

  it('REVIEWING is in the set (alternate review label)', () => {
    expect(TIKTOK_ACTIVE_ENOUGH.has('ADGROUP_STATUS_REVIEWING')).toBe(true);
  });

  it('NOT_START is in the set (scheduled, before start time)', () => {
    expect(TIKTOK_ACTIVE_ENOUGH.has('ADGROUP_STATUS_NOT_START')).toBe(true);
  });

  it('DISABLE is NOT in the set (truly paused)', () => {
    expect(TIKTOK_ACTIVE_ENOUGH.has('ADGROUP_STATUS_DISABLE')).toBe(false);
  });

  it('ARCHIVED is NOT in the set (terminal off-state)', () => {
    expect(TIKTOK_ACTIVE_ENOUGH.has('ADGROUP_STATUS_ARCHIVED')).toBe(false);
  });

  it('TIMEDOUT is NOT in the set', () => {
    expect(TIKTOK_ACTIVE_ENOUGH.has('ADGROUP_STATUS_TIMEDOUT')).toBe(false);
  });

  it('FROZEN is NOT in the set', () => {
    expect(TIKTOK_ACTIVE_ENOUGH.has('ADGROUP_STATUS_FROZEN')).toBe(false);
  });

  it('DELETE is NOT in the set', () => {
    expect(TIKTOK_ACTIVE_ENOUGH.has('ADGROUP_STATUS_DELETE')).toBe(false);
  });

  it('unknown future status is NOT in the set (fail-safe)', () => {
    // The set is closed: anything not explicitly enumerated falls
    // through to "not delivering" — so a new TikTok status the
    // platform invents tomorrow does NOT get auto-enrolled.
    expect(TIKTOK_ACTIVE_ENOUGH.has('ADGROUP_STATUS_FUTURE_UNKNOWN')).toBe(false);
  });

  it('cross-platform leakage rejected (Meta ACTIVE is not a TikTok active status)', () => {
    expect(TIKTOK_ACTIVE_ENOUGH.has('ACTIVE')).toBe(false);
  });

  it('cross-platform leakage rejected (Google ENABLED is not a TikTok active status)', () => {
    expect(TIKTOK_ACTIVE_ENOUGH.has('ENABLED')).toBe(false);
  });
});
