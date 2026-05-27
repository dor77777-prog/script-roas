'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { Radio, TrendingUp, DollarSign, ShoppingCart, Target, Eye, ShoppingBag } from 'lucide-react';
import { cn, formatCurrency, formatNumber } from '@/lib/utils';
import { aggregate, aggregateByStore, roasLabel } from '@/lib/analytics';
import { storeHasTikTok } from '@/lib/platformsByStore';
import type { DailyRow, DashboardData } from '@/lib/types';
import type { OrdersAttributionResponse } from '@/app/api/orders-attribution/route';

const ordersFetcher = async (url: string): Promise<OrdersAttributionResponse> => {
  const r = await fetch(url);
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body?.error || `HTTP ${r.status}`);
  }
  return r.json() as Promise<OrdersAttributionResponse>;
};

// Operator-reported fix 2026-05-23 — TodayLive must show real-time data
// for TODAY regardless of the parent's filtered range. Pre-fix the widget
// re-used the parent's `rows` prop which was already filtered by
// filters.range; selecting "last month" (no overlap with today) zeroed
// out every live card. Fetching today-to-today here keeps the live
// widget decoupled from the operator's historical-window choice.
const dataFetcher = async (url: string): Promise<DashboardData> => {
  const r = await fetch(url);
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body?.error || `HTTP ${r.status}`);
  }
  return r.json() as Promise<DashboardData>;
};

const TONE_BG: Record<string, string> = {
  red:    'bg-roas-redBg text-roas-red',
  orange: 'bg-roas-orangeBg text-roas-orange',
  green:  'bg-roas-greenBg text-roas-green',
  blue:   'bg-roas-blueBg text-roas-blue',
  gray:   'bg-surfaceMuted text-text-muted',
};

/**
 * Phase 05.7.x — live ROAS band → backdrop styling for the TodayLive
 * section. The hero card on the home page used to wear a fixed green
 * tint regardless of whether the day was actually profitable; the
 * operator's complaint was that the green became visual noise once you
 * knew it was always green.
 *
 * P1-1 fix (data-consistency audit 2026-05-27): band thresholds are now
 * sourced exclusively from `roasLabel` in analytics.ts (SSOT). The
 * previous inline thresholds (orange 2.0–2.5 / green 2.5–3.0) diverged
 * from roasLabel (orange 2.0–2.7 / green 2.7–3.0), causing ROAS=2.6 to
 * show green here while the campaigns table and ROAS chip showed orange.
 *
 *   roasLabel bands (authoritative):
 *   - red:    < 2.0   (losing money)
 *   - orange: 2.0–2.7 (borderline)
 *   - green:  2.7–3.0 (healthy)
 *   - blue:   > 3.0   (excellent)
 *   - gray:   no spend/value at all
 *
 * Returned tokens drive the gradient, border, glow blob, accent pulse,
 * and "LIVE" pill so the entire hero card moves together by band rather
 * than mixing colours.
 */
type LiveTone = {
  /** Tailwind classes for the outer card: gradient + border. */
  cardBg: string;
  cardBorder: string;
  /** Decorative blur blob in the corner. */
  blob: string;
  /** Animated pulse dot to the left of the title. */
  pulse: string;
  /** "LIVE" pill colour. */
  pill: string;
  /** Radio icon tint. */
  iconColor: string;
};

/** Styling tokens keyed by the tone name from roasLabel. */
const LIVE_TONE_STYLES: Record<string, LiveTone> = {
  gray: {
    cardBg: 'bg-gradient-to-br from-surfaceMuted/60 via-surface to-surface',
    cardBorder: 'border-borderSubtle',
    blob: 'bg-text-muted/10',
    pulse: 'bg-text-muted',
    pill: 'bg-text-muted text-white',
    iconColor: 'text-text-muted',
  },
  red: {
    cardBg: 'bg-gradient-to-br from-roas-redBg/60 via-surface to-surface',
    cardBorder: 'border-roas-red/35',
    blob: 'bg-roas-red/12',
    pulse: 'bg-roas-red',
    pill: 'bg-roas-red text-white',
    iconColor: 'text-roas-red',
  },
  orange: {
    cardBg: 'bg-gradient-to-br from-roas-orangeBg/60 via-surface to-surface',
    cardBorder: 'border-roas-orange/35',
    blob: 'bg-roas-orange/12',
    pulse: 'bg-roas-orange',
    pill: 'bg-roas-orange text-white',
    iconColor: 'text-roas-orange',
  },
  green: {
    cardBg: 'bg-gradient-to-br from-roas-greenBg/50 via-surface to-surface',
    cardBorder: 'border-roas-green/30',
    blob: 'bg-roas-green/10',
    pulse: 'bg-roas-green',
    pill: 'bg-roas-green text-white',
    iconColor: 'text-roas-green',
  },
  blue: {
    cardBg: 'bg-gradient-to-br from-roas-blueBg/55 via-surface to-surface',
    cardBorder: 'border-roas-blue/30',
    blob: 'bg-roas-blue/12',
    pulse: 'bg-roas-blue',
    pill: 'bg-roas-blue text-white',
    iconColor: 'text-roas-blue',
  },
};

