// dashboard-web/src/components/__tests__/pnlBreakdownScopedFixedCosts.dom.test.tsx
//
// 2026-06-11 adversarial review (D4 internal reconciliation, confirmed):
// PnLBreakdown computed its OWN `billingForRange` for the by-source
// fixed-costs table with storeNames = the SINGLETON visible store — so in a
// single-store view every All-scoped row charged its FULL business-wide
// amount into the table while the cascade line directly above it (from
// aggregate()'s D4 fair share) showed only the store's share: two
// contradicting fixed-cost totals on the SAME card.
//
// Fix under test: Dashboard threads the SAME scopedStoreNames (full store
// universe) + unfiltered revenueByStore split that curAgg was aggregated
// with; PnLBreakdown's billingForRange uses them and scales the by-source
// rows to the store's fair share so Σ sources == cascade fixedCosts.
//
//   - single-store filter + one $60/mo All-scoped row across 3 stores
//     → the by-source row shows the 1/3 share ($20) and the table total
//       equals current.fixedCosts ($20), never the full $60.
//   - 'All' view (no scoped props) stays byte-identical: full $60.
//   - empty-rows store view (current.fixedCosts = 0 post empty-bucket fix)
//     → table total reconciles to 0, no orphan source rows.

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { PnLBreakdown } from '@/components/PnLBreakdown';
import type { Aggregate } from '@/lib/analytics';

const RECURRING_KEY = 'roas-dashboard:billing-recurring';
const ONETIME_KEY = 'roas-dashboard:billing-onetime';

// Full calendar May → D3 calendar proration charges exactly the monthly CAD.
const FROM = '2026-05-01';
const TO = '2026-05-31';

function agg(over: Partial<Aggregate>): Aggregate {
  return {
    revenue: 1000, grossRevenue: 1000, spend: 200, fbSpend: 0, gaSpend: 0, ttSpend: 0, roas: 5,
    grossProfit: 800, cogs: 250, netProfit: 550,
    transactionFees: 65, fixedCosts: 20, storeCount: 1, daysCovered: 31,
    salaries: 0, trueNetProfit: 1000 - 200 - 250 - 65 - 20,
    trueMargin: (1000 - 200 - 250 - 65 - 20) / 1000, rowCount: 31,
    ...over,
  };
}

function seedAllScopedKlaviyo() {
  window.localStorage.setItem(
    RECURRING_KEY,
    JSON.stringify([
      { id: 'r1', store: 'All', name: 'Klaviyo', source: 'email', monthlyCAD: 60, active: true },
    ]),
  );
  window.localStorage.setItem(ONETIME_KEY, JSON.stringify([]));
}

function sourceRow(label: string): HTMLTableRowElement {
  const cell = screen.getByText(label);
  const row = cell.closest('tr');
  if (!row) throw new Error(`no <tr> for ${label}`);
  return row as HTMLTableRowElement;
}

beforeEach(() => {
  window.localStorage.clear();
  seedAllScopedKlaviyo();
});

describe('PnLBreakdown by-source fixed costs — D4 store-scope reconciliation', () => {
  it('single-store view: All-scoped $60/mo across 3 stores → source row shows the 1/3 share and Σ sources == cascade fixedCosts', () => {
    // current = the store-filtered aggregate, whose fixedCosts is the D4
    // fair share: $60 flat All-row / 3 stores = $20.
    render(
      <PnLBreakdown
        current={agg({ fixedCosts: 20 })}
        storeNames={['uzoshop']}
        scopedStoreNames={['uzoshop', 'Zol Plus', '360usmile']}
        revenueByStore={{ uzoshop: 1000, 'Zol Plus': 2000, '360usmile': 3000 }}
        rangeFrom={FROM}
        rangeTo={TO}
        rows={[]}
      />,
    );

    // The email source row ("שירות אימייל") shows the store's $20 share —
    // NOT the full business-wide $60.
    const email = sourceRow('שירות אימייל');
    expect(within(email).getByText('20')).toBeTruthy();
    expect(within(email).queryByText('60')).toBeNull();

    // The "סך הכל" row reconciles EXACTLY to the cascade's fixedCosts (20).
    const total = sourceRow('סך הכל');
    expect(within(total).getByText('20')).toBeTruthy();
    expect(within(total).queryByText('60')).toBeNull();

    // Cascade line itself still renders (same card, same number upstream).
    expect(screen.getByText('הוצאות קבועות (יחסי)')).toBeTruthy();
  });

  it("'All' view stays byte-identical: no scoped props → full $60 in both the source row and the total", () => {
    render(
      <PnLBreakdown
        current={agg({ revenue: 6000, fixedCosts: 60, storeCount: 3 })}
        storeNames={['uzoshop', 'Zol Plus', '360usmile']}
        rangeFrom={FROM}
        rangeTo={TO}
        rows={[]}
      />,
    );
    expect(within(sourceRow('שירות אימייל')).getByText('60')).toBeTruthy();
    expect(within(sourceRow('סך הכל')).getByText('60')).toBeTruthy();
  });

  it('store view with EMPTY rows (current.fixedCosts = 0 after the empty-bucket fix): table reconciles to 0, no orphan source rows', () => {
    render(
      <PnLBreakdown
        current={agg({
          revenue: 0, grossRevenue: 0, spend: 0, cogs: 0, transactionFees: 0,
          fixedCosts: 0, trueNetProfit: 0, trueMargin: 0, rowCount: 0, daysCovered: 0,
        })}
        storeNames={['uzoshop']}
        scopedStoreNames={['uzoshop', 'Zol Plus', '360usmile']}
        revenueByStore={{ uzoshop: 0, 'Zol Plus': 2000, '360usmile': 3000 }}
        rangeFrom={FROM}
        rangeTo={TO}
        rows={[]}
      />,
    );
    // Scaled-to-zero source rows are filtered out (> 0 filter) — only the
    // total row remains, and it shows 0 (== cascade's fixedCosts), not the
    // business-wide $60.
    expect(screen.queryByText('שירות אימייל')).toBeNull();
    const total = sourceRow('סך הכל');
    expect(within(total).getByText('0')).toBeTruthy();
    expect(within(total).queryByText('60')).toBeNull();
  });

  it('calendar-proration note: the retired "ימים מתוך 30" copy is gone, calendar-month phrasing is present', () => {
    // 2026-06-11 review (stale copy): D3 moved billing to true calendar-month
    // proration (prorateMonthlyCad), so the fixed-costs note must not claim
    // the retired days/30 convention.
    render(
      <PnLBreakdown
        current={agg({ fixedCosts: 20 })}
        storeNames={['uzoshop']}
        scopedStoreNames={['uzoshop', 'Zol Plus', '360usmile']}
        revenueByStore={{ uzoshop: 1000, 'Zol Plus': 2000, '360usmile': 3000 }}
        rangeFrom={FROM}
        rangeTo={TO}
        rows={[]}
      />,
    );
    expect(screen.queryByText(/ימים מתוך 30/)).toBeNull();
    expect(screen.getByText(/פרורציה לפי החודש הקלנדרי/)).toBeTruthy();
  });
});
