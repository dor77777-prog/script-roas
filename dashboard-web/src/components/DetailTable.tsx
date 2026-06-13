'use client';

import { useMemo, type ReactElement } from 'react';
import { Table } from 'lucide-react';
import type { DailyRow } from '@/lib/types';
import { cn, formatDate } from '@/lib/utils';
import { RefundIndicator } from './RefundIndicator';
import { roasCell } from '@/lib/format/roasCell';
import { RoasBadge, roasCellTdClass } from '@/lib/format/RoasBadge';
import { isStoreFullyOff, type AdStateMap, type AdPlatform } from '@/lib/adState';
import { Sparkline } from './ui/Sparkline';
import { TableBase } from './ui/TableBase';
import { Card } from './ui/Card';
import { Money } from './ui/Money';
import { Heading } from './ui/Typography';

// Overflow-safe money cell — reproduces the legacy `formatNumber` render
// (he-IL, 2 decimals, NO currency prefix) byte-for-byte while routing through
// the <Money> primitive's compact-floor + exact-value title/sr-only safety so a
// 7+ digit spend/revenue can never overflow the cell. `decimals` lets the
// net-profit cell match the legacy `formatCurrency(n, 0)` (0-decimal) render.
// RTL-isolated via the primitive's own <bdi dir="ltr">.
function MoneyCell({ value, decimals = 2 }: { value: number; decimals?: 0 | 2 }) {
  return <Money value={value} prefix="none" locale="he-IL" decimals={decimals} />;
}

type DetailProps = {
  rows: DailyRow[];
  bare?: boolean;
  adStateMap?: AdStateMap;
  storeApplicablePlatforms?: Record<string, AdPlatform[]>;
};

export function DetailTable({ rows, bare = false, adStateMap = {}, storeApplicablePlatforms = {} }: DetailProps) {
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

  // The "מגמת חנות" sparkline is IDENTICAL for every row of the same store (it
  // plots that store's whole-range ROAS micro-trend, not the row's day). Build
  // the rendered element ONCE per store and reuse it across all of that store's
  // rows instead of re-instantiating the SVG geometry for every one of the up-to
  // 100 rows. The visual is preserved on every row (a meaningful per-row "which
  // store + how's it trending" cue) — only the redundant re-render is removed.
  const sparklineByStore = useMemo(() => {
    const out = new Map<string, ReactElement>();
    for (const [store, series] of storeSeriesByStore) {
      out.set(
        store,
        series.length >= 2 ? (
          <Sparkline data={series} tone="blue" width={64} height={20} className="inline-block" />
        ) : (
          <span className="text-ink-muted">—</span>
        ),
      );
    }
    return out;
  }, [storeSeriesByStore]);

  if (!display.length) {
    if (bare) {
      return <div className="p-8 text-center text-ink-muted text-sm">אין נתונים בטווח שבחרת</div>;
    }
    return (
      <Card className="!p-8 text-center text-ink-muted">
        אין נתונים בטווח שבחרת
      </Card>
    );
  }

  const tableContent = (
    <div className="overflow-auto max-h-[70vh] -mx-2 sm:mx-0">
        <TableBase className="text-xs sm:text-sm" minWidth={900} stickyHeader>
          <thead>
            <tr className="text-ink-secondary">
              <th className="px-3 py-2.5 text-start font-medium">תאריך</th>
              <th className="px-3 py-2.5 text-start font-medium">חנות</th>
              <th className="px-2 py-2 text-center text-fs-2xs uppercase tracking-wide text-ink-muted font-medium w-[80px]">
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
              const off = isStoreFullyOff(r.storeId, adStateMap, storeApplicablePlatforms[r.storeId] ?? []);
              const cell = roasCell(r.roas, r.revenue, r.totalSpend, off);
              return (
                <tr key={i} className="border-t border-glass-edge hover:bg-glass-2/50">
                  <td className="px-3 py-2 tabular-nums">{formatDate(r.date)}</td>
                  <td className="px-3 py-2 font-medium">{r.storeName}</td>
                  <td className="px-2 py-2 text-center align-middle">
                    {/* Deduped: the same per-store sparkline element is reused
                        across every row of this store (built once above). */}
                    {sparklineByStore.get(r.storeName) ?? <span className="text-ink-muted">—</span>}
                  </td>
                  <td className="px-3 py-2 text-end tabular-nums"><MoneyCell value={r.fbSpend} /></td>
                  <td className="px-3 py-2 text-end tabular-nums"><MoneyCell value={r.gaSpend} /></td>
                  {showTikTok && (
                    <td className="px-3 py-2 text-end tabular-nums">
                      {(r.ttSpend ?? 0) > 0 ? <MoneyCell value={r.ttSpend ?? 0} /> : '—'}
                    </td>
                  )}
                  <td className="px-3 py-2 text-end tabular-nums"><MoneyCell value={r.totalSpend} /></td>
                  <td className="px-3 py-2 text-end tabular-nums">
                    <MoneyCell value={r.revenue} />
                    <RefundIndicator
                      grossRevenue={r.grossRevenue}
                      refundDeduction={r.refundDeduction}
                    />
                  </td>
                  <td className={cn('px-3 py-2 text-center font-medium tabular-nums', roasCellTdClass(cell.className))}>
                    <RoasBadge className={cell.className} text={cell.text} />
                  </td>
                  <td className="px-3 py-2 text-end tabular-nums"><MoneyCell value={r.grossProfit} /></td>
                  {showCogs && (
                    <td className="px-3 py-2 text-end tabular-nums text-ink-secondary">
                      {r.hasCogs ? <MoneyCell value={r.cogs} /> : '—'}
                    </td>
                  )}
                  {showCogs && (
                    <td
                      className={cn(
                        'px-3 py-2 text-end tabular-nums font-medium',
                        r.hasCogs && r.netProfit >= 0 && 'text-status-greenFg',
                        r.hasCogs && r.netProfit < 0 && 'text-status-redFg',
                        !r.hasCogs && 'text-ink-muted',
                      )}
                    >
                      {r.hasCogs ? <MoneyCell value={r.netProfit} decimals={0} /> : '—'}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </TableBase>
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
        <div className="px-4 sm:px-5 py-3 bg-pill-track border-b border-glass-edge text-xs text-ink-secondary">
          {meta}
        </div>
        {tableContent}
      </div>
    );
  }

  return (
    <Card className="!p-0 overflow-hidden">
      <Heading level="section" className="flex items-center gap-2 px-5 py-4 border-b border-glass-edge">
        <Table size={18} className="text-ink-secondary" />
        פירוט יומי
        {meta}
      </Heading>
      {tableContent}
    </Card>
  );
}
