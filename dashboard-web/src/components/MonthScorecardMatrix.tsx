'use client';

// MonthScorecardMatrix — Steps 3-5 of the Monthly (Archive) enhancements.
//
// One compact row per month for the selected year/scope, giving the whole year
// at a glance ABOVE the detailed month blocks. Columns:
//   חודש · ROAS-trend spark · הוצאה · הכנסה · ROAS (banded badge) · רווח נקי · מרווח
// Each money/ROAS/profit cell carries a month-over-month Δ% chip (vs the
// next-older present month), toned green (up) / red (down). The oldest month
// has no chips (no prior to compare). All maths comes from the pure
// computeMonthScorecards so the matrix and the detailed blocks agree.

import { CalendarRange } from 'lucide-react';
import type { DailyRow } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Money } from '@/components/ui/Money';
import { Sparkline } from '@/components/ui/Sparkline';
import { TableBase } from '@/components/ui/TableBase';
import { Heading } from '@/components/ui/Typography';
import { roasCell } from '@/lib/format/roasCell';
import { RoasBadge, roasCellTdClass } from '@/lib/format/RoasBadge';
import {
  computeMonthScorecards,
  type MonthScorecard,
} from '@/lib/monthlyTablesAggregate';
import { ColumnHelp, COLUMN_HELP } from '@/components/MonthlyTables';

const HE_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

function monthTitle(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return `${HE_MONTHS[m - 1]} ${y}`;
}

// Money cell at 0 decimals (matches the blocks' net-profit render); overflow-safe.
function MoneyCell({ value, decimals = 0 }: { value: number; decimals?: 0 | 2 }) {
  return <Money value={value} prefix="none" locale="he-IL" decimals={decimals} />;
}

/**
 * MoM delta chip. `delta` is a signed fraction (0.25 = +25%). When
 * `higherIsBetter` is false (spend), an INCREASE is toned red. null delta (no
 * prior, or a zero base) renders nothing so the cell stays clean.
 */
function DeltaChip({
  delta,
  higherIsBetter = true,
}: {
  delta: number | null | undefined;
  higherIsBetter?: boolean;
}) {
  if (delta == null || !Number.isFinite(delta)) return null;
  const pct = delta * 100;
  // "good" direction: up for revenue/roas/profit, DOWN for spend.
  const isGood = higherIsBetter ? pct > 0 : pct < 0;
  const isFlat = Math.abs(pct) < 0.05;
  const tone = isFlat
    ? 'text-ink-muted'
    : isGood
      ? 'text-status-greenFg'
      : 'text-status-redFg';
  const sign = pct > 0 ? '+' : '';
  return (
    <span className={cn('ms-1.5 text-fs-2xs font-semibold tabular-nums', tone)}>
      <bdi dir="ltr">
        ({sign}
        {pct.toFixed(0)}%)
      </bdi>
    </span>
  );
}

function MarginText({ margin }: { margin: number | null }) {
  if (margin == null) return <span className="text-ink-muted">—</span>;
  return <bdi dir="ltr">{Math.round(margin * 100)}%</bdi>;
}

function ScorecardRow({ card }: { card: MonthScorecard }) {
  // ROAS badge — reuse the canonical banded cell. Revenue + spend present so
  // roasCell classifies the band exactly as the detailed total rows do.
  const cell = roasCell(card.roas, card.revenue, card.totalSpend);
  const netToneClass = card.hasCogs
    ? card.netProfit >= 0
      ? 'text-status-greenFg'
      : 'text-status-redFg'
    : 'text-ink-muted';
  // ROAS micro-trend tone tracks the band so the spark matches the badge.
  const sparkTone =
    card.roas >= 3 ? 'blue' : card.roas >= 2.7 ? 'green' : card.roas >= 2 ? 'orange' : 'red';

  return (
    <tr className="border-t border-glass-edge hover:bg-glass-2/50">
      <td className="px-3 py-2 font-medium whitespace-nowrap">{monthTitle(card.ym)}</td>
      <td className="px-2 py-2 text-center align-middle w-[72px]">
        {card.dailyRoasSeries.length >= 2 ? (
          <Sparkline data={card.dailyRoasSeries} tone={sparkTone} width={60} height={18} className="inline-block" />
        ) : (
          <span className="text-ink-muted">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-end tabular-nums whitespace-nowrap">
        <MoneyCell value={card.totalSpend} />
        {/* Spend up is BAD → higherIsBetter=false. */}
        <DeltaChip delta={card.deltas?.spend} higherIsBetter={false} />
      </td>
      <td className="px-3 py-2 text-end tabular-nums whitespace-nowrap">
        <MoneyCell value={card.revenue} />
        <DeltaChip delta={card.deltas?.revenue} />
      </td>
      <td className={cn('px-3 py-2 text-center tabular-nums whitespace-nowrap', roasCellTdClass(cell.className))}>
        <RoasBadge className={cell.className} text={cell.text} />
        <DeltaChip delta={card.deltas?.roas} />
      </td>
      <td className={cn('px-3 py-2 text-end tabular-nums font-medium whitespace-nowrap', netToneClass)}>
        {card.hasCogs ? <MoneyCell value={card.netProfit} /> : <span className="text-ink-muted">—</span>}
        {card.hasCogs && <DeltaChip delta={card.deltas?.netProfit} />}
      </td>
      <td className={cn('px-3 py-2 text-end tabular-nums font-medium whitespace-nowrap', netToneClass)}>
        <MarginText margin={card.hasCogs ? card.margin : null} />
      </td>
    </tr>
  );
}

export function MonthScorecardMatrix({ rows }: { rows: DailyRow[] }) {
  const cards = computeMonthScorecards(rows);
  if (cards.length === 0) return null;

  return (
    <section className="space-y-3" aria-label="סקירת חודשים">
      <Heading level="panel" className="flex items-center gap-2">
        <CalendarRange size={16} className="text-ink-secondary" />
        סקירת החודשים
      </Heading>
      <div className="rounded-xl bg-glass-1 border border-glass-edge shadow-glass overflow-hidden">
        <div className="overflow-auto">
          <TableBase className="text-xs sm:text-sm" minWidth={620}>
            <thead>
              <tr className="text-ink-secondary bg-pill-track">
                <th className="px-3 py-2.5 text-start font-medium">חודש</th>
                <th className="px-2 py-2.5 text-center text-fs-2xs uppercase tracking-wide text-ink-muted font-medium w-[72px]">
                  מגמת ROAS
                </th>
                <th className="px-3 py-2.5 text-end font-medium">הוצאה</th>
                <th className="px-3 py-2.5 text-end font-medium">הכנסה</th>
                <th className="px-3 py-2.5 text-center font-medium">
                  <span className="inline-flex items-center justify-center gap-1">
                    ROAS
                    <ColumnHelp label="ROAS" content={COLUMN_HELP.roas} />
                  </span>
                </th>
                <th className="px-3 py-2.5 text-end font-medium">
                  <span className="inline-flex items-center justify-end gap-1">
                    רווח נקי
                    <ColumnHelp label="רווח נקי" content={COLUMN_HELP.netProfit} />
                  </span>
                </th>
                <th className="px-3 py-2.5 text-end font-medium">
                  <span className="inline-flex items-center justify-end gap-1">
                    מרווח
                    <ColumnHelp label="מרווח" content={COLUMN_HELP.margin} />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {cards.map(card => (
                <ScorecardRow key={card.ym} card={card} />
              ))}
            </tbody>
          </TableBase>
        </div>
      </div>
    </section>
  );
}
