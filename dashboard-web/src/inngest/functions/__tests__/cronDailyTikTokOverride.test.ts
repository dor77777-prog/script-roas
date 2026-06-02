// dashboard-web/src/inngest/functions/__tests__/cronDailyTikTokOverride.test.ts
//
// TikTok manual-override unblock (2026-06-02) — consumer-side guard.
//
// Task 7 review fix: the write/UI unblock is only meaningful if cronDaily
// actually APPLIES a TikTok override to the persisted per-store tt_spend_cad.
// `chooseTikTokSpendCad` is the pure decision the persist-batch uses: when a
// TikTok manual-override exists for (store, date) the operator's FX'd value is
// authoritative and wins — even over a null fetched value (FX outage). When no
// override exists, the fetched/FX'd value stands (possibly null → tt_spend_cad
// omitted, ON CONFLICT preserves prior; agg RPC may re-derive later).

import { describe, it, expect } from 'vitest';
import { chooseTikTokSpendCad } from '@/inngest/functions/cronDaily';

describe('chooseTikTokSpendCad', () => {
  it('uses the override value when overridesApplied.tiktok is true', () => {
    expect(
      chooseTikTokSpendCad({ overrideApplied: true, overrideCad: 280, fetchedCad: 999 }),
    ).toBe(280);
  });

  it('uses the fetched value when no override applied', () => {
    expect(
      chooseTikTokSpendCad({ overrideApplied: false, overrideCad: 0, fetchedCad: 100 }),
    ).toBe(100);
  });

  it('passes through null fetched (FX failure) when no override', () => {
    expect(
      chooseTikTokSpendCad({ overrideApplied: false, overrideCad: 0, fetchedCad: null }),
    ).toBeNull();
  });

  it('override wins even when fetched is null (operator value is authoritative)', () => {
    expect(
      chooseTikTokSpendCad({ overrideApplied: true, overrideCad: 140, fetchedCad: null }),
    ).toBe(140);
  });
});
