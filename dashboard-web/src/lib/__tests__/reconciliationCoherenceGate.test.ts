// dashboard-web/src/lib/__tests__/reconciliationCoherenceGate.test.ts
//
// REGRESSION TEST — "Campaigns reconciliation shows unrelated numbers on a
// date switch" (data-correctness, root-caused 2026-06-01).
//
// SYMPTOM (operator): switching the date range in the Campaigns tab transiently
// renders WRONG/UNRELATED values in the "התאמת שיוך · Meta & Google & TikTok ↔
// Shopify" panel (over/under-count gap %, reliability ratio), which corrects
// after a refresh / playing with the dates again.
//
// ROOT CAUSE: that panel (`attributionGap` in CampaignsTable.tsx) reconciles a
// PLATFORM claim (from /api/campaigns, SWR-keyed on the in-table `localRange`)
// against SHOPIFY revenue (from the page-global /api/data prop `dailyRows`,
// fetched for the global `range` and re-sliced by `localRange`). Those two
// sources update on different triggers with different latencies, so for one-
// or-more render cycles after a date change they describe DIFFERENT windows —
// the panel then computes a gap from a mismatched pair (e.g. new-range Shopify
// revenue vs old-range platform claim, or a localRange that reaches outside the
// global window so the Shopify slice is structurally missing days).
//
// FIX: `isReconciliationCoherent` gates the panel so it only renders when the
// campaigns data in hand was fetched for the SAME window being compared AND the
// global window fully covers `localRange`. This test pins that invariant.

import { describe, expect, it } from 'vitest';
import { isReconciliationCoherent } from '@/lib/reconciliationCoherence';
import type { DateRange } from '@/lib/dateRange';

const R = (from: string, to: string): DateRange => ({ from, to });

describe('isReconciliationCoherent — attribution-gap data-coherence gate', () => {
  it('coherent: campaigns data and global range both match localRange', () => {
    const localRange = R('2026-05-01', '2026-05-31');
    expect(
      isReconciliationCoherent({
        localRange,
        globalRange: R('2026-05-01', '2026-05-31'),
        campaignsDataRange: R('2026-05-01', '2026-05-31'),
      }),
    ).toBe(true);
  });

  it('coherent: global range is WIDER than localRange (covers it)', () => {
    // dailyRows fetched for a 90-day global window; the operator narrowed the
    // in-table picker to a 7-day localRange. The narrower slice is fully
    // contained → coherent.
    expect(
      isReconciliationCoherent({
        localRange: R('2026-05-25', '2026-05-31'),
        globalRange: R('2026-03-03', '2026-05-31'),
        campaignsDataRange: R('2026-05-25', '2026-05-31'),
      }),
    ).toBe(true);
  });

  it('STALE PLATFORM SIDE: campaignsDataRange still on the PREVIOUS window → not coherent', () => {
    // The reported race: operator switched localRange to May, but SWR is still
    // serving the cached April campaigns response for one render. Comparing
    // April's platform claim against May's Shopify revenue = "unrelated
    // numbers". The gate must hide the panel until the campaigns fetch settles.
    expect(
      isReconciliationCoherent({
        localRange: R('2026-05-01', '2026-05-31'),
        globalRange: R('2026-04-01', '2026-05-31'),
        campaignsDataRange: R('2026-04-01', '2026-04-30'), // OLD window
      }),
    ).toBe(false);
  });

  it('NO PLATFORM DATA YET: campaignsDataRange null (first load) → not coherent', () => {
    expect(
      isReconciliationCoherent({
        localRange: R('2026-05-01', '2026-05-31'),
        globalRange: R('2026-05-01', '2026-05-31'),
        campaignsDataRange: null,
      }),
    ).toBe(false);
  });

  it('LOCALRANGE EXTENDS PAST GLOBAL (earlier from): Shopify slice missing days → not coherent', () => {
    // The in-table picker reaches BEFORE the global window. dailyRows (bounded
    // by the global range) has no rows for the leading days, so Shopify revenue
    // is undercounted → a bogus "platforms overcounting" gap. Hide it.
    expect(
      isReconciliationCoherent({
        localRange: R('2026-04-15', '2026-05-31'),
        globalRange: R('2026-05-01', '2026-05-31'), // starts AFTER localRange.from
        campaignsDataRange: R('2026-04-15', '2026-05-31'),
      }),
    ).toBe(false);
  });

  it('LOCALRANGE EXTENDS PAST GLOBAL (later to): Shopify slice missing trailing days → not coherent', () => {
    expect(
      isReconciliationCoherent({
        localRange: R('2026-05-01', '2026-06-10'),
        globalRange: R('2026-05-01', '2026-05-31'), // ends BEFORE localRange.to
        campaignsDataRange: R('2026-05-01', '2026-06-10'),
      }),
    ).toBe(false);
  });

  it('BOTH halves stale on the same OLD window but localRange already moved → not coherent', () => {
    // Mid-transition: localRange is the NEW window, but the campaigns snapshot
    // is still the OLD one. Even though global covers it, platform-side mismatch
    // alone must block the render.
    expect(
      isReconciliationCoherent({
        localRange: R('2026-05-20', '2026-05-31'),
        globalRange: R('2026-01-01', '2026-05-31'),
        campaignsDataRange: R('2026-05-01', '2026-05-19'),
      }),
    ).toBe(false);
  });

  it('exact-boundary coverage (localRange == globalRange == campaignsDataRange) is coherent', () => {
    const w = R('2026-05-10', '2026-05-20');
    expect(
      isReconciliationCoherent({
        localRange: w,
        globalRange: w,
        campaignsDataRange: { ...w },
      }),
    ).toBe(true);
  });
});
