'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { CalendarDays, ChevronDown, ChevronUp } from 'lucide-react';
import type { DailyRow, DashboardData } from '@/lib/types';
import { cn, formatCurrency, formatDate, formatNumber } from '@/lib/utils';
import { RefundIndicator } from './RefundIndicator';
import { roasLabel } from '@/lib/analytics';
import { buildDateRangeKey } from '@/lib/dateRange';

const HE_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

type Mode = 'per-store' | 'summary';

type Props = {
  stores: string[];
  /** When true, omit the outer title/header — used inside CollapsibleSection. */
  bare?: boolean;
};

/**
 * Months of history MonthlyTables shows in the analysis tab. Sized just
 * inside the Phase 5 archive cutoff (ARCHIVE_FALLBACK_MONTHS = 18) so the
 * fetch stays warm-only and never triggers a 100k-row archive read.
 *
 * WR-09 hotfix: previously the component reused the dashboard's range-scoped
 * /api/data response, which made the "monthly tables show all months
 * regardless" promise false whenever the user narrowed their global range.
 * Now it owns its own SWR fetch covering this wider window.
 */
const MONTHLY_TABLES_HISTORY_MONTHS = 17;

// Audit fix 2026-05-23 (d/HI-08): the pre-fix isoMonthsAgo built `past`
// from `today.getFullYear() / getMonth() / getDate()` — those getters
// return the SERVER/CLIENT local-zone date, NOT IL. When a CI worker or
// remote machine ran in a non-IL zone the resulting `past` date could
// be off by one day, which then leaked into the data fetch range and
// silently dropped a month's worth of edge-day rows. Now we resolve IL
// "today" as a YYYY-MM-DD string FIRST, parse the components, then do
// month arithmetic in pure UTC (no local-zone leakage). Output is still
// Intl-formatted IL — same return contract as before.
function ilTodayParts(): { y: number; m: number; d: number } {
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

// Exported for unit testing — the helpers are pure and stateless so
// pinning their behavior across DST and edge dates protects the table
// from silent off-by-month bugs that would manifest only on specific
// worker zones / specific calendar days.
export function _isoMonthsAgoFromIlParts(months: number, todayParts: { y: number; m: number; d: number }): string {
  const past = new Date(Date.UTC(todayParts.y, todayParts.m - 1 - months, todayParts.d));
  const yy = past.getUTCFullYear();
  const mm = String(past.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(past.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function isoMonthsAgo(months: number): string {
  return _isoMonthsAgoFromIlParts(months, ilTodayParts());
}

function isoToday(): string {
  const { y, m, d } = ilTodayParts();
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const fetcher = async (url: string): Promise<DashboardData> => {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Failed to load (${res.status})`);
  }
  return res.json() as Promise<DashboardData>;
};

const ROAS_BG: Record<string, string> = {
  red: 'bg-roas-redBg',
  orange: 'bg-roas-orangeBg',
  green: 'bg-roas-greenBg',
  blue: 'bg-roas-blueBg',
  gray: '',
};

/**
 * Cell styling for ROAS. A day with revenue=0 means the day was a complete
 * miss (spent money, no sales). Surfaces it visually with a black cell + "0"
 * so it stands out from "no data yet" (gray, empty).
 */
function roasCell(roas: number, revenue: number, totalSpend: number): { className: string; text: string } {
  // Day where revenue is zero but money WAS spent — flag as "0" on black.
  if (revenue === 0 && totalSpend > 0) {
    return { className: 'bg-black text-white', text: '0' };
  }
  // Day with no data at all (no spend AND no revenue) — leave blank.
  if (revenue === 0 && totalSpend === 0) {
    return { className: '', text: '' };
  }
  return { className: ROAS_BG[roasLabel(roas).tone], text: formatNumber(roas) };
}

export function MonthlyTables({ stores, bare = false }: Props) {
  const [mode, setMode] = useState<Mode>('per-store');
  const [storeFilter, setStoreFilter] = useState<string>(stores[0] || 'All');

  const historyRange = useMemo(
    () => ({ from: isoMonthsAgo(MONTHLY_TABLES_HISTORY_MONTHS), to: isoToday() }),
    [],
  );

  const { data, error, isLoading } = useSWR<DashboardData>(
    buildDateRangeKey('/api/data', historyRange),
    fetcher,
    { revalidateOnFocus: false },
  );

  const rows: DailyRow[] = data?.rows ?? [];

  const monthGroups = useMemo(() => {
    const grouped = new Map<string, DailyRow[]>();
    for (const r of rows) {
      const ym = r.date.slice(0, 7);
      if (!grouped.has(ym)) grouped.set(ym, []);
      grouped.get(ym)!.push(r);
    }
    return Array.from(grouped.entries())
      .map(([ym, rs]) => ({ ym, rows: rs }))
      .sort((a, b) => b.ym.localeCompare(a.ym));
  }, [rows]);

  if (isLoading) {
    return (
      <div className={cn('px-4 sm:px-5 py-6 text-sm text-text-secondary', bare && 'border-b border-border')}>
        טוען טבלאות חודשיות...
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn('px-4 sm:px-5 py-6 text-sm text-roas-red', bare && 'border-b border-border')}>
        שגיאה בטעינת הטבלאות החודשיות: {error instanceof Error ? error.message : String(error)}
      </div>
    );
  }

  if (!rows.length) return null;

  const toolbar = (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2',
        bare && 'px-4 sm:px-5 py-3 bg-surfaceMuted/40 border-b border-border',
      )}
    >
      <div
        role="tablist"
        className="inline-flex rounded-lg border border-border bg-surface overflow-hidden divide-x divide-border"
        dir="ltr"
      >
        <Tab active={mode === 'per-store'} onClick={() => setMode('per-store')}>
          לפי חנות
        </Tab>
        <Tab active={mode === 'summary'} onClick={() => setMode('summary')}>
          סיכום כללי
        </Tab>
      </div>
      {mode === 'per-store' && (
        <select
          value={storeFilter}
          onChange={e => setStoreFilter(e.target.value)}
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium"
        >
          {stores.map(s => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      )}
      <span className="text-[10px] sm:text-xs text-text-muted ml-auto tabular-nums">
        {monthGroups.length} חודשים
      </span>
    </div>
  );

  const blocks = (
    <div className={cn('space-y-4', bare ? 'p-4 sm:p-5 pt-4' : 'space-y-6')}>
      {monthGroups.map(({ ym, rows: monthRows }) => {
        if (mode === 'per-store') {
          const storeRows = monthRows.filter(r => r.storeName === storeFilter);
          if (!storeRows.length) return null;
          return <MonthBlockPerStore key={ym} ym={ym} storeName={storeFilter} rows={storeRows} />;
        }
        return <MonthBlockSummary key={ym} ym={ym} rows={monthRows} stores={stores} />;
      })}
    </div>
  );

  if (bare) {
    return (
      <div>
        {toolbar}
        {blocks}
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-text-primary">
          <CalendarDays size={18} className="text-text-secondary" />
          טבלאות חודשיות
        </h2>
        {toolbar}
      </div>
      {blocks}
    </section>
  );
}

function Tab({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'px-3 sm:px-3.5 py-1.5 sm:py-2 text-xs sm:text-sm font-medium transition-colors',
        active
          ? 'bg-primary text-white'
          : 'bg-surface text-text-secondary hover:bg-surfaceMuted',
      )}
    >
      {children}
    </button>
  );
}

function monthTitle(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return `${HE_MONTHS[m - 1]} ${y}`;
}

function MonthBlockPerStore({
  ym,
  storeName,
  rows,
}: {
  ym: string;
  storeName: string;
  rows: DailyRow[];
}) {
  const [open, setOpen] = useState(true);
  // detect if store has GA (any row with gaSpend > 0)
  const hasGa = rows.some(r => r.gaSpend > 0);
  // Phase 05.7.7 — show TikTok column only when at least one row in this
  // month/store has TikTok spend (currently uzoshop-only).
  const hasTt = rows.some(r => (r.ttSpend ?? 0) > 0);

  let totalFb = 0, totalGa = 0, totalTt = 0, totalSpend = 0, totalRev = 0;
  let totalGross = 0;
  let totalRefund = 0;
  for (const r of rows) {
    totalFb += r.fbSpend;
    totalGa += r.gaSpend;
    totalTt += r.ttSpend ?? 0;
    totalSpend += r.totalSpend;
    totalRev += r.revenue;
    // Treat null gross/refund as "no refund day" (gross == net).
    totalGross += r.grossRevenue ?? r.revenue;
    if (r.refundDeduction !== null && r.refundDeduction > 0) {
      totalRefund += r.refundDeduction;
    }
  }
  const totalRoas = totalSpend > 0 ? totalRev / totalSpend : 0;

  // Fill in missing days of month with empty rows
  const allDays = daysOfMonth(ym);
  const byDate = new Map(rows.map(r => [r.date, r]));

  return (
    <div className="rounded-xl bg-surface border border-border shadow-card overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-3 bg-slate-800 text-white"
      >
        <span className="font-semibold">
          {monthTitle(ym)}  •  {storeName}
        </span>
        {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>
      {open && (
        <div className="overflow-auto max-h-[60vh]">
          <table className="w-full text-xs sm:text-sm min-w-[500px]">
            <thead className="bg-surfaceMuted sticky top-0 z-[5]">
              <tr className="text-text-secondary">
                <th className="px-3 py-2 text-start font-medium">תאריך</th>
                {hasGa && <th className="px-3 py-2 text-end font-medium">פייסבוק</th>}
                {hasGa && <th className="px-3 py-2 text-end font-medium">גוגל</th>}
                {hasTt && <th className="px-3 py-2 text-end font-medium">טיקטוק</th>}
                <th className="px-3 py-2 text-end font-medium">{hasGa ? 'יצא סה"כ' : 'יצא'}</th>
                <th className="px-3 py-2 text-end font-medium">נכנס</th>
                <th className="px-3 py-2 text-center font-medium">ROAS</th>
              </tr>
            </thead>
            <tbody>
              {allDays.map(d => {
                const r = byDate.get(d);
                const isEmpty = !r;
                const cell = r
                  ? roasCell(r.roas, r.revenue, r.totalSpend)
                  : { className: '', text: '' };
                return (
                  <tr key={d} className={cn('border-t border-border', isEmpty && 'text-text-muted')}>
                    <td className="px-3 py-1.5 tabular-nums">{formatDate(d)}</td>
                    {hasGa && <td className="px-3 py-1.5 text-end tabular-nums">{r ? formatNumber(r.fbSpend) : ''}</td>}
                    {hasGa && <td className="px-3 py-1.5 text-end tabular-nums">{r ? formatNumber(r.gaSpend) : ''}</td>}
                    {hasTt && (
                      <td className="px-3 py-1.5 text-end tabular-nums">
                        {r ? ((r.ttSpend ?? 0) > 0 ? formatNumber(r.ttSpend) : '—') : ''}
                      </td>
                    )}
                    <td className="px-3 py-1.5 text-end tabular-nums">{r ? formatNumber(r.totalSpend) : ''}</td>
                    <td className="px-3 py-1.5 text-end tabular-nums">
                      {r ? formatNumber(r.revenue) : ''}
                      {r && (
                        <RefundIndicator
                          grossRevenue={r.grossRevenue}
                          refundDeduction={r.refundDeduction}
                        />
                      )}
                    </td>
                    <td className={cn('px-3 py-1.5 text-center tabular-nums font-medium', cell.className)}>
                      {cell.text}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-border bg-surfaceMuted font-semibold">
                <td className="px-3 py-2">סך הכל</td>
                {hasGa && <td className="px-3 py-2 text-end tabular-nums">{formatNumber(totalFb)}</td>}
                {hasGa && <td className="px-3 py-2 text-end tabular-nums">{formatNumber(totalGa)}</td>}
                {hasTt && <td className="px-3 py-2 text-end tabular-nums">{formatNumber(totalTt)}</td>}
                <td className="px-3 py-2 text-end tabular-nums">{formatNumber(totalSpend)}</td>
                <td className="px-3 py-2 text-end tabular-nums">
                  {formatNumber(totalRev)}
                  <RefundIndicator
                    grossRevenue={totalGross}
                    refundDeduction={totalRefund}
                  />
                </td>
                <td className={cn('px-3 py-2 text-center tabular-nums', roasCell(totalRoas, totalRev, totalSpend).className)}>
                  {roasCell(totalRoas, totalRev, totalSpend).text}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MonthBlockSummary({
  ym,
  rows,
  stores,
}: {
  ym: string;
  rows: DailyRow[];
  stores: string[];
}) {
  const [open, setOpen] = useState(true);
  const allDays = daysOfMonth(ym);

  // Aggregate by date across all stores. Phase 05.7.3: also accumulate
  // gross + refund so the summary table can show the refund indicator
  // per-day and on the month total.
  type Agg = { spend: number; revenue: number; gross: number; refund: number };
  const byDate = new Map<string, Agg>();
  for (const r of rows) {
    if (!byDate.has(r.date)) byDate.set(r.date, { spend: 0, revenue: 0, gross: 0, refund: 0 });
    const e = byDate.get(r.date)!;
    e.spend += r.totalSpend;
    e.revenue += r.revenue;
    e.gross += r.grossRevenue ?? r.revenue;
    if (r.refundDeduction !== null && r.refundDeduction > 0) {
      e.refund += r.refundDeduction;
    }
  }

  let totalSpend = 0, totalRev = 0, totalGross = 0, totalRefund = 0;
  for (const r of rows) {
    totalSpend += r.totalSpend;
    totalRev += r.revenue;
    totalGross += r.grossRevenue ?? r.revenue;
    if (r.refundDeduction !== null && r.refundDeduction > 0) {
      totalRefund += r.refundDeduction;
    }
  }
  const totalRoas = totalSpend > 0 ? totalRev / totalSpend : 0;
  const totalCell = roasCell(totalRoas, totalRev, totalSpend);

  return (
    <div className="rounded-xl bg-surface border border-border shadow-card overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-3 bg-slate-800 text-white"
      >
        <span className="font-semibold">
          {monthTitle(ym)}  •  סיכום כל החנויות ({stores.length})
        </span>
        {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>
      {open && (
        <div className="overflow-auto max-h-[60vh]">
          <table className="w-full text-xs sm:text-sm min-w-[500px]">
            <thead className="bg-surfaceMuted sticky top-0 z-[5]">
              <tr className="text-text-secondary">
                <th className="px-3 py-2 text-start font-medium">תאריך</th>
                <th className="px-3 py-2 text-end font-medium">יצא סה&quot;כ</th>
                <th className="px-3 py-2 text-end font-medium">נכנס סה&quot;כ</th>
                <th className="px-3 py-2 text-center font-medium">ROAS</th>
              </tr>
            </thead>
            <tbody>
              {allDays.map(d => {
                const agg = byDate.get(d);
                const roas = agg && agg.spend > 0 ? agg.revenue / agg.spend : 0;
                const cell = agg
                  ? roasCell(roas, agg.revenue, agg.spend)
                  : { className: '', text: '' };
                return (
                  <tr key={d} className={cn('border-t border-border', !agg && 'text-text-muted')}>
                    <td className="px-3 py-1.5 tabular-nums">{formatDate(d)}</td>
                    <td className="px-3 py-1.5 text-end tabular-nums">{agg ? formatNumber(agg.spend) : ''}</td>
                    <td className="px-3 py-1.5 text-end tabular-nums">
                      {agg ? formatNumber(agg.revenue) : ''}
                      {agg && agg.refund > 0 && (
                        <RefundIndicator
                          grossRevenue={agg.gross}
                          refundDeduction={agg.refund}
                        />
                      )}
                    </td>
                    <td className={cn('px-3 py-1.5 text-center tabular-nums font-medium', cell.className)}>
                      {cell.text}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-border bg-surfaceMuted font-semibold">
                <td className="px-3 py-2">סך הכל</td>
                <td className="px-3 py-2 text-end tabular-nums">{formatNumber(totalSpend)}</td>
                <td className="px-3 py-2 text-end tabular-nums">
                  {formatNumber(totalRev)}
                  <RefundIndicator
                    grossRevenue={totalGross}
                    refundDeduction={totalRefund}
                  />
                </td>
                <td className={cn('px-3 py-2 text-center tabular-nums', totalCell.className)}>
                  {totalCell.text}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function daysOfMonth(ym: string): string[] {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  const out: string[] = [];
  for (let d = 1; d <= last; d++) {
    out.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  return out;
}
