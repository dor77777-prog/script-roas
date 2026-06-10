'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import {
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Calendar,
  Radio,
  Store,
} from 'lucide-react';
import { cn, formatDate, formatNumber } from '@/lib/utils';
import { fmtMoney } from '@/lib/format';
import { Money } from '@/components/ui/Money';
import { Button } from '@/components/ui/Button';
import { NativeSelect } from '@/components/ui/NativeSelect';
import { Stat } from '@/components/ui/Stat';
import { TableBase } from '@/components/ui/TableBase';
import { HelpTooltip } from '@/components/ui/Tooltip';
import type { ProductRow } from '@/lib/products';
import type { ProductsResponse } from '@/app/api/products/route';
import type { DateRange } from '@/lib/types';
import { buildDateRangeKey } from '@/lib/dateRange';
import { readTabLocalState, syncTabLocalUrl } from '@/lib/urlState';

type Period = 'day' | 'week' | 'month' | 'half_year' | 'year';

const PERIOD_LABELS: Record<Period, string> = {
  day: 'יומי',
  week: 'שבועי',
  month: 'חודשי',
  half_year: 'חצי-שנתי',
  year: 'שנתי',
};

const fetcher = async (url: string) => {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body?.error || `HTTP ${r.status}`);
  }
  return r.json() as Promise<ProductsResponse>;
};

// --- date bucketing ---------------------------------------------------------

function isoWeek(dateStr: string): { year: number; week: number } {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: date.getUTCFullYear(), week };
}

function bucketKey(dateStr: string, period: Period): string {
  const [y, m] = dateStr.split('-');
  switch (period) {
    case 'day':
      return dateStr;
    case 'week': {
      const { year, week } = isoWeek(dateStr);
      return `${year}-W${String(week).padStart(2, '0')}`;
    }
    case 'month':
      return `${y}-${m}`;
    case 'half_year':
      return `${y}-H${parseInt(m, 10) <= 6 ? 1 : 2}`;
    case 'year':
      return y;
  }
}

function bucketLabel(key: string, period: Period): string {
  if (period === 'day') return formatDate(key);
  if (period === 'week') {
    const [year, w] = key.split('-W');
    return `שבוע ${parseInt(w, 10)} · ${year}`;
  }
  if (period === 'month') {
    const [y, m] = key.split('-');
    const months = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
                    'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
    return `${months[parseInt(m, 10) - 1]} ${y}`;
  }
  if (period === 'half_year') {
    const [y, h] = key.split('-H');
    return `${h === '1' ? 'מחצית 1' : 'מחצית 2'} · ${y}`;
  }
  return key;
}

function todayInIsrael(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function nowInIsrael(): string {
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date());
}

// --- aggregation ------------------------------------------------------------

type ProductAgg = {
  productId: string;
  productTitle: string;
  units: number;
  orders: number;
  revenue: number;
  /** null = no rows in this product had net revenue data yet. */
  netRevenue: number | null;
  days: number;
};

type BucketAgg = {
  key: string;
  label: string;
  totalUnits: number;
  totalOrders: number;
  totalRevenue: number;
  /** null = no rows in this bucket had net revenue data yet. */
  totalNetRevenue: number | null;
  products: ProductAgg[];
  isLive: boolean;
  hasOrders: boolean;
  hasNet: boolean; // false until at least one row in this bucket reports net
};

