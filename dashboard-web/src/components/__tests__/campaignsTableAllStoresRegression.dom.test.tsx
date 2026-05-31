// dashboard-web/src/components/__tests__/campaignsTableAllStoresRegression.dom.test.tsx
//
// REGRESSION TEST — "Campaigns tab empty when All stores selected" (Round 3).
//
// History:
//   - First seen: pre-`a919e2a`. Filters' "all stores" option emitted 'All',
//     but several CampaignsTable filter sites did `localStore !== 'All'`
//     which mishandled lowercase / `__all__` / '' sentinels coming from
//     URL-restored / cloud-synced state. Fixed in `a919e2a` by introducing
//     `STORE_ALL_SENTINELS` + `isAllStores()` helper + sentinel-aware
//     filter in `lib/campaignsAggregator.ts`.
//   - Returned (round 3 — this commit) after the `4b51ddd` Filters.tsx
//     horizontal-strip rewrite. The rewrite did not change the emitted
//     value ('All' is preserved on line 132), but the user reported the
//     Campaigns tab empty again. Audit confirmed the existing fix is
//     intact at the data layer — this test pins the END-TO-END contract
//     so any future Filters rewrite that drifts the emitted "all stores"
//     value (e.g. to '' / undefined / '__all__') trips immediately.
//
// What this test does:
//   1. Render <Filters> with a non-"All" store selected.
//   2. Programmatically change the store <select> back to its "all stores"
//      option (the FIRST option, value="All" today).
//   3. Capture the value Filters emits via the `onChange` prop.
//   4. Feed that exact value into `aggregate()` with rows spanning multiple
//      stores. Assert all rows survive.
//
// This intentionally treats Filters as a black box — we don't hard-code
// the expected emitted value. The test asserts the contract: "whatever
// Filters emits when 'all stores' is selected must be accepted as the
// all-stores wildcard by the aggregator." That contract is what broke
// in round 1 and what this commit re-locks in round 3.

import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

import { Filters } from '../Filters';
import { aggregate } from '@/lib/campaignsAggregator';
import type { Filters as F } from '@/lib/types';
import type { CampaignRow } from '@/lib/campaigns';

const RANGE = { from: '2026-05-01', to: '2026-05-31' };

function makeRow(over: Partial<CampaignRow>): CampaignRow {
  const base: CampaignRow = {
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    platform: 'Meta',
    campaignId: 'camp-1',
    campaignName: 'Campaign 1',
    adSetId: 'adset-1',
    adSetName: 'Ad Set 1',
    date: '2026-05-15',
    spend: 100,
    conversionValue: 200,
    impressions: 1000,
    clicks: 25,
    conversions: 1,
    campaignBudgetCad: 50,
    adSetBudgetCad: 25,
    budgetType: 'CBO',
    effectiveStatus: null,
    regConfiguredStatus: null,
    regEffectiveStatus: null,
    regDeliveryStatus: null,
    regFirstSeenAt: null,
    regStatusChangedAt: null,
    regLastStatusSuccessAt: null,
  };
  return { ...base, ...over };
}

const MULTI_STORE_ROWS: CampaignRow[] = [
  makeRow({ storeId: 'uzoshop',   storeName: 'uzoshop',   platform: 'Meta',   campaignId: 'c1' }),
  makeRow({ storeId: '360usmile', storeName: '360usmile', platform: 'Google', campaignId: 'c2' }),
  makeRow({ storeId: 'zolplus',   storeName: 'Zol Plus',  platform: 'TikTok', campaignId: 'c3' }),
];

const BASE_FILTERS: F = {
  preset: 'custom',
  range: RANGE,
  store: 'uzoshop', // start narrowed; we'll switch to "all" below
};

