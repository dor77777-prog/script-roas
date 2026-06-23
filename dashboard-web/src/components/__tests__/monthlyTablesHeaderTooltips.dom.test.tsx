// Task 2 (2026-06-24) — HelpTooltip on the new Monthly-Tables columns.
//
// The רווח נקי / מרווח / ROAS columns were added to MonthBlockPerStore +
// MonthBlockSummary (MonthlyTables.tsx) and to MonthScorecardMatrix WITHOUT any
// help affordance. native title= is BANNED, so the column HEADERS now carry the
// sanctioned HelpTooltip ⓘ primitive (rich Popover on desktop, role="dialog").
//
// These tests assert, on each of the 3 surfaces: the help trigger renders for
// each metric (accessible name "הסבר על <metric>") AND clicking it reveals a
// role=dialog containing the metric's explanation text.
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { DailyRow } from '@/lib/types';
import { MonthBlockPerStore, MonthBlockSummary } from '@/components/MonthlyTables';
import { MonthScorecardMatrix } from '@/components/MonthScorecardMatrix';

function makeRow(over: Partial<DailyRow> & Pick<DailyRow, 'date'>): DailyRow {
  const fb = over.fbSpend ?? 0;
  const ga = over.gaSpend ?? 0;
  const tt = over.ttSpend ?? 0;
  const totalSpend = over.totalSpend ?? fb + ga + tt;
  const revenue = over.revenue ?? 0;
  return {
    storeId: over.storeId ?? 'store-1',
    storeName: over.storeName ?? 'store-1',
    fbSpend: fb,
    gaSpend: ga,
    ttSpend: tt,
    totalSpend,
    revenue,
    roas: totalSpend > 0 ? revenue / totalSpend : 0,
    grossProfit: 0,
    cogs: over.cogs ?? 0,
    netProfit: over.netProfit ?? 0,
    hasCogs: over.hasCogs ?? false,
    grossRevenue: null,
    refundDeduction: null,
    fbImpressions: null,
    gaImpressions: null,
    ttImpressions: null,
    ...over,
  };
}

const HEADER_HELP = [
  { metric: 'רווח נקי', re: /הכנסה פחות הוצאת-פרסום ופחות עלות-המוצר/ },
  { metric: 'מרווח', re: /רווח נקי כאחוז מההכנסה/ },
  { metric: 'ROAS', re: /החזר על הוצאת-פרסום/ },
] as const;

/** Find the help trigger in the THEAD by accessible name + assert its dialog. */
async function assertHeaderHelp(container: HTMLElement, metric: string, re: RegExp) {
  const trigger = screen.getByRole('button', { name: `הסבר על ${metric}` });
  expect(trigger).toBeInTheDocument();
  // The trigger lives in the table header, not the body.
  expect(container.querySelector('thead')!.contains(trigger)).toBe(true);
  fireEvent.click(trigger);
  const dialog = await screen.findByRole('dialog');
  expect(dialog.textContent ?? '').toMatch(re);
}

describe('MonthBlockPerStore — header HelpTooltips (רווח נקי / מרווח / ROAS)', () => {
  const rows: DailyRow[] = [
    makeRow({ date: '2026-06-01', fbSpend: 100, revenue: 400, netProfit: 100, hasCogs: true }),
  ];

  for (const { metric, re } of HEADER_HELP) {
    it(`renders a HelpTooltip on the ${metric} header with reachable explanation`, async () => {
      const { container } = render(
        <MonthBlockPerStore ym="2026-06" storeName="store-1" rows={rows} defaultOpen />,
      );
      await assertHeaderHelp(container, metric, re);
    });
  }
});

describe('MonthBlockSummary — header HelpTooltips (רווח נקי / מרווח / ROAS)', () => {
  const rows: DailyRow[] = [
    makeRow({ date: '2026-06-01', storeName: 'a', fbSpend: 100, revenue: 400, netProfit: 100, hasCogs: true }),
    makeRow({ date: '2026-06-01', storeName: 'b', fbSpend: 100, revenue: 600, netProfit: 200, hasCogs: true }),
  ];

  for (const { metric, re } of HEADER_HELP) {
    it(`renders a HelpTooltip on the ${metric} header with reachable explanation`, async () => {
      const { container } = render(
        <MonthBlockSummary ym="2026-06" rows={rows} stores={['a', 'b']} defaultOpen />,
      );
      await assertHeaderHelp(container, metric, re);
    });
  }
});

describe('MonthScorecardMatrix — header HelpTooltips (רווח נקי / מרווח / ROAS)', () => {
  const rows: DailyRow[] = [
    makeRow({ date: '2026-06-01', fbSpend: 100, revenue: 400, netProfit: 100, hasCogs: true }),
    makeRow({ date: '2026-06-02', fbSpend: 100, revenue: 600, netProfit: 250, hasCogs: true }),
  ];

  for (const { metric, re } of HEADER_HELP) {
    it(`renders a HelpTooltip on the ${metric} header with reachable explanation`, async () => {
      const { container } = render(<MonthScorecardMatrix rows={rows} />);
      await assertHeaderHelp(container, metric, re);
    });
  }

  it('does NOT use native title= on any header cell (native title is banned)', () => {
    const { container } = render(<MonthScorecardMatrix rows={rows} />);
    const titled = within(container.querySelector('thead')!).queryAllByTitle(/./);
    expect(titled).toHaveLength(0);
  });
});