function aggregate(
  rows: ProductRow[],
  period: Period,
  store: string,
  range: DateRange,
): BucketAgg[] {
  const today = todayInIsrael();
  const liveBucketKey = bucketKey(today, period);

  const filtered = rows.filter(r => {
    if (r.date < range.from || r.date > range.to) return false;
    if (store !== 'All' && r.storeName !== store) return false;
    return true;
  });

  // For each bucket, track whether *any* row contributed real orders / net
  // revenue data (vs. legacy rows where these columns didn't exist yet).
  const buckets = new Map<
    string,
    {
      products: Map<
        string,
        ProductAgg & { dateSet: Set<string>; hasNet: boolean }
      >;
      hasOrders: boolean;
      hasNet: boolean;
    }
  >();

  for (const r of filtered) {
    const bk = bucketKey(r.date, period);
    if (!buckets.has(bk))
      buckets.set(bk, { products: new Map(), hasOrders: false, hasNet: false });
    const bucket = buckets.get(bk)!;
    if (r.orders > 0) bucket.hasOrders = true;
    if (r.netRevenue !== null) bucket.hasNet = true;

    const productKey = store === 'All' ? `${r.storeName}::${r.productId}` : r.productId;
    const display = store === 'All' ? `${r.productTitle}  ·  ${r.storeName}` : r.productTitle;
    if (!bucket.products.has(productKey)) {
      bucket.products.set(productKey, {
        productId: r.productId,
        productTitle: display,
        units: 0,
        orders: 0,
        revenue: 0,
        netRevenue: null,
        days: 0,
        dateSet: new Set<string>(),
        hasNet: false,
      });
    }
    const p = bucket.products.get(productKey)!;
    p.units += r.units;
    p.orders += r.orders;
    p.revenue += r.revenue;
    if (r.netRevenue !== null) {
      p.netRevenue = (p.netRevenue ?? 0) + r.netRevenue;
      p.hasNet = true;
    }
    p.dateSet.add(r.date);
  }

  const out: BucketAgg[] = [];
  for (const [key, bucket] of buckets) {
    const products = Array.from(bucket.products.values())
      .map(p => ({
        productId: p.productId,
        productTitle: p.productTitle,
        units: p.units,
        orders: p.orders,
        revenue: p.revenue,
        netRevenue: p.hasNet ? p.netRevenue : null,
        days: p.dateSet.size,
      }))
      .sort((a, b) => b.units - a.units);
    const totalUnits = products.reduce((s, p) => s + p.units, 0);
    const totalOrders = products.reduce((s, p) => s + p.orders, 0);
    const totalRevenue = products.reduce((s, p) => s + p.revenue, 0);
    const totalNetRevenue = bucket.hasNet
      ? products.reduce((s, p) => s + (p.netRevenue ?? 0), 0)
      : null;
    out.push({
      key,
      label: bucketLabel(key, period),
      totalUnits,
      totalOrders,
      totalRevenue,
      totalNetRevenue,
      products,
      isLive: key === liveBucketKey,
      hasOrders: bucket.hasOrders,
      hasNet: bucket.hasNet,
    });
  }

  // Ensure today's bucket appears even with zero products (e.g. early morning,
  // or store hasn't had an order yet). User explicitly asked for the live row
  // to show "today as of now" even when empty.
  const todayInRange = today >= range.from && today <= range.to;
  if (todayInRange && !out.some(b => b.key === liveBucketKey)) {
    out.push({
      key: liveBucketKey,
      label: bucketLabel(liveBucketKey, period),
      totalUnits: 0,
      totalOrders: 0,
      totalRevenue: 0,
      totalNetRevenue: null,
      products: [],
      isLive: true,
      hasOrders: false,
      hasNet: false,
    });
  }

  return out.sort((a, b) => b.key.localeCompare(a.key));
}

// --- component --------------------------------------------------------------

type Props = {
  /** Inherited from main Dashboard filters — provides the initial scope. */
  range: DateRange;
  store: string;
  stores: string[];
};

const TOP_N_DEFAULT = 5;