describe('CampaignsTable "all stores" regression — round 3 (Filters rewrite leak)', () => {
  it('Filters emits a sentinel value for the all-stores option that the aggregator treats as wildcard', () => {
    // Capture what Filters emits when the user picks "all stores".
    const onChange = vi.fn();
    const { container } = render(
      <Filters
        filters={BASE_FILTERS}
        stores={['uzoshop', '360usmile', 'Zol Plus']}
        onChange={onChange}
      />,
    );

    // Locate the store <select>. The store picker is the only <select> in
    // Filters today; if a future change adds another, this query needs to
    // become more specific (e.g. data-testid). We assert exactly-one so the
    // test fails loudly rather than silently picking the wrong element.
    const selects = container.querySelectorAll('select');
    expect(selects.length, 'Filters should render exactly one <select> (the store picker)').toBe(1);
    const storeSelect = selects[0] as HTMLSelectElement;

    // The "all stores" option is the FIRST option in the picker today
    // (`<option value="All">כל החנויות</option>`). Read it from the DOM
    // rather than hardcoding 'All' so the test catches a future rename.
    const firstOption = storeSelect.options[0];
    expect(firstOption, 'store picker should have at least one option').toBeDefined();
    const allStoresValue = firstOption.value;

    // Fire the change. Note: even though Filters was rendered with
    // store='uzoshop', the test triggers a NEW selection — the value must
    // flow through onChange whether or not React's controlled-input parity
    // matches.
    fireEvent.change(storeSelect, { target: { value: allStoresValue } });

    expect(onChange).toHaveBeenCalledOnce();
    const emitted = onChange.mock.calls[0][0] as F;
    expect(emitted.store, 'Filters should emit the picker option value verbatim').toBe(allStoresValue);

    // The CONTRACT we re-lock: this value, fed to the aggregator, returns
    // rows from ALL stores (not zero rows, which is the user-visible bug).
    const out = aggregate(MULTI_STORE_ROWS, 'campaign', emitted.store, 'all', RANGE);
    expect(
      out.length,
      `aggregate(rows, 'campaign', '${emitted.store}', 'all', range) should treat '${emitted.store}' as the all-stores wildcard and return all 3 rows`,
    ).toBe(3);
    const stores = new Set(out.map(a => a.storeName));
    expect(stores).toEqual(new Set(['uzoshop', '360usmile', 'Zol Plus']));
  });

  it('every plausible "all stores" sentinel collapses to the wildcard at the aggregator', () => {
    // Defence-in-depth: even if a future refactor of Filters silently
    // changes the emitted "all stores" value to one of these alternative
    // sentinels (lowercase / undefined-ish / cloud-sync placeholder), the
    // aggregator must still return ALL stores' rows. This is the row-level
    // contract that makes the Campaigns tab self-healing against UI
    // refactors.
    for (const sentinel of ['All', 'all', '__all__', '']) {
      const out = aggregate(MULTI_STORE_ROWS, 'campaign', sentinel, 'all', RANGE);
      expect(
        out.length,
        `sentinel="${sentinel}" must be treated as the all-stores wildcard`,
      ).toBe(3);
    }
  });

  it('Filters re-renders with store="All" and the "all stores" option is selected', () => {
    // Symmetric check: when the parent passes back store='All' (the
    // canonical sentinel today), the <select>'s current value matches the
    // first option. Catches a future bug where Filters' picker emits a
    // value the picker itself cannot display (controlled-input mismatch
    // warning + visible "first option fallback" UX bug).
    const onChange = vi.fn();
    const { container } = render(
      <Filters
        filters={{ ...BASE_FILTERS, store: 'All' }}
        stores={['uzoshop', '360usmile', 'Zol Plus']}
        onChange={onChange}
      />,
    );
    const storeSelect = container.querySelector('select') as HTMLSelectElement;
    expect(storeSelect.value).toBe('All');
    // The selected option's label is the Hebrew "all stores" copy. Pin it
    // so a copy change is at least visible in the test diff.
    const selectedOption = storeSelect.options[storeSelect.selectedIndex];
    expect(selectedOption.textContent).toBe('כל החנויות');
  });
});
