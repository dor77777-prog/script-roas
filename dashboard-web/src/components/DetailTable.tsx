'use client';

import { useMemo } from 'react';
import { Table } from 'lucide-react';
import type { DailyRow } from '@/lib/types';
import { cn, formatCurrency, formatDate, formatNumber } from '@/lib/utils';
import { roasLabel } from '@/lib/analytics';
import { RefundIndicator } from './RefundIndicator';
import { Sparkline } from './ui/Sparkline';

const ROAS_BG: Record<string, string> = {
  red: 'bg-status-redBg',
  orange: 'bg-status-orangeBg',
  green: 'bg-status-greenBg',
  blue: 'bg-status-blueBg',
  gray: '',
};

function roasCellStyle(roas: number, revenue: number, totalSpend: number) {
  if (revenue === 0 && totalSpend > 0) return { className: 'bg-status-red text-white', text: '0' };
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

  // Plan 5c — per-store ROAS micro-trend over the visible range, used by the
  // "מגמת חנות" sparkline column. Computed once per render, then sliced per row
  // by storeName so the row JSX stays cheap.
  const storeSeriesByStore = useMemo(() => {
    const out = new Map<string, number[]>();
    const byStore = new Map<string, DailyRow[]>();
    for (const r of rows) {
      const arr = byStore.get(r.storeName) ?? [];
      arr.push(r);
      byStore.set(r.storeName, arr);
    }
    for (const [store, arr] of byStore) {
      const sorted = [...arr].sort((a, b) => (a.date < b.date ? -1 : 1));
      out.set(store, sorted.map(r => (Number.isFinite(r.roas) ? r.roas : 0)));
    }
    return out;
  }, [rows]);

  if (!display.length) {
    if (bare) {
      return <div className="p-8 text-center text-ink-muted text-sm">אין נתונים בטווח שבחרת</div>;
    }
    return (
      <section className="rounded-xl bg-elevated border border-line p-8 text-center text-ink-muted shadow-sm">
        אין נתונים בטווח שבחרת
      </section>
    );
  }

  const tableContent = (
    <div className="overflow-auto max-h-[70vh]">
        <table className="w-full text-xs sm:text-sm min-w-[700px]">
          <thead className="bg-elevated2 sticky top-0 z-[5]">
            <tr className="text-ink-secondary">
              <th className="px-3 py-2.5 text-start font-medium">תאריך</th>
              <th className="px-3 py-2.5 text-start font-medium">חנות</th>
              <th className="px-2 py-2 text-center text-[10px] uppercase tracking-wide text-ink-muted font-medium w-[80px]">
                מגמת חנות
              </th>
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
                <tr key={i} className="border-t border-line hover:bg-elevated2/50">
                  <td className="px-3 py-2 tabular-nums">{formatDate(r.date)}</td>
                  <td className="px-3 py-2 font-medium">{r.storeName}</td>
                  <td className="px-2 py-2 text-center align-middle">
                    {(() => {
                      const series = storeSeriesByStore.get(r.storeName) ?? [];
                      return series.length >= 2 ? (
                        <Sparkline data={series} tone="blue" width={64} height={20} className="inline-block" />
                      ) : (
                        <span className="text-ink-muted">—</span>
                      );
                    })()}
                  </td>
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
                    <td className="px-3 py-2 text-end tabular-nums text-ink-secondary">
                      {r.hasCogs ? formatNumber(r.cogs) : '—'}
                    </td>
                  )}
                  {showCogs && (
                    <td
                      className={cn(
                        'px-3 py-2 text-end tabular-nums font-medium',
                        r.hasCogs && r.netProfit >= 0 && 'text-status-green',
                        r.hasCogs && r.netProfit < 0 && 'text-status-red',
                        !r.hasCogs && 'text-ink-muted',
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
    <span className="text-xs text-ink-muted font-normal">
      ({display.length} שורות אחרונות)
    </span>
  );

  if (bare) {
    return (
      <div>
        <div className="px-4 sm:px-5 py-3 bg-elevated2/40 border-b border-line text-xs text-ink-secondary">
          {meta}
        </div>
        {tableContent}
      </div>
    );
  }

  return (
    <section className="rounded-xl bg-elevated border border-line shadow-sm overflow-hidden">
      <h2 className="flex items-center gap-2 text-base font-semibold text-ink px-5 py-4 border-b border-line">
        <Table size={18} className="text-ink-secondary" />
        פירוט יומי
        {meta}
      </h2>
      {tableContent}
    </section>
  );
}
