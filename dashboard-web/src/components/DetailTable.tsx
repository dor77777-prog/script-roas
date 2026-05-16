'use client';

import { Table } from 'lucide-react';
import type { DailyRow } from '@/lib/types';
import { cn, formatCurrency, formatDate, formatNumber } from '@/lib/utils';
import { roasLabel } from '@/lib/analytics';

const ROAS_BG: Record<string, string> = {
  red: 'bg-roas-redBg',
  orange: 'bg-roas-orangeBg',
  green: 'bg-roas-greenBg',
  blue: 'bg-roas-blueBg',
  gray: '',
};

export function DetailTable({ rows }: { rows: DailyRow[] }) {
  const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date));
  const display = sorted.slice(0, 100);

  if (!display.length) {
    return (
      <section className="rounded-xl bg-surface border border-border p-8 text-center text-text-muted shadow-card">
        אין נתונים בטווח שבחרת
      </section>
    );
  }

  return (
    <section className="rounded-xl bg-surface border border-border shadow-card overflow-hidden">
      <h2 className="flex items-center gap-2 text-base font-semibold text-text-primary px-5 py-4 border-b border-border">
        <Table size={18} className="text-text-secondary" />
        פירוט יומי
        <span className="text-xs text-text-muted font-normal">({display.length} שורות אחרונות)</span>
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-xs sm:text-sm min-w-[700px]">
          <thead className="bg-surfaceMuted">
            <tr className="text-text-secondary">
              <th className="px-3 py-2.5 text-start font-medium">תאריך</th>
              <th className="px-3 py-2.5 text-start font-medium">חנות</th>
              <th className="px-3 py-2.5 text-end font-medium">פייסבוק</th>
              <th className="px-3 py-2.5 text-end font-medium">גוגל</th>
              <th className="px-3 py-2.5 text-end font-medium">סה"כ הוצאה</th>
              <th className="px-3 py-2.5 text-end font-medium">הכנסה</th>
              <th className="px-3 py-2.5 text-center font-medium">ROAS</th>
              <th className="px-3 py-2.5 text-end font-medium">רווח גולמי</th>
            </tr>
          </thead>
          <tbody>
            {display.map((r, i) => {
              const info = roasLabel(r.roas);
              return (
                <tr key={i} className="border-t border-border hover:bg-surfaceMuted/50">
                  <td className="px-3 py-2 tabular-nums">{formatDate(r.date)}</td>
                  <td className="px-3 py-2 font-medium">{r.storeName}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{formatNumber(r.fbSpend)}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{formatNumber(r.gaSpend)}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{formatNumber(r.totalSpend)}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{formatNumber(r.revenue)}</td>
                  <td className={cn('px-3 py-2 text-center font-medium tabular-nums', ROAS_BG[info.tone])}>
                    {formatNumber(r.roas)}
                  </td>
                  <td className="px-3 py-2 text-end tabular-nums">{formatNumber(r.grossProfit)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
