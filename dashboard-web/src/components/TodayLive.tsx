'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { Radio, TrendingUp, DollarSign, ShoppingCart, Target, Eye, ShoppingBag } from 'lucide-react';
import { cn, formatCurrency, formatNumber } from '@/lib/utils';
import { aggregate, aggregateByStore, roasLabel } from '@/lib/analytics';
import type { DailyRow } from '@/lib/types';
import type { CampaignsResponse } from '@/app/api/campaigns/route';
import type { OrdersAttributionResponse } from '@/app/api/orders-attribution/route';

const campaignsFetcher = async (url: string): Promise<CampaignsResponse> => {
  const r = await fetch(url);
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body?.error || `HTTP ${r.status}`);
  }
  return r.json() as Promise<CampaignsResponse>;
};

const ordersFetcher = async (url: string): Promise<OrdersAttributionResponse> => {
  const r = await fetch(url);
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body?.error || `HTTP ${r.status}`);
  }
  return r.json() as Promise<OrdersAttributionResponse>;
};

const TONE_BG: Record<string, string> = {
  red:    'bg-roas-redBg text-roas-red',
  orange: 'bg-roas-orangeBg text-roas-orange',
  green:  'bg-roas-greenBg text-roas-green',
  blue:   'bg-roas-blueBg text-roas-blue',
  gray:   'bg-surfaceMuted text-text-muted',
};

// Per-store accent dot. Kept saturated since it's a tiny element.
const STORE_COLORS: Record<string, string> = {
  uzoshop:     '#1e3a8a',
  'Zol Plus':  '#dc2626',
  '360usmile': '#15803d',
};

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

