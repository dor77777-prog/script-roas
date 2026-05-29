'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { Radio, TrendingUp, DollarSign, ShoppingCart, Target, Eye, ShoppingBag } from 'lucide-react';
import { cn, formatCurrency, formatNumber } from '@/lib/utils';
import { aggregate, aggregateByStore, roasLabel } from '@/lib/analytics';
import { storeHasTikTok } from '@/lib/platformsByStore';
import type { DailyRow, DashboardData } from '@/lib/types';
import type { OrdersAttributionResponse } from '@/app/api/orders-attribution/route';
import { storeColor } from '@/lib/storeColors';
import { buildTodayNarrative } from '@/lib/todayNarrative';

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
  red:    'bg-status-redBg text-status-red',
  orange: 'bg-status-orangeBg text-status-orange',
  green:  'bg-status-greenBg text-status-green',
  blue:   'bg-status-blueBg text-status-blue',
  gray:   'bg-elevated2 text-ink-muted',
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

/** Styling tokens keyed by the tone name from roasLabel.
 *
 * Hotfix-3 2026-05-29: Switched from Tailwind slash-alpha gradient
 * (`from-status-{color}/45 via-status-{color}/12 to-elevated`) to an
 * arbitrary-value gradient using CSS `var()` directly. Reason: our
 * tailwind.config defines status tokens as `'var(--status-X)'` without
 * the `<alpha-value>` placeholder, so Tailwind 3.x can't compose slash-
 * alpha on them — `from-status-red/45` was silently dropping the alpha
 * (or failing to render entirely), which is why earlier hotfixes left
 * the gradient invisible.
 *
 * New pattern: `bg-[linear-gradient(225deg,var(--status-X-bg),var(--surface-elevated-1)_75%)]`
 * - Uses the -Bg variant directly (no alpha math needed)
 * - 225deg = top-right → bottom-left, which puts the tinted "halo" in
 *   the top-right corner where the eye lands first in RTL Hebrew layout
 * - Fades to elevated by 75% so the lower-left of the card stays neutral
 *   for content readability
 * - With hotfix-3's bumped -Bg vars (dark theme L=36-42%, chroma 0.18-0.20),
 *   the gradient is vibrant in BOTH themes */
