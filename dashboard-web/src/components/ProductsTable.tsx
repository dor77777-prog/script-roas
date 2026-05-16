'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Calendar,
  Radio,
  Store,
} from 'lucide-react';
import { cn, formatCurrency, formatDate, formatNumber } from '@/lib/utils';
import type { ProductRow } from '@/lib/products';
import type { ProductsResponse } from '@/app/api/products/route';
import type { DateRange } from '@/lib/types';

type Period = 'day' | 'week' | 'month' | 'half_year' | 'year';

const PERIOD_LABELS: Record<Period, string> = {
  day: 'יומי',
  week: 'שבועי',
  month: 'חודשי',
  half_year: 'חצי-שנתי',
  year: 'שנתי',
};

const fetcher = async (url: string) => {
  const r = await fetch(url);
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
  revenue: number;
  days: number;
};

type BucketAgg = {
  key: string;
  label: string;
  totalUnits: number;
  totalRevenue: number;
  products: ProductAgg[];
  isLive: boolean;
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

  const buckets = new Map<string, Map<string, ProductAgg & { dateSet: Set<string> }>>();

  for (const r of filtered) {
    const bk = bucketKey(r.date, period);
    if (!buckets.has(bk)) buckets.set(bk, new Map());
    const productMap = buckets.get(bk)!;
    const productKey = store === 'All' ? `${r.storeName}::${r.productId}` : r.productId;
    const display = store === 'All' ? `${r.productTitle}  ·  ${r.storeName}` : r.productTitle;
    if (!productMap.has(productKey)) {
      productMap.set(productKey, {
        productId: r.productId,
        productTitle: display,
        units: 0,
        revenue: 0,
        days: 0,
        dateSet: new Set<string>(),
      });
    }
    const p = productMap.get(productKey)!;
    p.units += r.units;
    p.revenue += r.revenue;
    p.dateSet.add(r.date);
  }

  const out: BucketAgg[] = [];
  for (const [key, productMap] of buckets) {
    const products = Array.from(productMap.values())
      .map(p => ({
        productId: p.productId,
        productTitle: p.productTitle,
        units: p.units,
        revenue: p.revenue,
        days: p.dateSet.size,
      }))
      .sort((a, b) => b.units - a.units);
    const totalUnits = products.reduce((s, p) => s + p.units, 0);
    const totalRevenue = products.reduce((s, p) => s + p.revenue, 0);
    out.push({
      key,
      label: bucketLabel(key, period),
      totalUnits,
      totalRevenue,
      products,
      isLive: key === liveBucketKey,
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
      totalRevenue: 0,
      products: [],
      isLive: true,
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
  const { data, error, isLoading } = useSWR<ProductsResponse>('/api/products', fetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: true,
  });

  const [period, setPeriod] = useState<Period>('day');
  // Independent local store filter — defaults to whatever the global filter
  // is, but the user can override it without changing the rest of the page.
  // We sync to the global value when it changes (so when the user picks
  // "uzoshop" in the global filter, products follow). They can then narrow
  // further inside the products panel.
  const [localStore, setLocalStore] = useState(globalStore);
  useEffect(() => {
    setLocalStore(globalStore);
  }, [globalStore]);

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [nowLabel, setNowLabel] = useState(nowInIsrael());
  useEffect(() => {
    const t = setInterval(() => setNowLabel(nowInIsrael()), 30_000);
    return () => clearInterval(t);
  }, []);

  const buckets = useMemo(() => {
    if (!data) return [];
    return aggregate(data.rows, period, localStore, range);
  }, [data, period, localStore, range]);

  function toggle(key: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const toolbar = (
    <div className="flex flex-col sm:flex-row sm:items-center sm:flex-wrap gap-2 sm:gap-3 px-4 sm:px-5 py-3 bg-surfaceMuted/40 border-b border-border">
      {/* Period selector */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] sm:text-xs text-text-secondary font-medium shrink-0">
          תצוגה:
        </span>
        <div
          role="tablist"
          className="inline-flex rounded-lg border border-border bg-surface overflow-hidden divide-x divide-border"
          dir="ltr"
        >
          {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
            <button
              key={p}
              role="tab"
              aria-selected={period === p}
              onClick={() => setPeriod(p)}
              className={cn(
                'px-2.5 sm:px-3 py-1.5 sm:py-1.5 text-[11px] sm:text-xs font-medium transition-colors min-w-[54px] sm:min-w-[64px]',
                period === p
                  ? 'bg-primary text-white'
                  : 'bg-surface text-text-secondary hover:bg-surfaceMuted',
              )}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {/* Store filter — independent from global */}
      <div className="flex items-center gap-2">
        <Store size={14} className="text-text-muted shrink-0" />
        <select
          value={localStore}
          onChange={e => setLocalStore(e.target.value)}
          className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/30 min-w-[140px]"
        >
          <option value="All">כל החנויות</option>
          {stores.map(s => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <span className="text-[10px] sm:text-xs text-text-muted tabular-nums sm:mr-auto">
        {buckets.length} {period === 'day' ? 'ימים' : 'תקופות'}
      </span>
    </div>
  );

  return (
    <div>
      {toolbar}

      {error && (
        <div className="m-4 rounded-lg bg-roas-redBg border border-roas-red/30 p-3 flex items-start gap-2 text-sm">
          <AlertCircle className="text-roas-red shrink-0" size={18} />
          <div>
            <div className="font-semibold text-roas-red">שגיאה בטעינת המוצרים</div>
            <div className="text-text-secondary text-xs mt-1">{(error as Error).message}</div>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="p-8 text-center text-text-muted text-sm">טוען נתוני מוצרים…</div>
      )}

      {data && !error && buckets.length === 0 && (
        <div className="p-8 text-center text-text-muted text-sm">
          <Calendar className="mx-auto mb-2 text-text-muted/60" size={28} />
          <div>אין מוצרים שנמכרו בטווח הזה.</div>
          <div className="text-[11px] mt-1">נסה לבחור טווח תאריכים רחב יותר בסינון למעלה.</div>
        </div>
      )}

      {data && buckets.length > 0 && (
        <div className="divide-y divide-border">
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
                  isLive && 'bg-gradient-to-r from-roas-greenBg/30 to-transparent',
                )}
              >
                {/* Bucket header */}
                <div className="px-4 sm:px-5 py-3 flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    {isLive && (
                      <span className="relative inline-flex h-2.5 w-2.5 shrink-0">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-roas-green opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-roas-green"></span>
                      </span>
                    )}
                    <span className="font-semibold text-text-primary truncate">
                      {bucket.label}
                    </span>
                    {isLive && (
                      <span
                        className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-bold text-roas-green bg-roas-greenBg/80 px-1.5 py-0.5 rounded"
                        title="עד לרגע זה - יתעדכן עוד עד חצות"
                      >
                        <Radio size={11} /> חי · {nowLabel}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 sm:gap-5 text-xs sm:text-sm tabular-nums">
                    <div>
                      <span className="text-text-muted text-[10px] sm:text-xs ml-1">יחידות</span>
                      <span className="font-semibold text-text-primary">
                        {formatNumber(bucket.totalUnits, 0)}
                      </span>
                    </div>
                    <div>
                      <span className="text-text-muted text-[10px] sm:text-xs ml-1">הכנסה</span>
                      <span className="font-semibold text-text-primary">
                        CAD {formatCurrency(bucket.totalRevenue)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Live bucket empty state — explain that data is on the way */}
                {isLive && isEmpty && (
                  <div className="px-4 sm:px-5 py-4 text-center text-xs sm:text-sm text-text-secondary border-t border-roas-green/20 bg-roas-greenBg/20">
                    עוד לא נמכרו מוצרים היום. הסקריפט החי מרענן את הטאב כל 15 דקות —
                    שורה זו תמשיך להתעדכן עד חצות.
                  </div>
                )}

                {/* Products list */}
                {!isEmpty && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs sm:text-sm">
                      <thead>
                        <tr className="text-text-secondary border-y border-border bg-surfaceMuted/40">
                          <th className="px-4 sm:px-5 py-2 text-start font-medium">מוצר</th>
                          <th className="px-3 py-2 text-end font-medium w-[80px] sm:w-[110px]">
                            יחידות
                          </th>
                          <th className="px-3 py-2 text-end font-medium w-[100px] sm:w-[140px]">
                            הכנסה
                          </th>
                          <th className="px-3 sm:px-5 py-2 text-end font-medium w-[55px] sm:w-[70px] hidden md:table-cell">
                            % יחידות
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((p, i) => {
                          const pct = bucket.totalUnits > 0 ? p.units / bucket.totalUnits : 0;
                          return (
                            <tr
                              key={`${bucket.key}-${p.productId}-${i}`}
                              className="border-b border-border/60 hover:bg-surfaceMuted/40"
                            >
                              <td className="px-4 sm:px-5 py-2 text-text-primary">
                                <div className="flex items-center gap-2">
                                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-surfaceMuted text-[10px] font-bold text-text-secondary tabular-nums shrink-0">
                                    {i + 1}
                                  </span>
                                  <span className="truncate">{p.productTitle}</span>
                                </div>
                              </td>
                              <td className="px-3 py-2 text-end font-semibold tabular-nums">
                                {formatNumber(p.units, 0)}
                              </td>
                              <td className="px-3 py-2 text-end tabular-nums">
                                {formatCurrency(p.revenue)}
                              </td>
                              <td className="px-3 sm:px-5 py-2 text-end tabular-nums text-text-muted hidden md:table-cell">
                                {(pct * 100).toFixed(1)}%
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Show more / show less */}
                {shouldCollapse && (
                  <div className="px-4 sm:px-5 py-2 bg-surfaceMuted/30 border-t border-border/60">
                    <button
                      onClick={() => toggle(bucket.key)}
                      className="text-xs sm:text-sm text-primary hover:text-primary-dark font-medium inline-flex items-center gap-1.5 transition-colors"
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
                    </button>
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
