'use client';

import { Table } from 'lucide-react';
import type { DailyRow } from '@/lib/types';
import { cn, formatCurrency, formatDate, formatNumber } from '@/lib/utils';
import { roasLabel } from '@/lib/analytics';
import { RefundIndicator } from './RefundIndicator';

const ROAS_BG: Record<string, string> = {
  red: 'bg-roas-redBg',
  orange: 'bg-roas-orangeBg',
  green: 'bg-roas-greenBg',
  blue: 'bg-roas-blueBg',
  gray: '',
};

function roasCellStyle(roas: number, revenue: number, totalSpend: number) {
  if (revenue === 0 && totalSpend > 0) return { className: 'bg-black text-white', text: '0' };
  if (revenue === 0 && totalSpend === 0) return { className: '', text: '' };
  return { className: ROAS_BG[roasLabel(roas).tone], text: formatNumber(roas) };
}

type DetailProps = {
  rows: DailyRow[];
  bare?: boolean;
};

export function DetailTable({ rows, bare = false }: DetailProps) {
  const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date));
  const display = sorted.slice(0, 100);
  const showCogs = display.some(r => r.hasCogs);
  // Phase 05.7.7 — show TikTok column only when at least one row in the
  // visible slice has TikTok spend. Keeps the table layout unchanged for
  // stores without TikTok (zolplus, 360usmile).
  const showTikTok = display.some(r => (r.ttSpend ?? 0) > 0);

  if (!display.length) {
    if (bare) {
      return <div className="p-8 text-center text-text-muted text-sm">אין נתונים בטווח שבחרת</div>;
    }
    return (
      <section className="rounded-xl bg-surface border border-border p-8 text-center text-text-muted shadow-card">
        אין נתונים בטווח שבחרת
      </section>
    );
  }

  const tableContent = (
    <div className="overflow-auto max-h-[70vh]">
        <table className="w-full text-xs sm:text-sm min-w-[700px]">
          <thead className="bg-surfaceMuted sticky top-0 z-[5]">
            <tr className="text-text-secondary">
              <th className="px-3 py-2.5 text-start font-medium">תאריך</th>
              <th className="px-3 py-2.5 text-start font-medium">חנות</th>
              <th className="px-3 py-2.5 text-end font-medium">פייסבוק</th>
              <th className="px-3 py-2.5 text-end font-medium">גוגל</th>
              {showTikTok && <th className="px-3 py-2.5 text-end font-medium">טיקטוק</th>}
              <th className="px-3 py-2.5 text-end font-medium">סה&quot;כ הוצאה</th>
              <th className="px-3 py-2.5 text-end font-medium">הכנסה</th>
              <th className="px-3 py-2.5 text-center font-medium">ROAS</th>
              <th className="px-3 py-2.5 text-end font-medium">רווח גולמי</th>
              {showCogs && <th className="px-3 py-2.5 text-end font-medium">COGS</th>}
              {showCogs && <th className="px-3 py-2.5 text-end font-medium">רווח תפעולי</th>}
            </tr>
          </thead>
          <tbody>
            {display.map((r, i) => {
              const cell = roasCellStyle(r.roas, r.revenue, r.totalSpend);
              return (
                <tr key={i} className="border-t border-border hover:bg-surfaceMuted/50">
                  <td className="px-3 py-2 tabular-nums">{formatDate(r.date)}</td>
                  <td className="px-3 py-2 font-medium">{r.storeName}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{formatNumber(r.fbSpend)}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{formatNumber(r.gaSpend)}</td>
                  {showTikTok && (
                    <td className="px-3 py-2 text-end tabular-nums">
                      {(r.ttSpend ?? 0) > 0 ? formatNumber(r.ttSpend) : '—'}
                    </td>
                  )}
                  <td className="px-3 py-2 text-end tabular-nums">{formatNumber(r.totalSpend)}</td>
                  <td className="px-3 py-2 text-end tabular-nums">
                    {formatNumber(r.revenue)}
                    <RefundIndicator
                      grossRevenue={r.grossRevenue}
                      refundDeduction={r.refundDeduction}
                    />
                  </td>
                  <td className={cn('px-3 py-2 text-center font-medium tabular-nums', cell.className)}>
                    {cell.text}
                  </td>
                  <td className="px-3 py-2 text-end tabular-nums">{formatNumber(r.grossProfit)}</td>
                  {showCogs && (
                    <td className="px-3 py-2 text-end tabular-nums text-text-secondary">
                      {r.hasCogs ? formatNumber(r.cogs) : '—'}
                    </td>
                  )}
                  {showCogs && (
                    <td
                      className={cn(
                        'px-3 py-2 text-end tabular-nums font-medium',
                        r.hasCogs && r.netProfit >= 0 && 'text-roas-green',
                        r.hasCogs && r.netProfit < 0 && 'text-roas-red',
                        !r.hasCogs && 'text-text-muted',
                      )}
                    >
                      {r.hasCogs ? formatCurrency(r.netProfit) : '—'}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
    </div>
  );

  const meta = (
    <span className="text-xs text-text-muted font-normal">
      ({display.length} שורות אחרונות)
    </span>
  );

  if (bare) {
    return (
      <div>
        <div className="px-4 sm:px-5 py-3 bg-surfaceMuted/40 border-b border-border text-xs text-text-secondary">
          {meta}
        </div>
        {tableContent}
      </div>
    );
  }

  return (
    <section className="rounded-xl bg-surface border border-border shadow-card overflow-hidden">
      <h2 className="flex items-center gap-2 text-base font-semibold text-text-primary px-5 py-4 border-b border-border">
        <Table size={18} className="text-text-secondary" />
        פירוט יומי
        {meta}
      </h2>
      {tableContent}
    </section>
  );
}
