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
 * BY-YEAR ACCORDION (2026-06-04 restructure — replaces the flat ~38-row grid):
 *   A deep historical backfill gave the matrix ~3 years of cohort rows, making a
 *   single flat grid unreadable. The rows are now grouped into a collapsible
 *   `<details>` per cohort YEAR (DESC), matching the PaymentMethodsTab graphic
 *   language (rotating chevron + `details.acc`-style surface). The most-recent
 *   year is open by default; older years collapsed. Expanding a year reveals
 *   that year's cohort-month retention rows (the same M0..M11 grid).
 *   ZERO data loss — every cohort row + every cell is preserved, only regrouped.
 *
 * Token-driven heatmap: cell tint is `color-mix(in srgb, var(--status-green) N%,
 * var(--glass-2))` — N capped so the neutral surface dominates and `text-ink`
 * keeps WCAG-AA contrast at every intensity (no white-on-pale-green). Future
 * cells (m > cohort age) render as a striped, dimmed placeholder.
 *
 * CAPI-safe: pure presentation over the aggregated Shopify cohort numbers.
 */
import { useMemo } from 'react';
import { ChevronDown } from 'lucide-react';
import { TableBase } from '@/components/ui/TableBase';
import { COHORT_HORIZON } from '@/lib/home/customerValue';
import { monthsBetween } from '@/lib/cohorts/cohortAggregate';
import { cn } from '@/lib/utils';
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

/** A cohort YEAR block: 'YYYY' + its member cohort-month grid rows (ASC). */
interface YearGroup {
  year: string;
  rows: GridRow[];
}

/** Shift a 'YYYY-MM' month by n whole months. */
function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const idx = (y * 12 + (m - 1)) + n;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
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

/**
 * Bucket the flat cohort grid rows into DESCENDING cohort years, each with its
 * member month rows (ascending). Only years that have a cohort appear.
 */
function groupGridRowsByYear(gridRows: GridRow[]): YearGroup[] {
  const byYear = new Map<string, GridRow[]>();
  for (const gr of gridRows) {
    const y = gr.month.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y)!.push(gr);
  }
  return Array.from(byYear.entries())
    .map(([year, rows]) => ({
      year,
      rows: [...rows].sort((a, b) => a.month.localeCompare(b.month)),
    }))
    .sort((a, b) => b.year.localeCompare(a.year));
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

  // Group into DESCENDING cohort years; the most-recent year opens by default.
  const yearGroups = useMemo(() => groupGridRowsByYear(grid), [grid]);
  const newestYear = yearGroups[0]?.year;

  return (
    <div className="mt-3 space-y-2.5" data-testid="cv-grid">
      {yearGroups.map((yg) => (
        <CohortYearAccordion
          key={yg.year}
          group={yg}
          todayMonth={todayMonth}
          defaultOpen={yg.year === newestYear}
        />
      ))}
    </div>
  );
}

/**
 * One cohort YEAR block — a styled `<details>` matching the existing
 * `details.acc` graphic language (PaymentMethodsTab / CampaignDrawerOverview):
 * a hairline glass-edge surface, a marker-less `<summary>` (year title + cohort
 * count on the start, a rotating caret), keyboard-accessible. The body holds
 * that year's M0..M11 retention grid (one row per cohort first-order month).
 */
function CohortYearAccordion({
  group,
  todayMonth,
  defaultOpen,
}: {
  group: YearGroup;
  todayMonth: string;
  defaultOpen: boolean;
}) {
  return (
    <details
      open={defaultOpen}
      data-testid={`cv-cohort-year-row-${group.year}`}
      className="group rounded-hz border border-glass-edge bg-pill-track overflow-hidden"
    >
      <summary
        data-testid={`cv-cohort-year-${group.year}`}
        className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 marker:hidden [&::-webkit-details-marker]:hidden"
      >
        <ChevronDown
          size={15}
          className="shrink-0 text-ink-muted transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
        <span className="text-sm font-bold tabular-nums text-ink">{group.year}</span>
        <span className="text-xs font-semibold text-ink-muted">
          · <span className="tabular-nums">{group.rows.length}</span> קבוצות
        </span>
      </summary>
      <div className="overflow-x-auto px-3 pb-3">
        <CohortYearGrid rows={group.rows} todayMonth={todayMonth} />
      </div>
    </details>
  );
}

/** The M0..M11 retention grid for a single cohort year's member month rows. */
function CohortYearGrid({ rows, todayMonth }: { rows: GridRow[]; todayMonth: string }) {
  return (
    <TableBase minWidth={620} className="border-separate [border-spacing:3px]">
      <thead>
        <tr>
          <th className="px-1 py-1" />
          {Array.from({ length: COHORT_HORIZON }, (_, m) => (
            <th
              key={m}
              className="px-1 py-1 text-center text-fs-2xs font-bold text-ink-muted"
            >
              M{m}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((gr) => {
          // The cell at column m === age maps to the CURRENT calendar month, which
          // is still month-to-date. Guard with addMonths(...) === todayMonth so a
          // future cohort (age floored to 0) is never falsely flagged.
          const age = monthsBetween(gr.month, todayMonth);
          const partialCol = addMonths(gr.month, age) === todayMonth ? age : -1;
          return (
            <tr key={gr.month} data-testid={`cv-cohort-row-${gr.month}`}>
              <td className="whitespace-nowrap pe-1.5 text-end text-fs-xs font-bold text-ink-secondary">
                {gr.month}
              </td>
              {gr.cells.map((v, m) => {
                if (v == null) {
                  return (
                    <td
                      key={m}
                      className="h-7 min-w-[42px] rounded-md bg-glass-2 opacity-40"
                      aria-hidden="true"
                      style={{
                        backgroundImage:
                          'repeating-linear-gradient(45deg, var(--glass-2), var(--glass-2) 5px, transparent 5px, transparent 10px)',
                      }}
                    />
                  );
                }
                const isPartial = m === partialCol && m < COHORT_HORIZON;
                // The in-progress month carries its accessible name via aria-label
                // (the design system bans native title= tooltips) so it never reads
                // as a completed retention figure.
                const label = `${Math.round(v)}%${isPartial ? ' (חלקי)' : ''}`;
                return (
                  <td
                    key={m}
                    data-testid={isPartial ? `cv-cohort-cell-partial-${gr.month}` : undefined}
                    data-partial={isPartial ? 'true' : undefined}
                    aria-label={isPartial ? label : undefined}
                    className={cn(
                      'h-7 min-w-[42px] rounded-md text-center text-fs-xs font-bold text-ink tabular-nums',
                      // Partial (in-progress current month): dim so it never reads
                      // as a completed retention figure.
                      isPartial && 'opacity-60',
                    )}
                    style={{
                      backgroundColor: `color-mix(in srgb, var(--status-green) ${tintPercent(v)}%, var(--glass-2))`,
                    }}
                  >
                    {Math.round(v)}%
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </TableBase>
  );
}
