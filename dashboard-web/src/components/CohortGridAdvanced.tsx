'use client';

/**
 * Wave 2 Task 8 — advanced (collapsed) cohort retention grid (port of the v3c
 * mockup `customer-value-v3c-zones.html` → `drawGrid`).
 *
 * Rows = first-order month · columns = months-since (M0..M11) · cell = % of the
 * cohort still active that month (active_customers[m] ÷ cohort M0). Lives in a
 * collapsed <details> so the analyst view never crowds the primary v3c layout
 * (no info loss — the full triangle is one click away).
 *
 * Token-driven heatmap: cell tint is `color-mix(in srgb, var(--status-green) N%,
 * var(--glass-2))` — N capped so the neutral surface dominates and `text-ink`
 * keeps WCAG-AA contrast at every intensity (no white-on-pale-green). Future
 * cells (m > cohort age) render as a striped, dimmed placeholder.
 *
 * CAPI-safe: pure presentation over the aggregated Shopify cohort numbers.
 */
import { useMemo } from 'react';
import { TableBase } from '@/components/ui/TableBase';
import { COHORT_HORIZON } from '@/lib/home/customerValue';
import { monthsBetween } from '@/lib/cohorts/cohortAggregate';
import type { CohortMonthlyRow } from '@/lib/postgresReaders';

export interface CohortGridAdvancedProps {
  /** Cohort cells already scoped to the active store/business selection. */
  rows: CohortMonthlyRow[];
  /** 'YYYY-MM' reference month — caps how many cells a cohort can have data for. */
  todayMonth: string;
}

interface GridRow {
  month: string;
  /** retention % (0..100) per month_since; null = future (no data yet). */
  cells: Array<number | null>;
}

/**
 * Heatmap mix-percent for the green tint (0..55). Square-root eases the low end
 * so a 7%-retention cell still reads as faintly green without ever getting dark
 * enough to fail `text-ink` contrast. Capped at 55% (neutral surface dominates).
 */
function tintPercent(retentionPct: number): number {
  const t = Math.min(1, Math.max(0, retentionPct / 100));
  return Math.round(8 + 47 * Math.sqrt(t));
}

export function CohortGridAdvanced({ rows, todayMonth }: CohortGridAdvancedProps) {
  const grid = useMemo<GridRow[]>(() => {
    // M0 (active) per cohort month — the retention denominator.
    const m0ByMonth = new Map<string, number>();
    for (const r of rows) {
      if (r.monthSince === 0) {
        m0ByMonth.set(r.firstOrderMonth, (m0ByMonth.get(r.firstOrderMonth) ?? 0) + r.activeCustomers);
      }
    }
    // active per (month, month_since).
    const activeByCell = new Map<string, number>();
    for (const r of rows) {
      if (r.monthSince < 0 || r.monthSince >= COHORT_HORIZON) continue;
      const key = `${r.firstOrderMonth}|${r.monthSince}`;
      activeByCell.set(key, (activeByCell.get(key) ?? 0) + r.activeCustomers);
    }
    const months = [...m0ByMonth.keys()].sort();
    return months.map((month) => {
      const m0 = m0ByMonth.get(month) ?? 0;
      const age = monthsBetween(month, todayMonth);
      const cells: Array<number | null> = [];
      for (let m = 0; m < COHORT_HORIZON; m++) {
        if (m > age) {
          cells.push(null); // future cell — no data yet
          continue;
        }
        const active = activeByCell.get(`${month}|${m}`) ?? 0;
        cells.push(m0 > 0 ? (active / m0) * 100 : 0);
      }
      return { month, cells };
    });
  }, [rows, todayMonth]);

  return (
    <div className="mt-3 overflow-x-auto" data-testid="cv-grid">
      <TableBase minWidth={620} className="border-separate [border-spacing:3px]">
        <thead>
          <tr>
            <th className="px-1 py-1" />
            {Array.from({ length: COHORT_HORIZON }, (_, m) => (
              <th
                key={m}
                className="px-1 py-1 text-center text-[10.5px] font-bold text-ink-muted"
              >
                M{m}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.map((gr) => (
            <tr key={gr.month}>
              <td className="whitespace-nowrap pe-1.5 text-end text-[11px] font-bold text-ink-secondary">
                {gr.month}
              </td>
              {gr.cells.map((v, m) =>
                v == null ? (
                  <td
                    key={m}
                    className="h-7 min-w-[42px] rounded-md bg-glass-2 opacity-40"
                    aria-hidden="true"
                    style={{
                      backgroundImage:
                        'repeating-linear-gradient(45deg, var(--glass-2), var(--glass-2) 5px, transparent 5px, transparent 10px)',
                    }}
                  />
                ) : (
                  <td
                    key={m}
                    className="h-7 min-w-[42px] rounded-md text-center text-[11px] font-bold text-ink tabular-nums"
                    style={{
                      backgroundColor: `color-mix(in srgb, var(--status-green) ${tintPercent(v)}%, var(--glass-2))`,
                    }}
                  >
                    {Math.round(v)}%
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </TableBase>
    </div>
  );
}