/**
 * P1-1 (2026-05-27): delegates band selection to `roasLabel` (SSOT in
 * analytics.ts) instead of maintaining local thresholds. Previously the
 * local thresholds (2.5) differed from roasLabel (2.7), making ROAS=2.6
 * appear green on this card while showing orange everywhere else.
 */
function liveToneFromRoas(roas: number, hasAnyData: boolean): LiveTone {
  if (!hasAnyData || roas <= 0) return LIVE_TONE_STYLES.gray;
  const tone = roasLabel(roas).tone;
  return LIVE_TONE_STYLES[tone] ?? LIVE_TONE_STYLES.gray;
}

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
  rows: _parentRows,
  fxIlsToCad,
}: {
  /**
   * Parent dashboard's row set. Kept in the prop signature for back-compat
   * with existing call sites but UNUSED inside the component as of the
   * 2026-05-23 operator-reported fix: TodayLive must always show real-
   * time today data regardless of the operator's date-range selection.
   * Pre-fix the widget filtered these rows to `r.date === today` — but
   * `_parentRows` is already narrowed to filters.range by the parent, so
   * picking "last month" / any historical window emptied the live widget.
   *
   * The component now fetches its own today-to-today /api/data slice via
   * useSWR below, so live cards are decoupled from the parent's
   * historical-window choice.
   */
  rows: DailyRow[];
  fxIlsToCad: number | null;
}) {
  // Mark _parentRows as intentionally unused so the lint pass doesn't
  // flag it; we keep the prop in the type so existing call sites compile
  // without churn during the audit-v2 wave.
  void _parentRows;
  const [now, setNow] = useState(nowInIsrael());
  useEffect(() => {
    const t = setInterval(() => setNow(nowInIsrael()), 30_000);
    return () => clearInterval(t);
  }, []);

  const today = todayInIsrael();

  // Operator-reported fix 2026-05-23: own SWR fetch for today-to-today so
  // the live widget is independent of the parent's range filter. Mirrors
  // the parent Dashboard's /api/data fetcher (60s refreshInterval matches
  // the other live data calls below). Returns a DashboardData; we slice
  // its rows to today inside the memo (defensive — the server should
  // already narrow but a wider response doesn't break this view).
  const { data: liveDataResp } = useSWR<DashboardData>(
    `/api/data?from=${today}&to=${today}`,
    dataFetcher,
    { refreshInterval: 60_000, revalidateOnFocus: true },
  );
  const todayRows = useMemo(() => {
    const rs = liveDataResp?.rows ?? [];
    return rs.filter(r => r.date === today);
  }, [liveDataResp, today]);
  const agg = aggregate(todayRows);
  const storeAggs = aggregateByStore(todayRows);
  const roas = roasLabel(agg.roas);
  const hasAnyData = agg.revenue > 0 || agg.spend > 0;

  // Phase 13.8 (2026-05-26) — CPM now sources impressions directly from
  // data_daily (via the liveDataResp fetch above) instead of campaigns_daily.
  // cron-live writes per-platform impressions to data_daily.fb/ga/tt_impressions
  // on every ~10-min tick using the same light fetcher that already supplied
  // spend — so today's CPM updates in real time. The campaigns_daily-backed
  // computation that lived here previously could only ever show 0 because
  // cron-live writes enrollment placeholder rows to campaigns_daily without
  // metric data; impressions only landed in campaigns_daily after the
  // overnight cron-daily run.

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

  // Aggregate impressions + spend overall, per store, AND per (store, platform)
  // from today's data_daily rows. Per-store is keyed by storeName so it joins
  // cleanly with the existing storeAggs from analytics. Per-(store, platform)
  // lets each live card show CPM broken down by Meta / Google / TikTok
  // separately — operator request 2026-05-23, "ה-CPM ייהיה מחולק לכל
  // פלטפורמה בכל חנות".
  //
  // Phase 13.8 (2026-05-26): data_daily rows now carry fb/ga/tt_impressions
  // alongside fb/ga/tt_spend, so the per-platform CPM has a real basis
  // every ~10 min. Historical rows that pre-date the migration have null
  // impressions — coerced to 0 here; the renderer treats 0 as "no data yet"
  // and shows "—".
  type PlatformBucket = { meta: number; google: number; tiktok: number };
  const cpmData = useMemo(() => {
    let totalSpend = 0;
    let totalImpressions = 0;
    const byStore = new Map<string, { spend: number; impressions: number }>();
    const spendByStoreByPlatform = new Map<string, PlatformBucket>();
    const impressionsByStoreByPlatform = new Map<string, PlatformBucket>();
    for (const r of todayRows) {
      const sn = r.storeName;
      const fbImp = r.fbImpressions ?? 0;
      const gaImp = r.gaImpressions ?? 0;
      const ttImp = r.ttImpressions ?? 0;
      const storeImp = fbImp + gaImp + ttImp;
      const storeSpend = r.fbSpend + r.gaSpend + r.ttSpend;
      totalSpend += storeSpend;
      totalImpressions += storeImp;
      if (!byStore.has(sn)) byStore.set(sn, { spend: 0, impressions: 0 });
      const s = byStore.get(sn)!;
      s.spend += storeSpend;
      s.impressions += storeImp;
      if (!spendByStoreByPlatform.has(sn)) {
        spendByStoreByPlatform.set(sn, { meta: 0, google: 0, tiktok: 0 });
        impressionsByStoreByPlatform.set(sn, { meta: 0, google: 0, tiktok: 0 });
      }
      const ps = spendByStoreByPlatform.get(sn)!;
      const pi = impressionsByStoreByPlatform.get(sn)!;
      ps.meta += r.fbSpend;
      ps.google += r.gaSpend;
      ps.tiktok += r.ttSpend;
      pi.meta += fbImp;
      pi.google += gaImp;
      pi.tiktok += ttImp;
    }
    const cpmByStore = new Map<string, number>();
    for (const [store, v] of byStore) {
      cpmByStore.set(store, v.impressions > 0 ? (v.spend / v.impressions) * 1000 : 0);
    }
    // Per-(store, platform) CPM: 0 when impressions===0 so the renderer
    // can disambiguate "no impressions yet today" from a real CPM of 0.
    const cpmByStoreByPlatform = new Map<string, PlatformBucket>();
    for (const [store, spends] of spendByStoreByPlatform) {
      const imps = impressionsByStoreByPlatform.get(store)!;
      cpmByStoreByPlatform.set(store, {
        meta:   imps.meta   > 0 ? (spends.meta   / imps.meta)   * 1000 : 0,
        google: imps.google > 0 ? (spends.google / imps.google) * 1000 : 0,
        tiktok: imps.tiktok > 0 ? (spends.tiktok / imps.tiktok) * 1000 : 0,
      });
    }
    return {
      cpm: totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0,
      impressions: totalImpressions,
      cpmByStore,
      cpmByStoreByPlatform,
    };
  }, [todayRows]);

  // Phase 05.7.x — live ROAS-driven hero tint. Replaces the fixed green
  // gradient that used to wear the same colour regardless of whether the
  // day was profitable. Single source of truth: `liveToneFromRoas` —
  // matches the same red/orange/green/blue thresholds the per-row ROAS
  // chip uses elsewhere in the dashboard.
  const liveTone = liveToneFromRoas(agg.roas, hasAnyData);

  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-2xl border transition-colors duration-500',
        liveTone.cardBg,
        liveTone.cardBorder,
        'shadow-card animate-fade-in',
      )}
    >
      {/* Decorative corner blob — tinted to match the current ROAS band so
          the visual mood of the card moves together with the headline
          number. In RTL we want it on the start (right) side; using
          `start-0` keeps it RTL-aware. */}
      <div
        aria-hidden
        className={cn(
          'absolute top-0 start-0 w-48 h-48 -translate-x-1/4 -translate-y-1/4',
          'rounded-full blur-3xl pointer-events-none transition-colors duration-500',
          liveTone.blob,
        )}
      />

      <div className="relative p-4 sm:p-6">
        {/* Header */}
        <header className="flex items-center justify-between gap-3 mb-4 sm:mb-5">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className={cn('animate-ping absolute inline-flex h-full w-full rounded-full opacity-75', liveTone.pulse)} />
              <span className={cn('relative inline-flex rounded-full h-2.5 w-2.5', liveTone.pulse)} />
            </span>
            <h2 className="flex items-center gap-2 text-sm sm:text-base font-semibold text-text-primary truncate">
              <Radio size={16} className={cn('shrink-0 transition-colors duration-500', liveTone.iconColor)} />
              היום — חי
            </h2>
            <span className={cn('hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded shrink-0 transition-colors duration-500', liveTone.pill)}>
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
            // Audit fix 2026-05-23 (FIND-05 dashboard-fidelity): distinguish
            // "still loading" from "zero orders so far". Both used to render
            // "—" so the operator couldn't tell whether to wait or to act.
            // "…" universally signals in-progress.
            value={ordersToday === undefined ? '…' : formatNumber(totalOrdersToday, 0)}
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
              // Phase 05.7.x — TikTok is rendered for every store that
              // has the integration wired (currently uzoshop only), even
              // when ttSpend = 0 — same convention as Google above. This
              // way the operator can tell at a glance "yes, TikTok is
              // configured here, today just hasn't spent yet" vs "this
              // store doesn't have TikTok at all".
              const hasTikTok = storeHasTikTok(s.store);
              const storeCpm = cpmData.cpmByStore.get(s.store) ?? 0;
              // Per-platform CPM breakdown for this store (operator request
              // 2026-05-23): "ה-CPM יהיה מחולק לכל פלטפורמה בכל חנות ואז
              // יהיה גם cpm ממוצע". Defaults to zero buckets when the
              // store has no campaign rows yet today.
              const storeCpmByPlatform = cpmData.cpmByStoreByPlatform.get(s.store)
                ?? { meta: 0, google: 0, tiktok: 0 };
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
                          <span>TikTok: <span className="text-text-secondary tabular-nums">{(s.ttSpend ?? 0) > 0 ? formatCurrency(s.ttSpend ?? 0) : '—'}</span></span>
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
                        {/* Audit fix 2026-05-23 (FIND-05): "…" for loading,
                            "0" for genuine zero orders. */}
                        {ordersToday === undefined ? '…' : formatNumber(storeOrders ?? 0, 0)}
                      </span>
                    </div>
                    {/* CPM block: row 1 shows the cross-platform average
                        for the store (same field as before, label clarified
                        to "ממוצע"). Row 2 is an indented per-platform
                        breakdown mirroring the "סך הוצאה" pattern so the
                        operator can spot a single misbehaving platform's
                        CPM without leaving the live card. Operator request
                        2026-05-23. */}
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-text-muted">CPM ממוצע</span>
                      <span className="text-text-primary font-semibold">
                        {storeCpm > 0 ? `CAD ${formatCurrency(storeCpm, 2)}` : '—'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 ps-3 text-[11px] text-text-muted flex-wrap">
                      <span>
                        Meta: <span className="text-text-secondary tabular-nums">
                          {storeCpmByPlatform.meta > 0 ? formatCurrency(storeCpmByPlatform.meta, 2) : '—'}
                        </span>
                      </span>
                      <span>·</span>
                      <span>
                        Google: <span className="text-text-secondary tabular-nums">
                          {hasGoogle && storeCpmByPlatform.google > 0 ? formatCurrency(storeCpmByPlatform.google, 2) : '—'}
                        </span>
                      </span>
                      {hasTikTok && (
                        <>
                          <span>·</span>
                          <span>
                            TikTok: <span className="text-text-secondary tabular-nums">
                              {storeCpmByPlatform.tiktok > 0 ? formatCurrency(storeCpmByPlatform.tiktok, 2) : '—'}
                            </span>
                          </span>
                        </>
                      )}
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

function _Mini({
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
