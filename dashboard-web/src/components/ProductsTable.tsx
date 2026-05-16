'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { Package, ChevronDown, ChevronUp, AlertCircle, Calendar } from 'lucide-react';
import { cn, formatCurrency, formatDate, formatNumber } from '@/lib/utils';
import type { ProductRow } from '@/lib/products';
import type { ProductsResponse } from '@/app/api/products/route';

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
  // ISO 8601 week: nearest Thursday is in the right year
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
    return `שבוע ${parseInt(w, 10)} / ${year}`;
  }
  if (period === 'month') {
    const [y, m] = key.split('-');
    const months = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
                    'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
    return `${months[parseInt(m, 10) - 1]} ${y}`;
  }
  if (period === 'half_year') {
    const [y, h] = key.split('-H');
    return `${h === '1' ? 'מחצית 1' : 'מחצית 2'} / ${y}`;
  }
  return key; // year
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
};

function aggregate(rows: ProductRow[], period: Period, store: string): BucketAgg[] {
  const filtered = store === 'All' ? rows : rows.filter(r => r.storeName === store);
  // bucket -> productKey -> agg
  const buckets = new Map<string, Map<string, ProductAgg & { dateSet: Set<string> }>>();

  for (const r of filtered) {
    const bk = bucketKey(r.date, period);
    if (!buckets.has(bk)) buckets.set(bk, new Map());
    const productMap = buckets.get(bk)!;
    // Group by product within bucket — but if "All" stores, also keep them
    // separate per store (otherwise zol's "shirt" and uzo's "shirt" merge weirdly).
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
    const products = Array.from(productMap.values()).map(p => ({
      productId: p.productId,
      productTitle: p.productTitle,
      units: p.units,
      revenue: p.revenue,
      days: p.dateSet.size,
    })).sort((a, b) => b.units - a.units);
    const totalUnits = products.reduce((s, p) => s + p.units, 0);
    const totalRevenue = products.reduce((s, p) => s + p.revenue, 0);
    out.push({ key, label: bucketLabel(key, period), totalUnits, totalRevenue, products });
  }
  return out.sort((a, b) => b.key.localeCompare(a.key));
}

// --- component --------------------------------------------------------------

export function ProductsTable({ stores }: { stores: string[] }) {
  const { data, error, isLoading } = useSWR<ProductsResponse>('/api/products', fetcher, {
    refreshInterval: 120_000,
    revalidateOnFocus: false,
  });

  const [period, setPeriod] = useState<Period>('day');
  const [store, setStore] = useState<string>('All');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const buckets = useMemo(() => {
    if (!data) return [];
    return aggregate(data.rows, period, store);
  }, [data, period, store]);

  // Auto-expand the most recent bucket so the user immediately sees something
  // without having to click. Done in a useMemo derivation rather than effect
  // to avoid double-render flicker.
  const effectiveExpanded = useMemo(() => {
    if (expanded.size > 0 || buckets.length === 0) return expanded;
    return new Set([buckets[0].key]);
  }, [expanded, buckets]);

  function toggle(key: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <section className="rounded-xl bg-surface border border-border shadow-card overflow-hidden">
      <header className="px-4 sm:px-5 py-3 sm:py-4 border-b border-border flex flex-wrap items-center gap-2 sm:gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-text-primary mr-auto">
          <Package size={18} className="text-text-secondary" />
          מוצרים שנמכרו
        </h2>

        {/* Store filter */}
        <select
          value={store}
          onChange={e => { setStore(e.target.value); setExpanded(new Set()); }}
          className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <option value="All">כל החנויות</option>
          {stores.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        {/* Period selector */}
        <div className="flex rounded-lg border border-border overflow-hidden">
          {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
            <button
              key={p}
              onClick={() => { setPeriod(p); setExpanded(new Set()); }}
              className={cn(
                'px-2 sm:px-3 py-1.5 text-[11px] sm:text-xs transition-colors',
                period === p
                  ? 'bg-primary text-white font-semibold'
                  : 'bg-surface hover:bg-surfaceMuted text-text-secondary',
              )}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </header>

      {error && (
        <div className="m-4 rounded-lg bg-roas-redBg border border-roas-red/30 p-3 flex items-start gap-2 text-sm">
          <AlertCircle className="text-roas-red shrink-0" size={18} />
          <div>
            <div className="font-semibold text-roas-red">שגיאה</div>
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
          אין נתוני מוצרים עדיין. הטאב <code className="text-xs bg-surfaceMuted px-1.5 py-0.5 rounded">products-daily</code> מתאכלס אוטומטית בריצה היומית/חיה הבאה.
        </div>
      )}

      {data && buckets.length > 0 && (
        <div className="divide-y divide-border">
          {buckets.map(bucket => {
            const open = effectiveExpanded.has(bucket.key);
            return (
              <div key={bucket.key}>
                <button
                  onClick={() => toggle(bucket.key)}
                  className="w-full px-4 sm:px-5 py-3 flex items-center justify-between gap-3 hover:bg-surfaceMuted/60 transition-colors"
                >
                  <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                    {open ? <ChevronUp size={16} className="text-text-muted shrink-0" /> : <ChevronDown size={16} className="text-text-muted shrink-0" />}
                    <span className="font-semibold text-text-primary truncate">{bucket.label}</span>
                  </div>
                  <div className="flex items-center gap-3 sm:gap-5 text-xs sm:text-sm tabular-nums shrink-0">
                    <div className="text-text-secondary">
                      <span className="text-text-muted text-[10px] sm:text-xs ml-1">יח׳:</span>
                      <span className="font-semibold">{formatNumber(bucket.totalUnits, 0)}</span>
                    </div>
                    <div className="text-text-secondary">
                      <span className="text-text-muted text-[10px] sm:text-xs ml-1">הכנסה:</span>
                      <span className="font-semibold">CAD {formatCurrency(bucket.totalRevenue)}</span>
                    </div>
                    <div className="text-text-muted text-[10px] sm:text-xs hidden sm:block">
                      {bucket.products.length} מוצרים
                    </div>
                  </div>
                </button>
                {open && (
                  <div className="bg-surfaceMuted/40 overflow-x-auto">
                    <table className="w-full text-xs sm:text-sm">
                      <thead>
                        <tr className="text-text-secondary border-b border-border">
                          <th className="px-3 sm:px-5 py-2 text-start font-medium">מוצר</th>
                          <th className="px-3 py-2 text-end font-medium">יח׳ נמכרו</th>
                          <th className="px-3 py-2 text-end font-medium">הכנסה (CAD)</th>
                          {period !== 'day' && (
                            <th className="px-3 py-2 text-end font-medium hidden sm:table-cell">ימים פעילים</th>
                          )}
                          <th className="px-3 sm:px-5 py-2 text-end font-medium hidden md:table-cell">% מהיח׳</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bucket.products.map((p, i) => {
                          const pct = bucket.totalUnits > 0 ? p.units / bucket.totalUnits : 0;
                          return (
                            <tr key={`${bucket.key}-${p.productId}-${i}`} className="border-b border-border/60">
                              <td className="px-3 sm:px-5 py-2 text-text-primary">
                                <span className="block truncate max-w-[260px] sm:max-w-[420px]">{p.productTitle}</span>
                              </td>
                              <td className="px-3 py-2 text-end font-semibold tabular-nums">{formatNumber(p.units, 0)}</td>
                              <td className="px-3 py-2 text-end tabular-nums">{formatCurrency(p.revenue)}</td>
                              {period !== 'day' && (
                                <td className="px-3 py-2 text-end tabular-nums text-text-secondary hidden sm:table-cell">{p.days}</td>
                              )}
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
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