export function TodayLive({
  rows,
  fxIlsToCad,
}: {
  rows: DailyRow[];
  fxIlsToCad: number | null;
}) {
  const [now, setNow] = useState(nowInIsrael());
  useEffect(() => {
    const t = setInterval(() => setNow(nowInIsrael()), 30_000);
    return () => clearInterval(t);
  }, []);

  const today = todayInIsrael();
  const todayRows = rows.filter(r => r.date === today);
  const agg = aggregate(todayRows);
  const storeAggs = aggregateByStore(todayRows);
  const roas = roasLabel(agg.roas);
  const hasAnyData = agg.revenue > 0 || agg.spend > 0;

  // Fetch today's campaign rows to compute CPM (data-daily doesn't carry
  // impressions). Range key is today-to-today so SWR caches a single
  // narrow response; navigating to the Campaigns tab triggers a separate
  // wider-range fetch — both coexist.
  const { data: campaignsToday } = useSWR<CampaignsResponse>(
    `/api/campaigns?from=${today}&to=${today}`,
    campaignsFetcher,
    { refreshInterval: 60_000, revalidateOnFocus: false },
  );

  // Phase 05.7.8 — fetch today's orders so each live store card can show
  // "X הזמנות עד עכשיו". cron-live now refreshes orders_attribution for
  // today on every tick (10 min), so this number is at most 10 min stale.
  const { data: ordersToday } = useSWR<OrdersAttributionResponse>(
    `/api/orders-attribution?from=${today}&to=${today}`,
    ordersFetcher,
    { refreshInterval: 60_000, revalidateOnFocus: false },
  );

  const ordersByStoreToday = useMemo<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    const rows = ordersToday?.rows ?? [];
    for (const r of rows) {
      if (r.date !== today) continue;
      const sn = r.storeName;
      if (!sn) continue;
      out[sn] = (out[sn] ?? 0) + 1;
    }
    return out;
  }, [ordersToday, today]);

  const totalOrdersToday = useMemo(() => {
    return Object.values(ordersByStoreToday).reduce((a, b) => a + b, 0);
  }, [ordersByStoreToday]);

  // Aggregate impressions + spend overall and per store from today's
  // campaign rows. Per-store is keyed by storeName so it joins cleanly
  // with the existing storeAggs from analytics.
  const cpmData = useMemo(() => {
    const rows = campaignsToday?.rows ?? [];
    let totalSpend = 0;
    let totalImpressions = 0;
    const byStore = new Map<string, { spend: number; impressions: number }>();
    for (const r of rows) {
      if (r.date !== today) continue;
      totalSpend += r.spend;
      totalImpressions += r.impressions;
      const key = r.storeName;
      if (!byStore.has(key)) byStore.set(key, { spend: 0, impressions: 0 });
      const s = byStore.get(key)!;
      s.spend += r.spend;
      s.impressions += r.impressions;
    }
    const cpmByStore = new Map<string, number>();
    for (const [store, v] of byStore) {
      cpmByStore.set(store, v.impressions > 0 ? (v.spend / v.impressions) * 1000 : 0);
    }
    return {
      cpm: totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0,
      impressions: totalImpressions,
      cpmByStore,
    };
  }, [campaignsToday, today]);

  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-2xl border border-roas-green/30',
        'bg-gradient-to-br from-roas-greenBg/50 via-surface to-surface',
        'shadow-card animate-fade-in',
      )}
    >
      {/* Decorative top-right pulse (very subtle). */}
      <div
        aria-hidden
        className="absolute top-0 left-0 w-48 h-48 -translate-x-1/4 -translate-y-1/4 rounded-full bg-roas-green/10 blur-3xl pointer-events-none"
      />

      <div className="relative p-4 sm:p-6">
        {/* Header */}
        <header className="flex items-center justify-between gap-3 mb-4 sm:mb-5">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-roas-green opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-roas-green" />
            </span>
            <h2 className="flex items-center gap-2 text-sm sm:text-base font-semibold text-text-primary truncate">
              <Radio size={16} className="text-roas-green shrink-0" />
              היום — חי
            </h2>
            <span className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded bg-roas-green text-white shrink-0">
              LIVE
            </span>
          </div>
          <div className="text-[10px] sm:text-xs text-text-secondary text-left tabular-nums shrink-0">
            <div className="font-medium">{today}</div>
            <div className="text-text-muted">עודכן {now}</div>
          </div>
        </header>

        {/* Stats grid */}
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-2.5 sm:gap-3">
          <LiveStat
            icon={<Target size={13} />}
            label="ROAS עד עכשיו"
            value={hasAnyData ? formatNumber(agg.roas) : '—'}
            badge={hasAnyData ? roas.text : 'אין נתונים'}
            badgeClass={TONE_BG[roas.tone]}
          />
          <LiveStat
            icon={<DollarSign size={13} />}
            label="הכנסות (היום)"
            value={formatCurrency(agg.revenue)}
            valuePrefix="CAD"
          />
          <LiveStat
            icon={<ShoppingCart size={13} />}
            label="הוצאות (היום)"
            value={formatCurrency(agg.spend)}
            valuePrefix="CAD"
          />
          <LiveStat
            icon={<TrendingUp size={13} />}
            label="רווח גולמי (היום)"
            value={formatCurrency(agg.grossProfit)}
            valuePrefix="CAD"
            accent={agg.grossProfit >= 0 ? 'pos' : 'neg'}
          />
          <LiveStat
            icon={<ShoppingBag size={13} />}
            label="הזמנות (היום)"
            value={ordersToday === undefined ? '—' : formatNumber(totalOrdersToday, 0)}
          />
          <LiveStat
            icon={<Eye size={13} />}
            label="CPM (היום)"
            value={cpmData.impressions > 0 ? formatCurrency(cpmData.cpm, 2) : '—'}
            valuePrefix={cpmData.impressions > 0 ? 'CAD' : undefined}
          />
        </div>

        {/* Per-store breakdown */}
        {storeAggs.length > 0 && hasAnyData && (
          <div className="mt-3 sm:mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
            {storeAggs.map(s => {
              const color = STORE_COLORS[s.store] || '#0d3680';
              const info = roasLabel(s.roas);
              const hasGoogle = s.gaSpend > 0;
              const hasTikTok = (s.ttSpend ?? 0) > 0;
              const storeCpm = cpmData.cpmByStore.get(s.store) ?? 0;
              const storeOrders = ordersByStoreToday[s.store];
              return (
                <div
                  key={s.store}
                  className="rounded-xl bg-surface/90 backdrop-blur-sm border border-borderSubtle p-3 shadow-xs"
                >
                  {/* Header: store name + larger ROAS chip — keeps ROAS the
                      headline metric of the card. Chip text bumped from
                      10px to 12px so it carries more visual weight. */}
                  <div className="flex items-center justify-between gap-2 mb-2.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="inline-block w-2 h-2 rounded-full shrink-0"
                        style={{ background: color }}
                      />
                      <span className="text-xs sm:text-sm font-semibold text-text-primary truncate">
                        {s.store}
                      </span>
                    </div>
                    <span
                      className={cn(
                        'px-2 py-0.5 text-xs sm:text-sm font-bold rounded tabular-nums shrink-0',
                        TONE_BG[info.tone],
                      )}
                    >
                      {s.roas > 0 ? formatNumber(s.roas) : '—'}
                    </span>
                  </div>
                  {/* Three full-width rows — spend (with FB/Google breakdown
                      inline), revenue (emphasized in green), CPM. Layout
                      mirrors the user's mental model: cost in, revenue out,
                      cost-per-reach. */}
                  <div className="space-y-1.5 text-xs tabular-nums">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-text-muted">סך הוצאה</span>
                      <span className="text-text-primary font-semibold">
                        CAD {formatCurrency(s.spend)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 ps-3 text-[11px] text-text-muted flex-wrap">
                      <span>Meta: <span className="text-text-secondary tabular-nums">{formatCurrency(s.fbSpend)}</span></span>
                      <span>·</span>
                      <span>Google: <span className="text-text-secondary tabular-nums">{hasGoogle ? formatCurrency(s.gaSpend) : '—'}</span></span>
                      {hasTikTok && (
                        <>
                          <span>·</span>
                          <span>TikTok: <span className="text-text-secondary tabular-nums">{formatCurrency(s.ttSpend)}</span></span>
                        </>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2 rounded-md bg-roas-greenBg/40 px-2 py-1.5 mt-1.5">
                      <span className="text-roas-green/80 font-medium">הכנסה</span>
                      <span className="text-roas-green text-sm sm:text-base font-bold">
                        CAD {formatCurrency(s.revenue)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <span className="text-text-muted inline-flex items-center gap-1">
                        <ShoppingBag size={11} className="text-text-muted" />
                        הזמנות
                      </span>
                      <span className="text-text-primary font-semibold">
                        {ordersToday === undefined ? '—' : formatNumber(storeOrders ?? 0, 0)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-text-muted">CPM</span>
                      <span className="text-text-primary font-semibold">
                        {storeCpm > 0 ? `CAD ${formatCurrency(storeCpm, 2)}` : '—'}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!hasAnyData && (
          <div className="mt-3 text-center text-xs text-text-muted">
            עוד אין נתוני היום. הטריגר ה-Live ירוץ אוטומטית כל 10 דקות.
          </div>
        )}

        {/* Footer — FX + currencies */}
        <div className="mt-4 sm:mt-5 pt-3 sm:pt-4 border-t border-roas-green/15 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10px] sm:text-xs text-text-muted">
          {fxIlsToCad !== null && (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <span>שער המרה:</span>
              <span className="font-medium text-text-secondary">
                1 ILS = {fxIlsToCad.toFixed(4)} CAD
              </span>
            </span>
          )}
          <span className="text-text-subtle">·</span>
          <span>Meta: ILS</span>
          <span className="text-text-subtle">·</span>
          <span>Google: CAD</span>
          <span className="text-text-subtle">·</span>
          <span>TikTok: USD</span>
          <span className="text-text-subtle">·</span>
          <span>Shopify: CAD</span>
        </div>
        <div className="mt-1.5 text-[10px] sm:text-xs text-text-muted/80 text-center leading-relaxed">
          רענון אוטומטי כל 10 דקות. Shopify + הזמנות ב-real-time;
          Meta/Google/TikTok עם פיגור של ~20 דק' מצד הפלטפורמה.
        </div>
      </div>
    </section>
  );
}

/**
 * Length-aware sizing for the live stat values. Mirrors the helper in
 * KpiCards.tsx — kept inline here to avoid a shared utility for two callsites.
 */
function liveValueSizeClass(value: string): string {
  const len = value.length;
  if (len <= 4)  return 'text-[1.375rem] sm:text-2xl';
  if (len <= 6)  return 'text-[1.25rem] sm:text-xl';
  if (len <= 8)  return 'text-base sm:text-lg';
  return 'text-sm sm:text-base';
}

function LiveStat({
  icon,
  label,
  value,
  valuePrefix,
  badge,
  badgeClass,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valuePrefix?: string;
  badge?: string;
  badgeClass?: string;
  accent?: 'pos' | 'neg';
}) {
  return (
    <div className="rounded-xl bg-surface border border-borderSubtle p-2.5 sm:p-4 shadow-xs">
      <div className="flex items-center justify-between mb-1 sm:mb-1.5">
        <span className="text-[10px] sm:text-xs font-medium text-text-secondary tracking-wide truncate">
          {label}
        </span>
        <span className="text-text-muted/70 shrink-0">{icon}</span>
      </div>
      <div className="flex items-baseline gap-1 min-w-0">
        {valuePrefix && (
          <span className="text-[10px] sm:text-xs text-text-muted font-medium shrink-0">
            {valuePrefix}
          </span>
        )}
        <span
          className={cn(
            'font-light tabular-nums tracking-tight leading-none whitespace-nowrap',
            liveValueSizeClass(value),
            accent === 'pos' && 'text-roas-green',
            accent === 'neg' && 'text-roas-red',
            !accent && 'text-text-primary',
          )}
        >
          {value}
        </span>
      </div>
      {badge && (
        <span
          className={cn(
            'inline-block mt-1.5 px-1.5 py-0.5 text-[9px] sm:text-[10px] font-semibold rounded',
            badgeClass,
          )}
        >
          {badge}
        </span>
      )}
    </div>
  );
}

function Mini({
  label,
  value,
  muted,
  accent,
}: {
  label: string;
  value: string;
  muted?: boolean;
  accent?: 'green';
}) {
  return (
    <div className="flex items-center justify-between gap-1">
      <span className="text-text-muted">{label}</span>
      <span
        className={cn(
          'font-semibold',
          accent === 'green' && 'text-roas-green',
          !accent && !muted && 'text-text-primary',
          muted && 'text-text-secondary',
        )}
      >
        {value}
      </span>
    </div>
  );
}
