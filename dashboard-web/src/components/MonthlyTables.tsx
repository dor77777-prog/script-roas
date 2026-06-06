'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { CalendarDays, ChevronDown, ChevronUp } from 'lucide-react';
import type { DailyRow, DashboardData } from '@/lib/types';
import { cn, formatDate, formatNumber } from '@/lib/utils';
import { RefundIndicator } from './RefundIndicator';
import { Button } from '@/components/ui/Button';
import { NativeSelect } from '@/components/ui/NativeSelect';
import { TableBase } from '@/components/ui/TableBase';
import { buildDateRangeKey } from '@/lib/dateRange';
import { roasCell } from '@/lib/format/roasCell';
import { RoasBadge, roasCellTdClass } from '@/lib/format/RoasBadge';
import { Heading } from '@/components/ui/Typography';
import { isStoreFullyOff, type AdStateMap, type AdPlatform } from '@/lib/adState';

const HE_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

export type Mode = 'per-store' | 'summary';

type Props = {
  stores: string[];
  /**
   * The global store filter from the Dashboard (filters.store).
   * When set to a specific store (not "All"), MonthlyTables initialises its
   * local dropdown to that store and stays in sync when the global filter
   * changes. The operator can still override locally after that.
   */
  globalStore?: string;
  /** When true, omit the outer title/header — used inside CollapsibleSection. */
  bare?: boolean;
  /**
   * When provided, fetch only that calendar year's data (Jan 1 – Dec 31).
   * Defaults to the rolling 17-month history window for backwards compat.
   */
  year?: number;
  /**
   * When provided (1-12), restrict the visible months to the single month
   * matching that number within the selected year. Client-side filter only —
   * the SWR fetch still covers the full year range. When null or undefined,
   * all months of the year are shown (default behavior).
   */
  month?: number | null;
  /**
   * When true, suppress the internal mode-toggle (לפי חנות / סיכום כללי) and
   * store dropdown. Forces mode='per-store' and uses globalStore directly.
   * Use this when the parent is already controlling the store via a sub-tab
   * so the user doesn't have to pick a store in two places.
   */
  hideStoreToolbar?: boolean;
  /**
   * CONTROLLED mode (optional). When provided, MonthlyTables uses this value
   * instead of its internal useState AND suppresses its own toolbar — the
   * PARENT renders the mode toggle + store picker (so all selectors can share
   * one row). When omitted, behavior is byte-identical to the legacy internal
   * state + internal toolbar. Pair with `onModeChange` for a fully-driven UI.
   */
  mode?: Mode;
  /** Setter for the controlled `mode` (see above). */
  onModeChange?: (mode: Mode) => void;
  /**
   * CONTROLLED store filter (optional). Mirrors `mode` — when provided the
   * parent owns the value and MonthlyTables suppresses its internal toolbar.
   */
  storeFilter?: string;
  /** Setter for the controlled `storeFilter` (see above). */
  onStoreFilterChange?: (store: string) => void;
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
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Failed to load (${res.status})`);
  }
  return res.json() as Promise<DashboardData>;
};


export function MonthlyTables({
  stores,
  globalStore,
  bare = false,
  year,
  month,
  hideStoreToolbar = false,
  mode: controlledMode,
  onModeChange,
  storeFilter: controlledStoreFilter,
  onStoreFilterChange,
}: Props) {
  // The parent fully controls mode + store when it passes `mode`/`storeFilter`
  // (the lifted-row case). Then MonthlyTables suppresses its own toolbar and
  // reads the parent-owned values — no internal state, no useEffect sync.
  const isControlled = controlledMode != null && controlledStoreFilter != null;

  const [mode, setMode] = useState<Mode>('per-store');

  // Initialise the local store dropdown from the global filter when it names a
  // specific store; otherwise fall back to the first available store.
  // A useEffect keeps the two in sync when the operator changes the global
  // filter — but still allows a local override once the component is mounted.
  const initialStore =
    globalStore && globalStore !== 'All' && stores.includes(globalStore)
      ? globalStore
      : stores[0] || 'All';
  const [storeFilter, setStoreFilter] = useState<string>(initialStore);

  // Effective mode/store resolution precedence:
  //   1. controlled props (parent owns the lifted toolbar)
  //   2. hideStoreToolbar (parent owns the store via a sub-tab → per-store)
  //   3. internal state (legacy: own toolbar)
  const effectiveMode: Mode = isControlled
    ? controlledMode
    : hideStoreToolbar
      ? 'per-store'
      : mode;
  const effectiveStoreFilter: string = isControlled
    ? controlledStoreFilter
    : hideStoreToolbar && globalStore && globalStore !== 'All'
      ? globalStore
      : storeFilter;

  // The internal toolbar is suppressed when the parent controls the toolbar
  // (controlled props) OR when hideStoreToolbar is set.
  const showInternalToolbar = !isControlled && !hideStoreToolbar;

  useEffect(() => {
    // Only the internally-managed storeFilter needs global-filter sync; when
    // controlled the parent owns (and seeds) the value.
    if (isControlled) return;
    if (!globalStore || globalStore === 'All') return;
    if (stores.includes(globalStore)) {
      setStoreFilter(globalStore);
    }
  }, [globalStore, stores, isControlled]);

  const historyRange = useMemo(() => {
    if (year != null) {
      return { from: `${year}-01-01`, to: `${year}-12-31` };
    }
    return { from: isoMonthsAgo(MONTHLY_TABLES_HISTORY_MONTHS), to: isoToday() };
  }, [year]);

  const { data, error, isLoading } = useSWR<DashboardData>(
    buildDateRangeKey('/api/data', historyRange),
    fetcher,
    { revalidateOnFocus: false },
  );

  const rows: DailyRow[] = data?.rows ?? [];
  const adStateMap: AdStateMap = data?.adStateMap ?? {};
  const storeApplicablePlatforms: Record<string, AdPlatform[]> = data?.storeApplicablePlatforms ?? {};

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

  // Client-side month filter: when `month` is a number (1-12), keep only
  // the single month group whose key matches `${year}-MM`. No re-fetch.
  const visibleMonthGroups = useMemo(() => {
    if (month == null) return monthGroups;
    const suffix = String(month).padStart(2, '0');
    // If a year is locked, prefer exact YYYY-MM match; otherwise just match -MM.
    const target = year != null ? `${year}-${suffix}` : suffix;
    return monthGroups.filter(({ ym }) =>
      year != null ? ym === target : ym.endsWith(`-${suffix}`),
    );
  }, [monthGroups, month, year]);

  if (isLoading) {
    return (
      <div className={cn('px-4 sm:px-5 py-6 text-sm text-ink-secondary', bare && 'border-b border-glass-edge')}>
        טוען טבלאות חודשיות...
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn('px-4 sm:px-5 py-6 text-sm text-status-redFg', bare && 'border-b border-glass-edge')}>
        שגיאה בטעינת הטבלאות החודשיות: {error instanceof Error ? error.message : String(error)}
      </div>
    );
  }

  if (!rows.length) return null;

  // Internal-toolbar change handlers: drive the internal state and ALSO notify
  // the optional callbacks so a parent can observe (uncontrolled) changes
  // without taking full control. In the controlled case the toolbar isn't
  // rendered, so these are inert.
  const handleInternalMode = (next: Mode) => {
    setMode(next);
    onModeChange?.(next);
  };
  const handleInternalStore = (next: string) => {
    setStoreFilter(next);
    onStoreFilterChange?.(next);
  };

  const toolbar = (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2',
        bare && 'px-4 sm:px-5 py-3 bg-glass-2/40 border-b border-glass-edge',
      )}
    >
      <div
        role="tablist"
        className="inline-flex rounded-lg border border-glass-edge bg-glass-1 overflow-hidden divide-x divide-glass-edge"
        dir="ltr"
      >
        <Tab active={mode === 'per-store'} onClick={() => handleInternalMode('per-store')}>
          לפי חנות
        </Tab>
        <Tab active={mode === 'summary'} onClick={() => handleInternalMode('summary')}>
          סיכום כללי
        </Tab>
      </div>
      {mode === 'per-store' && (
        <NativeSelect
          aria-label="חנות"
          value={storeFilter}
          onChange={e => handleInternalStore(e.target.value)}
          className="font-medium w-auto"
        >
          {stores.map(s => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </NativeSelect>
      )}
      <span className="text-[10px] sm:text-xs text-ink-muted ms-auto tabular-nums">
        {visibleMonthGroups.length} חודשים
      </span>
    </div>
  );

  // Determine the two most recent months (current + previous) for default-open.
  const { y: todayY, m: todayM } = ilTodayParts();
  const currentYm = `${todayY}-${String(todayM).padStart(2, '0')}`;
  const prevDate = new Date(Date.UTC(todayY, todayM - 2, 1));
  const prevYm = `${prevDate.getUTCFullYear()}-${String(prevDate.getUTCMonth() + 1).padStart(2, '0')}`;

  const blocks = (
    <div className={cn('space-y-4', bare ? 'p-4 sm:p-5 pt-4' : 'space-y-6')}>
      {visibleMonthGroups.map(({ ym, rows: monthRows }) => {
        const defaultOpen = ym === currentYm || ym === prevYm;
        if (effectiveMode === 'per-store') {
          const storeRows = monthRows.filter(r => r.storeName === effectiveStoreFilter);
          if (!storeRows.length) return null;
          return <MonthBlockPerStore key={ym} ym={ym} storeName={effectiveStoreFilter} rows={storeRows} defaultOpen={defaultOpen} adStateMap={adStateMap} storeApplicablePlatforms={storeApplicablePlatforms} />;
        }
        return <MonthBlockSummary key={ym} ym={ym} rows={monthRows} stores={stores} defaultOpen={defaultOpen} adStateMap={adStateMap} storeApplicablePlatforms={storeApplicablePlatforms} />;
      })}
    </div>
  );

  if (bare) {
    return (
      <div>
        {showInternalToolbar && toolbar}
        {blocks}
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Heading level="section" className="flex items-center gap-2">
          <CalendarDays size={18} className="text-ink-secondary" />
          טבלאות חודשיות
        </Heading>
        {showInternalToolbar && toolbar}
      </div>
      {blocks}
    </section>
  );
}

// Exported so AnalysisArchiveTab can render the SAME mode toggle in its
// shared controls row (the lifted-toolbar case) without duplicating markup.
export function Tab({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <Button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      variant="ghost"
      className={cn(
        'px-3 sm:px-3.5 py-2 sm:py-2 text-xs sm:text-sm font-medium transition-colors min-h-[44px] sm:min-h-0 h-auto',
        active
          ? 'bg-accent text-accent-fg hover:bg-[color-mix(in_oklab,var(--accent)_88%,var(--text))]'
          : 'bg-glass-1 text-ink-secondary hover:bg-glass-2',
      )}
    >
      {children}
    </Button>
  );
}

function monthTitle(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return `${HE_MONTHS[m - 1]} ${y}`;
}

export function MonthBlockPerStore({
  ym,
  storeName,
  rows,
  defaultOpen = true,
  adStateMap = {},
  storeApplicablePlatforms = {},
}: {
  ym: string;
  storeName: string;
  rows: DailyRow[];
  defaultOpen?: boolean;
  adStateMap?: AdStateMap;
  storeApplicablePlatforms?: Record<string, AdPlatform[]>;
}) {
  // Derive storeId from the first row (all rows in the block belong to the same store).
  const storeId = rows[0]?.storeId ?? storeName;
  const off = isStoreFullyOff(storeId, adStateMap, storeApplicablePlatforms[storeId] ?? []);
  const [open, setOpen] = useState(defaultOpen);
  // Per-platform column visibility — INDEPENDENT per platform: each column is
  // shown iff that platform spent > 0 this month (2026-06-01: previously
  // פייסבוק+גוגל were both gated by gaSpend, so a Facebook-only store hid both).
  const hasFb = rows.some(r => r.fbSpend > 0);
  const hasGa = rows.some(r => r.gaSpend > 0);
  // Phase 05.7.7 — show TikTok column only when at least one row in this
  // month/store has TikTok spend (currently uzoshop-only).
  const hasTt = rows.some(r => (r.ttSpend ?? 0) > 0);
  const anyPlatform = hasFb || hasGa || hasTt;

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
    <div className="rounded-xl bg-glass-1 border border-glass-edge shadow-glass overflow-hidden">
      <Button
        variant="ghost"
        onClick={() => setOpen(!open)}
        className="w-full justify-between gap-2 px-4 sm:px-5 py-3 min-h-[44px] h-auto bg-ink text-canvas hover:bg-[color-mix(in_oklab,var(--text)_90%,var(--canvas-1))]"
      >
        <span className="font-semibold truncate min-w-0">
          {monthTitle(ym)}  •  {storeName}
        </span>
        {open ? <ChevronUp size={18} className="shrink-0" /> : <ChevronDown size={18} className="shrink-0" />}
      </Button>
      {open && (
        <div className="overflow-auto max-h-[60vh]">
          <TableBase className="text-xs sm:text-sm" minWidth={500} stickyHeader>
            <thead>
              <tr className="text-ink-secondary">
                <th className="px-3 py-2 text-start font-medium">תאריך</th>
                {hasFb && <th className="px-3 py-2 text-end font-medium">פייסבוק</th>}
                {hasGa && <th className="px-3 py-2 text-end font-medium">גוגל</th>}
                {hasTt && <th className="px-3 py-2 text-end font-medium">טיקטוק</th>}
                <th className="px-3 py-2 text-end font-medium">{anyPlatform ? 'יצא סה"כ' : 'יצא'}</th>
                <th className="px-3 py-2 text-end font-medium">נכנס</th>
                <th className="px-3 py-2 text-center font-medium">ROAS</th>
              </tr>
            </thead>
            <tbody>
              {allDays.map(d => {
                const r = byDate.get(d);
                const isEmpty = !r;
                const cell = r
                  ? roasCell(r.roas, r.revenue, r.totalSpend, off)
                  : { className: '', text: '' };
                return (
                  <tr key={d} className={cn('border-t border-glass-edge', isEmpty && 'text-ink-muted')}>
                    <td className="px-3 py-1.5 tabular-nums">{formatDate(d)}</td>
                    {hasFb && <td className="px-3 py-1.5 text-end tabular-nums">{r ? formatNumber(r.fbSpend) : ''}</td>}
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
                    <td className={cn('px-3 py-1.5 text-center tabular-nums font-medium', roasCellTdClass(cell.className))}>
                      <RoasBadge className={cell.className} text={cell.text} />
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-glass-edge bg-glass-2 font-semibold">
                <td className="px-3 py-2">סך הכל</td>
                {hasFb && <td className="px-3 py-2 text-end tabular-nums">{formatNumber(totalFb)}</td>}
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
                {(() => {
                  const totalCell = roasCell(totalRoas, totalRev, totalSpend, off);
                  return (
                    <td className={cn('px-3 py-2 text-center tabular-nums', roasCellTdClass(totalCell.className))}>
                      <RoasBadge className={totalCell.className} text={totalCell.text} />
                    </td>
                  );
                })()}
              </tr>
            </tbody>
          </TableBase>
        </div>
      )}
    </div>
  );
}

export function MonthBlockSummary({
  ym,
  rows,
  stores,
  defaultOpen = true,
  adStateMap = {},
  storeApplicablePlatforms = {},
}: {
  ym: string;
  rows: DailyRow[];
  stores: string[];
  defaultOpen?: boolean;
  adStateMap?: AdStateMap;
  storeApplicablePlatforms?: Record<string, AdPlatform[]>;
}) {
  // Business-level off flag: true ONLY when ALL stores that have applicable
  // platforms are fully off. An empty storeApplicablePlatforms means no
  // ad-state info → allOff stays false (backward-compatible).
  const allOff =
    Object.keys(storeApplicablePlatforms).length > 0 &&
    Object.keys(storeApplicablePlatforms).every((sid) =>
      isStoreFullyOff(sid, adStateMap, storeApplicablePlatforms[sid] ?? []),
    );
  const [open, setOpen] = useState(defaultOpen);
  const allDays = daysOfMonth(ym);

  // Aggregate by date across all stores. Phase 05.7.3: also accumulate
  // gross + refund so the summary table can show the refund indicator
  // per-day and on the month total.
  type Agg = { fb: number; ga: number; tt: number; spend: number; revenue: number; gross: number; refund: number };
  const byDate = new Map<string, Agg>();
  for (const r of rows) {
    if (!byDate.has(r.date)) byDate.set(r.date, { fb: 0, ga: 0, tt: 0, spend: 0, revenue: 0, gross: 0, refund: 0 });
    const e = byDate.get(r.date)!;
    e.fb += r.fbSpend;
    e.ga += r.gaSpend;
    e.tt += r.ttSpend ?? 0;
    e.spend += r.totalSpend;
    e.revenue += r.revenue;
    e.gross += r.grossRevenue ?? r.revenue;
    if (r.refundDeduction !== null && r.refundDeduction > 0) {
      e.refund += r.refundDeduction;
    }
  }
  // Per-platform column visibility — show a platform iff it spent this month
  // anywhere across the stores in scope (independent per platform).
  const hasFb = rows.some(r => r.fbSpend > 0);
  const hasGa = rows.some(r => r.gaSpend > 0);
  const hasTt = rows.some(r => (r.ttSpend ?? 0) > 0);
  const anyPlatform = hasFb || hasGa || hasTt;

  let totalFb = 0, totalGa = 0, totalTt = 0;
  let totalSpend = 0, totalRev = 0, totalGross = 0, totalRefund = 0;
  for (const r of rows) {
    totalFb += r.fbSpend;
    totalGa += r.gaSpend;
    totalTt += r.ttSpend ?? 0;
    totalSpend += r.totalSpend;
    totalRev += r.revenue;
    totalGross += r.grossRevenue ?? r.revenue;
    if (r.refundDeduction !== null && r.refundDeduction > 0) {
      totalRefund += r.refundDeduction;
    }
  }
  const totalRoas = totalSpend > 0 ? totalRev / totalSpend : 0;
  const totalCell = roasCell(totalRoas, totalRev, totalSpend, allOff);

  return (
    <div className="rounded-xl bg-glass-1 border border-glass-edge shadow-glass overflow-hidden">
      <Button
        variant="ghost"
        onClick={() => setOpen(!open)}
        className="w-full justify-between gap-2 px-4 sm:px-5 py-3 min-h-[44px] h-auto bg-ink text-canvas hover:bg-[color-mix(in_oklab,var(--text)_90%,var(--canvas-1))]"
      >
        <span className="font-semibold truncate min-w-0">
          {monthTitle(ym)}  •  סיכום כל החנויות ({stores.length})
        </span>
        {open ? <ChevronUp size={18} className="shrink-0" /> : <ChevronDown size={18} className="shrink-0" />}
      </Button>
      {open && (
        <div className="overflow-auto max-h-[60vh]">
          <TableBase className="text-xs sm:text-sm" minWidth={640} stickyHeader>
            <thead>
              <tr className="text-ink-secondary">
                <th className="px-3 py-2 text-start font-medium">תאריך</th>
                {hasFb && <th className="px-3 py-2 text-end font-medium">פייסבוק</th>}
                {hasGa && <th className="px-3 py-2 text-end font-medium">גוגל</th>}
                {hasTt && <th className="px-3 py-2 text-end font-medium">טיקטוק</th>}
                <th className="px-3 py-2 text-end font-medium">{anyPlatform ? 'יצא סה"כ' : 'יצא'}</th>
                <th className="px-3 py-2 text-end font-medium">נכנס סה&quot;כ</th>
                <th className="px-3 py-2 text-center font-medium">ROAS</th>
              </tr>
            </thead>
            <tbody>
              {allDays.map(d => {
                const agg = byDate.get(d);
                const roas = agg && agg.spend > 0 ? agg.revenue / agg.spend : 0;
                const cell = agg
                  ? roasCell(roas, agg.revenue, agg.spend, allOff)
                  : { className: '', text: '' };
                return (
                  <tr key={d} className={cn('border-t border-glass-edge', !agg && 'text-ink-muted')}>
                    <td className="px-3 py-1.5 tabular-nums">{formatDate(d)}</td>
                    {hasFb && <td className="px-3 py-1.5 text-end tabular-nums">{agg ? formatNumber(agg.fb) : ''}</td>}
                    {hasGa && <td className="px-3 py-1.5 text-end tabular-nums">{agg ? formatNumber(agg.ga) : ''}</td>}
                    {hasTt && <td className="px-3 py-1.5 text-end tabular-nums">{agg ? formatNumber(agg.tt) : ''}</td>}
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
                    <td className={cn('px-3 py-1.5 text-center tabular-nums font-medium', roasCellTdClass(cell.className))}>
                      <RoasBadge className={cell.className} text={cell.text} />
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-glass-edge bg-glass-2 font-semibold">
                <td className="px-3 py-2">סך הכל</td>
                {hasFb && <td className="px-3 py-2 text-end tabular-nums">{formatNumber(totalFb)}</td>}
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
                <td className={cn('px-3 py-2 text-center tabular-nums', roasCellTdClass(totalCell.className))}>
                  <RoasBadge className={totalCell.className} text={totalCell.text} />
                </td>
              </tr>
            </tbody>
          </TableBase>
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