export function ProductsTable({ range, store: globalStore, stores }: Props) {
  const [period, setPeriod] = useState<Period>('day');

  // Local store filter — defaults to global, syncs when global changes, but
  // user can override per-section without affecting the rest of the page.
  // Phase 12.5 — initial value hydrated from URL `p_store` param. When the
  // global store changes after mount, we still reset to it (operator's
  // explicit Filters change should override the per-tab override).
  const [localStore, setLocalStore] = useState(() => {
    if (typeof window === 'undefined') return globalStore;
    const url = readTabLocalState('products', window.location.search);
    return url.store ?? globalStore;
  });
  const hydratedStoreFromUrlRef = useRef(false);
  useEffect(() => {
    if (!hydratedStoreFromUrlRef.current) {
      hydratedStoreFromUrlRef.current = true;
      return;
    }
    setLocalStore(globalStore);
  }, [globalStore]);

  // The Products tab follows the page-global date range — there is no separate
  // in-tab date picker (unified 2026-06-01 to remove dual-picker confusion +
  // the bug class where the tab's window diverged from the page's). Kept as the
  // name `localRange` so downstream references (SWR key, aggregation, bucket math)
  // read unchanged; it is now simply an alias of `range`.
  const localRange = range;

  // Push ProductsTable's tab-local state into the URL whenever it changes.
  // `syncTabLocalUrl` only updates the `p_*` params — global state preserved.
  // The tab no longer carries its own range (it follows the global one), so we
  // only persist the store filter; omitting `preset`/`range` makes
  // `syncTabLocalUrl` delete any stale `p_preset`/`p_from`/`p_to` from the URL.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    syncTabLocalUrl('products', {
      store: localStore,
    }, globalStore);
  }, [localStore, localRange.from, localRange.to, globalStore]);

  const { data, error, isLoading } = useSWR<ProductsResponse>(
    buildDateRangeKey('/api/products', localRange),
    fetcher,
    {
      refreshInterval: 60_000,
      revalidateOnFocus: true,
    },
  );

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [nowLabel, setNowLabel] = useState(nowInIsrael());
  useEffect(() => {
    const t = setInterval(() => setNowLabel(nowInIsrael()), 30_000);
    return () => clearInterval(t);
  }, []);

  const buckets = useMemo(() => {
    if (!data) return [];
    return aggregate(data.rows, period, localStore, localRange);
  }, [data, period, localStore, localRange]);

  // Range-level totals for the summary card at the top.
  const summary = useMemo(() => {
    let units = 0;
    let orders = 0;
    let gross = 0;
    let net: number | null = null;
    const productKeys = new Set<string>();
    let hasNet = false;
    for (const b of buckets) {
      units += b.totalUnits;
      orders += b.totalOrders;
      gross += b.totalRevenue;
      if (b.hasNet && b.totalNetRevenue !== null) {
        hasNet = true;
        net = (net ?? 0) + b.totalNetRevenue;
      }
      for (const p of b.products) productKeys.add(p.productId || p.productTitle);
    }
    // Days in the selected range (inclusive).
    const fromMs = new Date(localRange.from + 'T00:00:00Z').getTime();
    const toMs = new Date(localRange.to + 'T00:00:00Z').getTime();
    const days = Math.max(1, Math.round((toMs - fromMs) / 86400000) + 1);
    return {
      units,
      orders,
      gross,
      net: hasNet ? net : null,
      productCount: productKeys.size,
      days,
      avgUnitsPerDay: units / days,
      avgGrossPerDay: gross / days,
    };
  }, [buckets, localRange]);

  function toggle(key: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const toolbar = (
    <div className="flex flex-col sm:flex-row sm:items-center sm:flex-wrap gap-2 sm:gap-3 px-4 sm:px-5 py-3 bg-glass-2/40 border-b border-glass-edge">
      {/* Period selector */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] sm:text-xs text-ink-secondary font-medium shrink-0">
          תצוגה:
        </span>
        <div
          role="tablist"
          className="inline-flex rounded-lg border border-glass-edge bg-glass-1 overflow-hidden divide-x divide-glass-edge"
          dir="ltr"
        >
          {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
            <Button
              key={p}
              role="tab"
              variant={period === p ? 'primary' : 'ghost'}
              aria-selected={period === p}
              onClick={() => setPeriod(p)}
              className={cn(
                'px-2.5 sm:px-3 py-1.5 h-auto text-[11px] sm:text-xs font-medium min-w-[54px] sm:min-w-[64px] rounded-none',
                period === p ? '' : 'text-ink-secondary',
              )}
            >
              {PERIOD_LABELS[p]}
            </Button>
          ))}
        </div>
      </div>

      {/* Store filter — independent from global */}
      <div className="flex items-center gap-2">
        <Store size={14} className="text-ink-muted shrink-0" />
        <NativeSelect
          value={localStore}
          onChange={e => setLocalStore(e.target.value)}
          className="text-xs sm:text-sm font-medium min-w-[140px]"
        >
          <option value="All">כל החנויות</option>
          {stores.map(s => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </NativeSelect>
      </div>

      <span className="text-[10px] sm:text-xs text-ink-muted tabular-nums sm:me-auto">
        {summary.days === 1
          ? `יום אחד · ${formatDate(localRange.from)}`
          : `${summary.days} ימים · ${buckets.length} ${period === 'day' ? 'ימים' : 'תקופות'}`}
      </span>
    </div>
  );

  const summaryCard = data && buckets.length > 0 && (
    <SummaryCard
      store={localStore}
      from={localRange.from}
      to={localRange.to}
      summary={summary}
    />
  );

  return (
    <div>
      {toolbar}
      {summaryCard}

      {/* Surface BOTH SWR-thrown errors AND the 200-with-empty-rows degraded
        * path (data.error). After WR-06, /api/products returns 200 with
        * rows: [] + error on failure so SWR consumers stay consistent. */}
      {(error || data?.error) && (
        <div className="m-4 rounded-lg bg-status-redBg border border-status-red p-3 flex items-start gap-2 text-sm">
          <AlertCircle className="text-status-redFg shrink-0" size={18} />
          <div>
            <div className="font-semibold text-status-redFg">שגיאה בטעינת המוצרים</div>
            <div className="text-ink-secondary text-xs mt-1">
              {error ? (error as Error).message : data?.error}
            </div>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="p-8 text-center text-ink-muted text-sm">טוען נתוני מוצרים…</div>
      )}

      {data && !error && !data.error && buckets.length === 0 && (
        <div className="p-8 text-center text-ink-muted text-sm">
          <Calendar className="mx-auto mb-2 text-ink-subtle" size={28} />
          <div>אין מוצרים שנמכרו בטווח הזה.</div>
          <div className="text-[11px] mt-1">נסה לבחור טווח תאריכים רחב יותר בסינון למעלה.</div>
        </div>
      )}

      {data && buckets.length > 0 && (
        <div className="divide-y divide-glass-edge">
          {buckets.map(bucket => {
            const isExpanded = expanded.has(bucket.key);
            const shouldCollapse = bucket.products.length > TOP_N_DEFAULT;
            const shown =
              isExpanded || !shouldCollapse
                ? bucket.products
                : bucket.products.slice(0, TOP_N_DEFAULT);
            const remaining = bucket.products.length - shown.length;
            const isLive = bucket.isLive;
            const isEmpty = bucket.products.length === 0;

            return (
              <div
                key={bucket.key}
                className={cn(
                  isLive && 'bg-gradient-to-r from-status-greenBg to-transparent',
                )}
              >
                {/* Bucket header */}
                <div className="px-4 sm:px-5 py-3 flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    {isLive && (
                      <span className="relative inline-flex h-2.5 w-2.5 shrink-0">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-status-green opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-status-green"></span>
                      </span>
                    )}
                    <span className="font-semibold text-ink truncate">
                      {bucket.label}
                    </span>
                    {isLive && (
                      <HelpTooltip content="עד לרגע זה - יתעדכן עוד עד חצות">
                        <span className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-bold text-status-greenFg bg-status-greenBg px-1.5 py-0.5 rounded">
                          <Radio size={11} /> חי · {nowLabel}
                        </span>
                      </HelpTooltip>
                    )}
                  </div>
                  <div className="flex items-center gap-3 sm:gap-5 text-xs sm:text-sm tabular-nums">
                    {bucket.hasOrders && (
                      <div>
                        <span className="text-ink-muted text-[10px] sm:text-xs me-1">הזמנות</span>
                        <span className="font-semibold text-ink">
                          {formatNumber(bucket.totalOrders, 0)}
                        </span>
                      </div>
                    )}
                    <div>
                      <span className="text-ink-muted text-[10px] sm:text-xs me-1">יחידות</span>
                      <span className="font-semibold text-ink">
                        {formatNumber(bucket.totalUnits, 0)}
                      </span>
                    </div>
                    <div className="hidden sm:block">
                      <span className="text-ink-muted text-[10px] sm:text-xs me-1">ברוטו</span>
                      <span className="font-semibold text-ink">
                        {fmtMoney(bucket.totalRevenue)}
                      </span>
                    </div>
                    {bucket.hasNet && bucket.totalNetRevenue !== null && (
                      <HelpTooltip content="הכנסה אחרי הנחות והחזרים">
                        <div className="hidden md:block">
                          <span className="text-ink-muted text-[10px] sm:text-xs me-1">נטו</span>
                          <span className="font-semibold text-status-greenFg">
                            {fmtMoney(bucket.totalNetRevenue)}
                          </span>
                        </div>
                      </HelpTooltip>
                    )}
                  </div>
                </div>

                {/* Live bucket empty state — explain that data is on the way.
                    Copy-truth (2026-06-10 audit P1-26): "הסקריפט החי... כל 15
                    דקות" referred to the removed Apps-Script path; today the
                    hot-metrics worker refreshes ~every 10 min. */}
                {isLive && isEmpty && (
                  <div className="px-4 sm:px-5 py-4 text-center text-xs sm:text-sm text-ink-secondary border-t border-status-green bg-status-greenBg">
                    עוד לא נמכרו מוצרים היום. הנתונים מתעדכנים בערך כל 10 דקות —
                    שורה זו תמשיך להתעדכן עד חצות.
                  </div>
                )}

                {/* Products list */}
                {!isEmpty && (
                  <div className="overflow-auto max-h-[70vh]">
                    <TableBase className="text-xs sm:text-sm" minWidth={680} stickyHeader>
                      <thead>
                        <tr className="text-ink-secondary border-y border-glass-edge bg-glass-2/40">
                          <th className="px-4 sm:px-5 py-2 text-start font-medium">מוצר</th>
                          {bucket.hasOrders && (
                            <th className="px-3 py-2 text-end font-medium w-[80px]">
                              הזמנות
                            </th>
                          )}
                          <th className="px-3 py-2 text-end font-medium w-[80px]">
                            יחידות
                          </th>
                          <th className="px-3 py-2 text-end font-medium w-[110px]">
                            ברוטו
                          </th>
                          {bucket.hasNet && (
                            <th className="px-3 py-2 text-end font-medium w-[110px]">
                              <HelpTooltip content="אחרי הנחות והחזרות">
                                <span>נטו</span>
                              </HelpTooltip>
                            </th>
                          )}
                          {bucket.hasNet && (
                            <th className="px-3 py-2 text-end font-medium w-[70px]">
                              <HelpTooltip content="אחוז הנטו מתוך הברוטו — גבוה = מעט הנחות/החזרות">
                                <span>מרג&apos;ין</span>
                              </HelpTooltip>
                            </th>
                          )}
                          <th className="px-3 sm:px-5 py-2 text-end font-medium w-[70px]">
                            % יחידות
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((p, i) => {
                          const pct = bucket.totalUnits > 0 ? p.units / bucket.totalUnits : 0;
                          // Average units per order for this product, only meaningful when
                          // orders > 0 (otherwise legacy row without orders data).
                          const upo = p.orders > 0 ? p.units / p.orders : null;
                          return (
                            <tr
                              key={`${bucket.key}-${p.productId}-${i}`}
                              className="border-b border-glass-edge/60 hover:bg-glass-2/40"
                            >
                              <td className="px-4 sm:px-5 py-2 text-ink">
                                <div className="flex items-center gap-2">
                                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-glass-2 text-[10px] font-bold text-ink-secondary tabular-nums shrink-0">
                                    {i + 1}
                                  </span>
                                  <span className="truncate">{p.productTitle}</span>
                                </div>
                              </td>
                              {bucket.hasOrders && (
                                <td className="px-3 py-2 text-end tabular-nums">
                                  <span className="font-semibold text-ink">
                                    {p.orders > 0 ? formatNumber(p.orders, 0) : '—'}
                                  </span>
                                  {upo !== null && upo > 1.05 && (
                                    <HelpTooltip content={`ממוצע ${upo.toFixed(2)} יחידות להזמנה`}>
                                      <span className="block text-[9px] sm:text-[10px] text-ink-muted leading-tight">
                                        ×{upo.toFixed(1)}
                                      </span>
                                    </HelpTooltip>
                                  )}
                                </td>
                              )}
                              <td className="px-3 py-2 text-end font-semibold tabular-nums">
                                {formatNumber(p.units, 0)}
                              </td>
                              <td className="metric-cell px-3 py-2 text-end tabular-nums">
                                <Money value={p.revenue} prefix="none" locale="he-IL" compactAbove={100_000} />
                              </td>
                              {bucket.hasNet && (
                                <td className="metric-cell px-3 py-2 text-end tabular-nums">
                                  {p.netRevenue !== null ? (
                                    // 2026-06-09 (Task 8): neutral ink. Pre-fix
                                    // this turned GREEN whenever netRevenue <
                                    // revenue — i.e. on ANY discount/refund —
                                    // contradicting the adjacent Margin cell
                                    // which goes red/orange on the same haircut.
                                    // The margin column carries the discount
                                    // signal; the net value stays neutral.
                                    <span className="font-medium text-ink">
                                      <Money value={p.netRevenue} prefix="none" locale="he-IL" compactAbove={100_000} />
                                    </span>
                                  ) : (
                                    <span className="text-ink-muted">—</span>
                                  )}
                                </td>
                              )}
                              {bucket.hasNet && (
                                <td className="px-3 py-2 text-end tabular-nums">
                                  {p.netRevenue !== null && p.revenue > 0 ? (
                                    (() => {
                                      const margin = p.netRevenue / p.revenue;
                                      const pctStr = `${(margin * 100).toFixed(0)}%`;
                                      return (
                                        <HelpTooltip
                                          content={
                                            margin < 0.8
                                              ? `הנחות/החזרים: ${((1 - margin) * 100).toFixed(0)}%`
                                              : 'מרג\'ין גבוה - מעט הנחות'
                                          }
                                        >
                                          <span
                                            className={cn(
                                              'font-medium',
                                              margin >= 0.95 && 'text-status-greenFg',
                                              margin >= 0.8 && margin < 0.95 && 'text-ink',
                                              margin < 0.8 && 'text-status-orangeFg',
                                              margin < 0.5 && 'text-status-redFg',
                                            )}
                                          >
                                            {pctStr}
                                          </span>
                                        </HelpTooltip>
                                      );
                                    })()
                                  ) : (
                                    <span className="text-ink-muted">—</span>
                                  )}
                                </td>
                              )}
                              <td className="px-3 sm:px-5 py-2 text-end tabular-nums text-ink-muted">
                                {(pct * 100).toFixed(1)}%
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </TableBase>
                  </div>
                )}

                {/* Show more / show less */}
                {shouldCollapse && (
                  <div className="px-4 sm:px-5 py-2 bg-glass-2/30 border-t border-glass-edge/60">
                    <Button
                      variant="ghost"
                      onClick={() => toggle(bucket.key)}
                      className="h-auto p-0 gap-1.5 text-xs sm:text-sm text-accent hover:text-accent font-medium"
                    >
                      {isExpanded ? (
                        <>
                          <ChevronUp size={14} />
                          הצג פחות
                        </>
                      ) : (
                        <>
                          <ChevronDown size={14} />
                          הצג עוד {remaining} מוצרים
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// SummaryCard — sits between the toolbar and the bucket list, gives the user
// an at-a-glance "report" for the current store × range selection.
// ============================================================================

type SummaryData = {
  units: number;
  orders: number;
  gross: number;
  net: number | null;
  productCount: number;
  days: number;
  avgUnitsPerDay: number;
  avgGrossPerDay: number;
};

function SummaryCard({
  store,
  from,
  to,
  summary,
}: {
  store: string;
  from: string;
  to: string;
  summary: SummaryData;
}) {
  const storeLabel = store === 'All' ? 'כל החנויות' : store;
  const dateLabel =
    from === to ? formatDate(from) : `${formatDate(from)} — ${formatDate(to)}`;
  const haircut =
    summary.net !== null && summary.gross > 0
      ? 1 - summary.net / summary.gross
      : null;

  return (
    <div className="px-4 sm:px-5 py-3 sm:py-4 bg-gradient-to-l from-accent-bg to-glass-2 border-b border-glass-edge">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base sm:text-lg font-bold text-ink truncate">
            🏪 {storeLabel}
          </span>
          <span className="text-xs sm:text-sm text-ink-muted tabular-nums">·</span>
          <span className="text-xs sm:text-sm text-ink-secondary tabular-nums">
            {dateLabel}
          </span>
          <span className="text-[10px] sm:text-xs text-ink-muted">({summary.days} ימים)</span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-2 sm:gap-3">
        <Stat
          label="הזמנות"
          value={summary.orders > 0 ? formatNumber(summary.orders, 0) : '—'}
        />
        <Stat label="יחידות" value={formatNumber(summary.units, 0)} accent="attention" />
        <Stat label="ברוטו" value={fmtMoney(summary.gross)} />
        <Stat
          label="נטו"
          value={summary.net !== null ? fmtMoney(summary.net) : '—'}
          // 2026-06-09 (Task 8): neutral — was 'positive' (green) whenever net <
          // gross, i.e. on ANY haircut. The subtitle already discloses the
          // discount/refund %; the value itself shouldn't read as "good".
          accent="neutral"
          subtitle={
            haircut !== null && haircut > 0.005
              ? `−${(haircut * 100).toFixed(1)}% הנחות/החזרים`
              : undefined
          }
        />
        <Stat
          label="מוצרים שונים"
          value={formatNumber(summary.productCount, 0)}
          className="col-span-2 sm:col-span-1"
        />
      </div>

      {summary.days > 1 && (
        <div className="mt-3 pt-3 border-t border-glass-edge/60 flex items-center justify-between gap-3 flex-wrap text-[10px] sm:text-xs text-ink-muted tabular-nums">
          <span>
            ממוצע ליום:
            <span className="text-ink-secondary font-medium ms-1">
              {formatNumber(summary.avgUnitsPerDay, 1)}
            </span>
            יחידות ·
            <span className="text-ink-secondary font-medium ms-1">
              {fmtMoney(summary.avgGrossPerDay)}
            </span>
            ברוטו
          </span>
        </div>
      )}
    </div>
  );
}

// Local Stat fork removed in Wave-2 Task 2.3 — unified into
// `@/components/ui/Stat`. `primary` → accent="attention";
// `accent="green"` → accent="positive"; `subtitle` slot preserved.