const LIVE_TONE_STYLES: Record<string, LiveTone> = {
  gray: {
    cardBg: 'bg-[linear-gradient(225deg,var(--status-gray-bg),var(--surface-elevated-1)_75%)]',
    cardBorder: 'border-line',
    blob: 'bg-status-gray/10',
    pulse: 'bg-status-gray',
    pill: 'bg-status-gray text-white',
    iconColor: 'text-status-gray',
  },
  red: {
    cardBg: 'bg-[linear-gradient(225deg,var(--status-red-bg),var(--surface-elevated-1)_75%)]',
    cardBorder: 'border-status-red/55',
    blob: 'bg-status-red/15',
    pulse: 'bg-status-red',
    pill: 'bg-status-red text-white',
    iconColor: 'text-status-red',
  },
  orange: {
    cardBg: 'bg-[linear-gradient(225deg,var(--status-orange-bg),var(--surface-elevated-1)_75%)]',
    cardBorder: 'border-status-orange/55',
    blob: 'bg-status-orange/15',
    pulse: 'bg-status-orange',
    pill: 'bg-status-orange text-white',
    iconColor: 'text-status-orange',
  },
  green: {
    cardBg: 'bg-[linear-gradient(225deg,var(--status-green-bg),var(--surface-elevated-1)_75%)]',
    cardBorder: 'border-status-green/55',
    blob: 'bg-status-green/12',
    pulse: 'bg-status-green',
    pill: 'bg-status-green text-white',
    iconColor: 'text-status-green',
  },
  blue: {
    cardBg: 'bg-[linear-gradient(225deg,var(--status-blue-bg),var(--surface-elevated-1)_75%)]',
    cardBorder: 'border-status-blue/55',
    blob: 'bg-status-blue/15',
    pulse: 'bg-status-blue',
    pill: 'bg-status-blue text-white',
    iconColor: 'text-status-blue',
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

// Per-store accent dot — color sourced from canonical storeColors module.

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
   * Parent dashboard's row set, already narrowed to the operator's
   * selected filters.range. The live-snapshot logic for today's stats
   * (revenue, ROAS, CPM, orders, per-store cards) intentionally does
   * NOT consume this — it fetches its own today-to-today /api/data slice
   * via the useSWR call below so the live widget stays decoupled from
   * the operator's historical-window choice (operator-reported fix
   * 2026-05-23).
   *
   * As of Plan 2 (2026-05-28) we DO consume `_parentRows` for one
   * specific purpose: the month-to-date revenue sum that feeds the
   * narrative line's pace clause. The parent's range is typically wide
   * enough to cover MTD (default range, "last 30 days", etc.); when it
   * isn't (e.g. operator picked "last 7 days") the MTD sum is whatever
   * portion of the month is reachable inside the slice, and the
   * narrative still renders gracefully.
   */
  rows: DailyRow[];
  fxIlsToCad: number | null;
}) {
  const [now, setNow] = useState(nowInIsrael());
  useEffect(() => {
    const t = setInterval(() => setNow(nowInIsrael()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Force a re-render when the operator changes the monthly goal in GoalTracker.
  // GoalTracker writes to localStorage and dispatches `roas-goal-changed`; without
  // listening here, the narrative line would stay stale until the next SWR poll
  // (up to 60 seconds). This keeps it instantaneous.
  const [, bumpGoalVersion] = useState(0);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => bumpGoalVersion(v => v + 1);
    window.addEventListener('roas-goal-changed', handler);
    return () => window.removeEventListener('roas-goal-changed', handler);
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
  const agg = useMemo(() => aggregate(todayRows), [todayRows]);
  const storeAggs = useMemo(() => aggregateByStore(todayRows), [todayRows]);
  const roas = roasLabel(agg.roas);
  const hasAnyData = agg.revenue > 0 || agg.spend > 0;

  // Read the monthly goal that GoalTracker maintains in localStorage.
  // Inline (not memoized) so the value re-picks-up if any sibling triggers a re-render.
  const monthlyGoal: number | null = (() => {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem('roas-monthly-goal');
    const n = raw != null ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  })();

  // Month-to-date revenue + day-of-month for pace calculation. The
  // liveDataResp slice TodayLive fetches is today-only; for MTD we look at
  // the parent's `_parentRows` (range data passed via props, broader window
  // than today). If the parent's range doesn't cover the month-to-date span
  // (e.g. operator chose "last 7 days" before today), the sum is whatever
  // MTD is reachable inside the slice — the narrative still renders.
  //
  // Timezone-safe: parse `today` (ISO YYYY-MM-DD for Israel TZ) as strings
  // and construct `monthStart` via string concatenation. Avoids the previous
  // `new Date('YYYY-MM-DDT00:00:00')` form which the JS spec treats as local
  // time — west-of-Israel browsers around midnight could shift the day by one.
  const [todayYear, todayMonth, todayDay] = today.split('-').map(Number);
  const dayOfMonth = todayDay;
  // `new Date(year, monthIndex, 0)` is TZ-safe: passing day=0 of the next
  // month returns the last day of THIS month, and `.getDate()` is read off
  // the local-time fields which match the numeric components we passed in.
  const daysInMonth = new Date(todayYear, todayMonth, 0).getDate();
  const monthStart = `${todayYear}-${String(todayMonth).padStart(2, '0')}-01`;
  const monthToDateRevenue = useMemo(() => {
    if (monthlyGoal == null) return 0;
    let sum = 0;
    for (const r of _parentRows) {
      if (r.date >= monthStart && r.date < today) sum += r.revenue;
    }
    return sum;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- monthStart derived from today (already in deps)
  }, [_parentRows, today, monthlyGoal]);

  const narrative = useMemo(
    () => buildTodayNarrative({
      revenue: agg.revenue,
      roas: agg.roas,
      storeAggs: storeAggs.map(s => ({ store: s.store, revenue: s.revenue, roas: s.roas })),
      monthlyGoal,
      monthToDateRevenue,
      dayOfMonth,
      daysInMonth,
    }),
    [agg.revenue, agg.roas, storeAggs, monthlyGoal, monthToDateRevenue, dayOfMonth, daysInMonth],
  );

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
        'shadow-sm animate-fade-in',
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
            <h2 className="flex items-center gap-2 text-sm sm:text-base font-semibold text-ink truncate">
              <Radio size={16} className={cn('shrink-0 transition-colors duration-500', liveTone.iconColor)} />
              היום — חי
            </h2>
            <span className={cn('hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded shrink-0 transition-colors duration-500', liveTone.pill)}>
              LIVE
            </span>
          </div>
          <div className="text-[10px] sm:text-xs text-ink-secondary text-left tabular-nums shrink-0">
            <div className="font-medium">{today}</div>
            <div className="text-ink-muted">עודכן {now}</div>
          </div>
        </header>

        {/* Narrative line — single sentence summarising today's revenue, ROAS,
            pace vs monthly goal, and top store. Sits between LIVE header and
            the 6 stat cards. */}
        {hasAnyData && (
          <div
            className="mt-3 sm:mt-4 mb-3 sm:mb-4 px-3 sm:px-4 py-2.5 rounded-lg bg-canvas/40 border-s-2 border-status-green/60 text-xs sm:text-sm leading-relaxed text-ink-secondary tabular-nums"
            data-testid="today-narrative"
          >
            {narrative}
          </div>
        )}

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
              const color = storeColor(s.store);
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
                  className="rounded-xl bg-elevated/90 backdrop-blur-sm border border-line-subtle p-3 shadow-xs"
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
                      <span className="text-xs sm:text-sm font-semibold text-ink truncate">
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
                      <span className="text-ink-muted">סך הוצאה</span>
                      <span className="text-ink font-semibold">
                        CAD {formatCurrency(s.spend)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 ps-3 text-[11px] text-ink-muted flex-wrap">
                      <span>Meta: <span className="text-ink-secondary tabular-nums">{formatCurrency(s.fbSpend)}</span></span>
                      <span>·</span>
                      <span>Google: <span className="text-ink-secondary tabular-nums">{hasGoogle ? formatCurrency(s.gaSpend) : '—'}</span></span>
                      {hasTikTok && (
                        <>
                          <span>·</span>
                          <span>TikTok: <span className="text-ink-secondary tabular-nums">{(s.ttSpend ?? 0) > 0 ? formatCurrency(s.ttSpend ?? 0) : '—'}</span></span>
                        </>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2 rounded-md bg-status-greenBg/40 px-2 py-1.5 mt-1.5">
                      <span className="text-status-green/80 font-medium">הכנסה</span>
                      <span className="text-status-green text-sm sm:text-base font-bold">
                        CAD {formatCurrency(s.revenue)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <span className="text-ink-muted inline-flex items-center gap-1">
                        <ShoppingBag size={11} className="text-ink-muted" />
                        הזמנות
                      </span>
                      <span className="text-ink font-semibold">
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
                      <span className="text-ink-muted">CPM ממוצע</span>
                      <span className="text-ink font-semibold">
                        {storeCpm > 0 ? `CAD ${formatCurrency(storeCpm, 2)}` : '—'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 ps-3 text-[11px] text-ink-muted flex-wrap">
                      <span>
                        Meta: <span className="text-ink-secondary tabular-nums">
                          {storeCpmByPlatform.meta > 0 ? formatCurrency(storeCpmByPlatform.meta, 2) : '—'}
                        </span>
                      </span>
                      <span>·</span>
                      <span>
                        Google: <span className="text-ink-secondary tabular-nums">
                          {hasGoogle && storeCpmByPlatform.google > 0 ? formatCurrency(storeCpmByPlatform.google, 2) : '—'}
                        </span>
                      </span>
                      {hasTikTok && (
                        <>
                          <span>·</span>
                          <span>
                            TikTok: <span className="text-ink-secondary tabular-nums">
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
          <div className="mt-3 text-center text-xs text-ink-muted">
            עוד אין נתוני היום. הטריגר ה-Live ירוץ אוטומטית כל 10 דקות.
          </div>
        )}

        {/* Footer — FX + currencies */}
        <div className="mt-4 sm:mt-5 pt-3 sm:pt-4 border-t border-status-green/15 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10px] sm:text-xs text-ink-muted">
          {fxIlsToCad !== null && (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <span>שער המרה:</span>
              <span className="font-medium text-ink-secondary">
                1 ILS = {fxIlsToCad.toFixed(4)} CAD
              </span>
            </span>
          )}
          <span className="text-ink-subtle">·</span>
          <span>Meta: ILS</span>
          <span className="text-ink-subtle">·</span>
          <span>Google: CAD</span>
          <span className="text-ink-subtle">·</span>
          <span>TikTok: USD</span>
          <span className="text-ink-subtle">·</span>
          <span>Shopify: CAD</span>
        </div>
        <div className="mt-1.5 text-[10px] sm:text-xs text-ink-muted/80 text-center leading-relaxed">
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
    <div className="rounded-xl bg-elevated border border-line-subtle p-2.5 sm:p-4 shadow-xs">
      <div className="flex items-center justify-between mb-1 sm:mb-1.5">
        <span className="text-[10px] sm:text-xs font-medium text-ink-secondary tracking-wide truncate">
          {label}
        </span>
        <span className="text-ink-muted/70 shrink-0">{icon}</span>
      </div>
      <div className="flex items-baseline gap-1 min-w-0">
        {valuePrefix && (
          <span className="text-[10px] sm:text-xs text-ink-muted font-medium shrink-0">
            {valuePrefix}
          </span>
        )}
        <span
          className={cn(
            'font-light tabular-nums tracking-tight leading-none whitespace-nowrap',
            liveValueSizeClass(value),
            accent === 'pos' && 'text-status-green',
            accent === 'neg' && 'text-status-red',
            !accent && 'text-ink',
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
      <span className="text-ink-muted">{label}</span>
      <span
        className={cn(
          'font-semibold',
          accent === 'green' && 'text-status-green',
          !accent && !muted && 'text-ink',
          muted && 'text-ink-secondary',
        )}
      >
        {value}
      </span>
    </div>
  );
}
