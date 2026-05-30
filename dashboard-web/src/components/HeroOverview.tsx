'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  Area,
  ComposedChart,
  Line,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { TrendingUp, TrendingDown, Minus, LineChart, RotateCcw } from 'lucide-react';
import { ChartContainer } from '@/components/ui/chart/ChartContainer';
import {
  ChartTooltip,
  ChartTooltipLabel,
  ChartTooltipValue,
} from '@/components/ui/chart/ChartTooltip';
import { heavyRefundDates, sumRefundsInRange } from '@/lib/refundDayHeuristic';
import {
  annotationsInScope,
  ANNOTATION_KIND_COLOR,
  ANNOTATION_KIND_EMOJI,
  readAnnotations,
  type Annotation,
} from '@/lib/annotations';
import type { DashboardData, Filters as F } from '@/lib/types';
import type { CampaignsResponse } from '@/app/api/campaigns/route';
import { aggregate, dailySeries, filterRows, roasLabel } from '@/lib/analytics';
import { buildDateRangeKey, enumerateDateRange } from '@/lib/dateRange';
import { previousRange } from '@/lib/presets';
import { cn } from '@/lib/utils';
import {
  fmtCount,
  fmtDateShort,
  fmtDeltaPct,
  fmtMoneyBare,
  fmtNum2,
} from '@/lib/format';

const campaignsFetcher = async (url: string): Promise<CampaignsResponse> => {
  const r = await fetch(url);
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body?.error || `HTTP ${r.status}`);
  }
  return r.json() as Promise<CampaignsResponse>;
};

const dashboardDataFetcher = async (url: string): Promise<DashboardData> => {
  const r = await fetch(url);
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body?.error || `HTTP ${r.status}`);
  }
  return r.json() as Promise<DashboardData>;
};

/**
 * Hero block for the Home tab. Inspired by Robinhood (chart-as-background),
 * Stripe ("editorial sentence" summary), and Apple Health (algorithm picks
 * the lead story). The metric tile chrome is gone — KPIs float on a soft
 * chart canvas so the user reads "the story" before any specific number.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │ Eyebrow:  טווח: 1.5 – 16.5 · 16 ימים                              │
 *   │ ★ Editorial sentence ★                                            │
 *   │                                                                   │
 *   │  CAD 142,318     ROAS 2.85    CAD 49,830    CAD 13,200            │
 *   │  הכנסות           [chip]      הוצאות         רווח תפעולי           │
 *   │  +12.4%          +0.18        −4.2%         +18.0%                │
 *   │                                                                   │
 *   │ ╱╲    ▁ ▂ ▃ ▄ ▅ ▆ ▇  (area chart, soft, sits at the bottom)        │
 *   └──────────────────────────────────────────────────────────────────┘
 */

type Props = {
  data: DashboardData;
  filters: F;
};

const TONE_CHIP: Record<string, string> = {
  red:    'bg-status-redBg text-status-red',
  orange: 'bg-status-orangeBg text-status-orange',
  green:  'bg-status-greenBg text-status-green',
  blue:   'bg-status-blueBg text-status-blue',
  gray:   'bg-elevated2 text-ink-muted',
};

export function HeroOverview({ data, filters }: Props) {
  // Pull /api/campaigns to compute blended CPM across the visible scope —
  // data-daily doesn't carry impressions, only spend + revenue, so we
  // can't derive CPM from data.rows alone. SWR caches the response so
  // navigating to the Campaigns tab reuses the same fetch.
  const { data: campaignsData } = useSWR<CampaignsResponse>(
    buildDateRangeKey('/api/campaigns', filters.range),
    campaignsFetcher,
    { revalidateOnFocus: false },
  );

  // Second campaigns fetch for the PREVIOUS period — feeds the CPM
  // delta-vs-previous-period chip. Same range function the other KPIs
  // use, so the "delta" comparison is apples-to-apples across the strip.
  const prevRange = useMemo(() => previousRange(filters.range), [filters.range]);
  const { data: campaignsDataPrev } = useSWR<CampaignsResponse>(
    buildDateRangeKey('/api/campaigns', prevRange),
    campaignsFetcher,
    { revalidateOnFocus: false },
  );

  // The `data` prop only carries rows for the CURRENT range — /api/data
  // server-side filters by `range`, so `data.rows` cannot answer "what
  // happened in the previous period." Fetch the previous range separately
  // (parallel to the campaigns-prev fetch above) so the revenue / spend /
  // net / ROAS deltas have an actual baseline. Without this, every delta
  // collapses to 0 and the hero sentence falls through to
  // "הביצועים יציבים" regardless of true performance change.
  const { data: dataPrev } = useSWR<DashboardData>(
    buildDateRangeKey('/api/data', prevRange),
    dashboardDataFetcher,
    { revalidateOnFocus: false },
  );

  function aggregateCpm_(
    rows: CampaignsResponse['rows'] | undefined,
    from: string,
    to: string,
    store: string,
  ): { spend: number; impressions: number; cpm: number } {
    let spend = 0;
    let impressions = 0;
    for (const r of rows ?? []) {
      if (r.date < from || r.date > to) continue;
      if (store !== 'All' && r.storeName !== store) continue;
      spend += r.spend;
      impressions += r.impressions;
    }
    return {
      spend,
      impressions,
      cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
    };
  }

  const cpmAgg = useMemo(
    () => aggregateCpm_(campaignsData?.rows, filters.range.from, filters.range.to, filters.store),
    [campaignsData, filters.range.from, filters.range.to, filters.store],
  );
  const cpmAggPrev = useMemo(
    () => aggregateCpm_(campaignsDataPrev?.rows, prevRange.from, prevRange.to, filters.store),
    [campaignsDataPrev, prevRange.from, prevRange.to, filters.store],
  );
  // Delta as fractional change vs previous period (matches the other KPIs).
  // Null when we can't compute (either period has zero impressions) — the
  // tile shows the absolute value without a delta pill.
  // Lower CPM is BETTER (cheaper reach), so the tile uses inverseDelta to
  // flip the green/red coloring on the DeltaPill.
  const dCpm = cpmAgg.cpm > 0 && cpmAggPrev.cpm > 0
    ? (cpmAgg.cpm - cpmAggPrev.cpm) / cpmAggPrev.cpm
    : null;

  const { story, kpis, chartData, heavyDates } = useMemo(() => {
    const cur = filterRows(data.rows, filters.range, filters.store);
    // Pull prev from the dedicated prev-range fetch above — the `data` prop
    // only contains current-range rows, so filterRows(data.rows, prevRange)
    // would always return [] and silently null every delta.
    const prev = filterRows(dataPrev?.rows ?? [], prevRange, filters.store);
    const curAgg = aggregate(cur);
    const prevAgg = aggregate(prev);
    const stores = filters.store === 'All' ? data.stores : [filters.store];
    const series = dailySeries(cur, stores);

    // Build chart data: total daily revenue across visible stores so the
    // background curve reflects the same scope as the KPIs above it.
    const chartData = series.map(d => ({
      date: d.date,
      revenue: d.totalRevenue,
      spend: d.totalSpend,
      roas: d.totalRoas,
    }));

    // Editorial sentence — picks the most important delta and writes one
    // sentence. Quiet when nothing moved meaningfully.
    const dRev = prevAgg.revenue > 0 ? (curAgg.revenue - prevAgg.revenue) / prevAgg.revenue : 0;
    const dRoas = prevAgg.roas > 0 ? curAgg.roas - prevAgg.roas : 0;
    const dNet = prevAgg.netProfit !== 0
      ? (curAgg.netProfit - prevAgg.netProfit) / Math.abs(prevAgg.netProfit)
      : 0;
    // "Baseline empty" guard: when the previous period has no spend AND no
    // revenue, every delta above defaults to 0 — which would silently fall
    // through to the "הביצועים יציבים" branch and mislabel a no-comparison
    // case as stability. Detect it explicitly and surface the raw values
    // without claiming stability.
    const prevEmpty = prevAgg.spend === 0 && prevAgg.revenue === 0;
    const netStr = `${curAgg.netProfit >= 0 ? '' : 'מינוס '}CAD ${Math.abs(Math.round(curAgg.netProfit)).toLocaleString('he-IL')}`;
    let story: string;
    if (curAgg.spend === 0 && curAgg.revenue === 0) {
      story = 'אין עדיין נתונים לטווח הזה.';
    } else if (prevEmpty) {
      story = `אין נתוני השוואה לתקופה הקודמת. ROAS ${curAgg.roas.toFixed(2)}, רווח תפעולי של ${netStr}.`;
    } else if (Math.abs(dRev) >= 0.05) {
      const verb = dRev > 0 ? 'עלו' : 'ירדו';
      // Phase 05.7.8 — pull the ROAS label from the canonical roasLabel()
      // helper instead of inline thresholds. Previously the inline copy
      // (בריא/סביר/דורש בחינה) drifted from roasLabel()'s table
      // (מעולה/טוב/סביר/דורש בחינה) so the hero sentence and the chip
      // below the ROAS KPI could disagree on the same number.
      story = `הכנסות ${verb} ב-${Math.abs(dRev * 100).toFixed(0)}% מהתקופה הקודמת, ROAS ${roasLabel(curAgg.roas).text} על ${curAgg.roas.toFixed(2)}.`;
    } else if (Math.abs(dRoas) >= 0.2) {
      const verb = dRoas > 0 ? 'השתפר' : 'נחלש';
      story = `ROAS ${verb} ב-${Math.abs(dRoas).toFixed(2)} נקודות, מ-${prevAgg.roas.toFixed(2)} ל-${curAgg.roas.toFixed(2)}.`;
    } else if (Math.abs(dNet) >= 0.1) {
      const verb = dNet > 0 ? 'עלה' : 'ירד';
      story = `רווח תפעולי ${verb} ב-${Math.abs(dNet * 100).toFixed(0)}%, ROAS יציב על ${curAgg.roas.toFixed(2)}.`;
    } else {
      story = `הביצועים יציבים. ROAS ${curAgg.roas.toFixed(2)}, רווח תפעולי של ${netStr}.`;
    }

    const kpis = {
      curAgg,
      prevAgg,
      dRev,
      dRoas,
      dSpend: prevAgg.spend > 0 ? (curAgg.spend - prevAgg.spend) / prevAgg.spend : 0,
      dNet,
      prevEmpty,
    };

    // === Refund-visibility derivations (refund-visibility UX) ===
    // Heuristic-driven; uses existing DailyRow.refundDeduction/grossRevenue.
    // `cur` is the scoped/store-filtered row set this memo already consumes.
    const heavyDates = heavyRefundDates(cur);
    const refundsTotal = sumRefundsInRange(cur);

    // Story clause: only appended when refunds occurred at all this period.
    if (refundsTotal > 0) {
      const refundStr = `CAD ${Math.round(refundsTotal).toLocaleString('he-IL')}`;
      if (heavyDates.length === 1) {
        story += ` בתקופה זו עובדו ${refundStr} בהחזרים ב-${fmtDateShort(heavyDates[0])}.`;
      } else if (heavyDates.length > 1) {
        story += ` בתקופה זו עובדו ${refundStr} בהחזרים על פני ${heavyDates.length} ימים.`;
      } else {
        story += ` (כולל ${refundStr} בהחזרים מעובדים בתקופה.)`;
      }
    }

    return { story, kpis, chartData, heavyDates };
  }, [data, dataPrev, prevRange, filters]);

  const daysInRange =
    Math.round(
      (new Date(filters.range.to + 'T00:00:00Z').getTime() -
        new Date(filters.range.from + 'T00:00:00Z').getTime()) /
        86400000,
    ) + 1;

  const roasInfo = roasLabel(kpis.curAgg.roas);
  const storeLabel = filters.store === 'All' ? 'כל החנויות' : filters.store;

  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-2xl text-white shadow-elevated',
        // LIGHT mode: bold navy brand gradient (per user preference — the
        // dark indigo card stands out as the hero on a light page).
        'bg-[linear-gradient(135deg,var(--gradient-hero-from),var(--gradient-hero-via)_45%,var(--gradient-hero-to))]',
        // DARK mode: theme-aware accent gradient (subtler — doesn't fight
        // the dark page). The accent token shifts to a lighter indigo in
        // dark theme so text-white stays readable.
        'dark:from-accent dark:via-accent/80 dark:to-accent/55',
      )}
    >
      {/* Decorative dot grid + side glow */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage:
            'radial-gradient(rgba(255,255,255,1) 1px, transparent 1px)',
          backgroundSize: '18px 18px',
        }}
      />
      <div
        aria-hidden
        className="absolute top-0 right-0 w-72 h-72 -translate-y-1/2 translate-x-1/3 rounded-full bg-cyan-300/15 blur-3xl pointer-events-none"
      />

      {/* The chart used to live as a ghost background, but the user
          couldn't tell what it represented. Moved into a clearly-labeled
          section below the KPIs so it stands on its own as a story. */}

      {/* Content */}
      <div className="relative p-5 sm:p-7 md:p-9">
        {/* Eyebrow row */}
        <div className="flex items-center gap-2 sm:gap-3 text-[11px] sm:text-xs uppercase tracking-[0.14em] text-white/65 mb-3 sm:mb-4">
          <span className="font-semibold text-white">{storeLabel}</span>
          <span className="text-white/40">·</span>
          <span className="tabular-nums">
            {fmtDateShort(filters.range.from)} — {fmtDateShort(filters.range.to)}
          </span>
          <span className="text-white/40">·</span>
          <span className="tabular-nums">{daysInRange} ימים</span>
        </div>

        {/* Editorial story line — the centerpiece */}
        <h2
          className="text-lg sm:text-2xl md:text-[1.75rem] font-light leading-snug tracking-tight text-white max-w-3xl mb-6 sm:mb-8"
          style={{ textWrap: 'balance' } as React.CSSProperties}
        >
          {story}
        </h2>

        {/* Floating KPI strip — no card chrome, just hairline dividers */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-6 sm:gap-x-8 gap-y-5 sm:gap-y-6">
          <div className="flex flex-col">
            <FloatingKpi
              label="הכנסות"
              value={fmtMoneyBare(kpis.curAgg.revenue)}
              valuePrefix="CAD"
              delta={kpis.prevEmpty ? null : kpis.dRev}
            />
            {heavyDates.length > 0 && (
              <div
                className="mt-2 inline-flex items-center gap-1 rounded-full bg-status-warning/15 border border-status-warning/30 px-2 py-0.5 text-xs text-status-warning-fg font-medium"
                title={`${heavyDates.length === 1 ? 'יום רפאנד כבד' : `${heavyDates.length} ימי רפאנד כבדים`} בתקופה — ${heavyDates.map(d => fmtDateShort(d)).join(', ')}`}
              >
                <RotateCcw className="h-3 w-3" aria-hidden="true" />
                {heavyDates.length === 1
                  ? `יום רפאנד כבד (${fmtDateShort(heavyDates[0])})`
                  : `${heavyDates.length} ימי רפאנד כבדים`}
              </div>
            )}
          </div>
          <div className="lg:border-s lg:border-white/12 lg:ps-7">
            <FloatingKpi
              label="ROAS"
              value={fmtNum2(kpis.curAgg.roas)}
              chip={{ text: roasInfo.text, tone: roasInfo.tone }}
              delta={null}
              rawDelta={kpis.prevEmpty ? undefined : kpis.dRoas}
            />
          </div>
          <div className="lg:border-s lg:border-white/12 lg:ps-7">
            <FloatingKpi
              label="הוצאות פרסום"
              value={fmtMoneyBare(kpis.curAgg.spend)}
              valuePrefix="CAD"
              delta={kpis.prevEmpty ? null : kpis.dSpend}
              inverseDelta
            />
          </div>
          <div className="lg:border-s lg:border-white/12 lg:ps-7">
            <FloatingKpi
              label="רווח תפעולי"
              value={fmtMoneyBare(kpis.curAgg.netProfit)}
              valuePrefix="CAD"
              delta={kpis.prevEmpty ? null : kpis.dNet}
              accent={kpis.curAgg.netProfit >= 0 ? 'positive' : 'negative'}
            />
          </div>
          <div className="lg:border-s lg:border-white/12 lg:ps-7">
            <FloatingKpi
              label="CPM"
              value={cpmAgg.cpm > 0 ? fmtMoneyBare(cpmAgg.cpm, 2) : <>—</>}
              valuePrefix={cpmAgg.cpm > 0 ? 'CAD' : undefined}
              delta={dCpm}
              inverseDelta
            />
          </div>
        </div>

        {/* ROAS trend chart — clearly labeled, with target reference line,
            date axis, and hover tooltip. This is "what's the shape" of the
            period, not an ambient decoration. */}
        {chartData.length > 1 && (
          <RoasTrendChart
            data={chartData}
            fromDate={filters.range.from}
            toDate={filters.range.to}
            store={filters.store}
          />
        )}

        {/* Context strip */}
        <div className="mt-4 sm:mt-5 pt-4 sm:pt-5 border-t border-white/12 flex flex-wrap items-center gap-x-4 sm:gap-x-6 gap-y-2 text-[11px] sm:text-xs text-white/70 tabular-nums">
          <ContextStat label="ROAS לתקופה הקודמת" value={fmtNum2(kpis.prevAgg.roas)} />
          <ContextStat label="הכנסות שכבר נצברו" value={<>CAD {fmtMoneyBare(kpis.curAgg.revenue)}</>} />
          <ContextStat label="ימי פעילות" value={fmtCount(daysInRange)} />
        </div>
      </div>
    </section>
  );
}

/**
 * The trend chart used to live as a ghost layer behind the KPIs and the
 * user (rightly) asked what it represented. Promoted to a real, labeled
 * micro-section:
 *
 *  - line shows daily ROAS (the dashboard's North Star metric)
 *  - dashed reference line at the internal target (ROAS 3.0)
 *  - subtle x-axis with from/to dates so the period is obvious
 *  - tooltip on hover with date + ROAS + revenue + spend
 *  - "above target" days light up emerald, "below target" stay muted blue
 */
function RoasTrendChart({
  data,
  fromDate,
  toDate,
  store,
}: {
  data: Array<{ date: string; revenue: number; spend: number; roas: number }>;
  fromDate: string;
  toDate: string;
  store: string;
}) {
  // c/CR-03: enumerate the full calendar range and fill missing days with
  // null `roas` so Recharts draws line breaks at the gaps (via the line's
  // default null-handling). The old `data.filter(d => d.spend > 0)` dropped
  // zero-spend days entirely; combined with the categorical X-axis below,
  // that visually compressed 17 active days into the same width as a
  // continuous 30-day window — the chart shape lied about the calendar.
  // The footer also disagreed with the eyebrow on "how many days."
  const byDate = new Map(data.map(d => [d.date, d]));
  const series = enumerateDateRange(fromDate, toDate).map(date => {
    const d = byDate.get(date);
    return {
      date,
      revenue: d?.revenue ?? 0,
      spend: d?.spend ?? 0,
      // Null roas on paused days — Recharts breaks the line at null so the
      // operator sees a true gap, not a smoothed-over interpolation. The
      // dot is also suppressed for null points.
      roas: d && d.spend > 0 ? d.roas : null,
    };
  });

  // Pull annotations in scope (date range + store filter). Re-read when the
  // user adds/edits one — the custom event from lib/annotations fires on
  // every write, so we can hook into it cheaply.
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  useEffect(() => {
    setAnnotations(annotationsInScope(readAnnotations(), { from: fromDate, to: toDate }, store));
    function onChange() {
      setAnnotations(annotationsInScope(readAnnotations(), { from: fromDate, to: toDate }, store));
    }
    window.addEventListener('roas-annotations-changed', onChange);
    return () => window.removeEventListener('roas-annotations-changed', onChange);
  }, [fromDate, toDate, store]);

  // Need at least 2 active days for a meaningful line chart.
  const activeSeries = series.filter(d => d.roas !== null) as Array<typeof series[0] & { roas: number }>;
  if (activeSeries.length < 2) return null;

  const daysInRange = series.length;
  const maxRoas = Math.max(3.2, ...activeSeries.map(d => d.roas));

  return (
    <section className="mt-6 sm:mt-7" dir="ltr">
      {/* Caption row - explains WHAT the chart shows */}
      <div className="flex items-center justify-between mb-2 text-[10px] sm:text-[11px] text-white/65" dir="rtl">
        <div className="inline-flex items-center gap-1.5">
          <LineChart size={12} className="text-white/55" />
          <span className="font-semibold text-white/85 tracking-wide">ROAS יומי</span>
          <span className="text-white/45">·</span>
          <span>קו מקווקו = יעד 3.0</span>
        </div>
        <div className="inline-flex items-center gap-3 tabular-nums">
          <span>
            <span className="text-white/45">מקסימום: </span>
            <span className="font-semibold text-white/85">
              <bdi dir="ltr">{Math.max(...activeSeries.map(d => d.roas)).toFixed(2)}</bdi>
            </span>
          </span>
          <span>
            <span className="text-white/45">מינימום: </span>
            <span className="font-semibold text-white/85">
              {/* Audit fix 2026-05-23 (FIND-04 dashboard-fidelity): if
                  every active day has roas === 0 (e.g., zero-spend store,
                  refund-heavy window), the previous Math.min(...[]) →
                  Infinity → rendered literal "Infinity" at the top of the
                  dashboard. Guard the empty case. */}
              <bdi dir="ltr">
                {(() => {
                  const positives = activeSeries.filter(d => d.roas > 0).map(d => d.roas);
                  return positives.length > 0
                    ? Math.min(...positives).toFixed(2)
                    : '—';
                })()}
              </bdi>
            </span>
          </span>
        </div>
      </div>

      {/* Chart */}
      <ChartContainer
        className="h-32 sm:h-36"
        height="100%"
        style={{
          // Hero card has its own dark navy background that does NOT theme-swap.
          // Override the chart-surface CSS vars to white-with-alpha so gridlines
          // and the ROAS target line read correctly on the dark bg.
          ['--chart-grid' as never]: 'rgba(255,255,255,0.20)',
          ['--chart-axis' as never]: 'rgba(255,255,255,0.55)',
          ['--chart-target' as never]: 'rgba(255,255,255,0.45)',
        }}
      >
        {/* top margin of 28 (not 8) so annotation emoji labels — positioned
            'top' on the ReferenceLines — get the vertical room they need.
            An emoji at fontSize 13 takes ~18-22 px; an 8 px margin clipped
            all but a sliver, which is what the user saw. */}
        <ComposedChart data={series} margin={{ top: 28, right: 12, left: 12, bottom: 0 }}>
          <defs>
            <linearGradient id="hero-roas-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#ffffff" stopOpacity={0.15} />
              <stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="date" hide />
          <YAxis hide domain={[0, maxRoas]} />
          <Area
            type="monotone"
            dataKey="roas"
            stroke="transparent"
            fill="url(#hero-roas-fill)"
            isAnimationActive
            animationDuration={500}
          />
          <ReferenceLine
            y={3}
            stroke="rgba(255,255,255,0.45)"
            strokeDasharray="4 4"
            strokeWidth={1}
          />
          {/* Annotation pins — one vertical line per DATE, not per event.
              c/HI-03: when 3 events fall on the same day (e.g., launch +
              budget + creative refresh — a common operational pattern),
              rendering 3 ReferenceLines at the same X stacked 3 emoji
              labels on top of each other at the same Y position, producing
              an unreadable smudge. Group by date, render the first
              kind's emoji + a small "+N" indicator when there's more than
              one; the operator can drill into the full list via the
              AnnotationsPanel below. */}
          {(() => {
            const validDates = new Set(activeSeries.map(d => d.date));
            const byDate = new Map<string, Annotation[]>();
            for (const a of annotations) {
              if (!validDates.has(a.date)) continue;
              const bucket = byDate.get(a.date);
              if (bucket) bucket.push(a);
              else byDate.set(a.date, [a]);
            }
            return Array.from(byDate.entries()).map(([date, bucket]) => {
              const head = bucket[0];
              const color = ANNOTATION_KIND_COLOR[head.kind];
              const label = bucket.length > 1
                ? `${ANNOTATION_KIND_EMOJI[head.kind]} +${bucket.length - 1}`
                : ANNOTATION_KIND_EMOJI[head.kind];
              return (
                <ReferenceLine
                  key={date}
                  x={date}
                  stroke={color}
                  strokeOpacity={0.85}
                  strokeWidth={1.5}
                  label={{
                    value: label,
                    position: 'top',
                    fill: color,
                    fontSize: 13,
                  }}
                />
              );
            });
          })()}
          <Line
            type="monotone"
            dataKey="roas"
            stroke="#ffffff"
            strokeWidth={2}
            dot={{ r: 2.5, fill: '#ffffff', stroke: 'transparent' }}
            activeDot={{ r: 5, fill: '#ffffff', stroke: 'var(--accent)', strokeWidth: 3 }}
            // c/CR-03: explicitly DO NOT bridge paused days. The gap in
            // the line is the operator's visual signal that the campaign
            // was off — interpolating would mask that.
            connectNulls={false}
            isAnimationActive
            animationDuration={500}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null;
              const d = payload[0].payload as {
                date: string;
                revenue: number;
                spend: number;
                // c/CR-03: paused days now carry null so the Recharts
                // Line breaks at the gap instead of interpolating.
                roas: number | null;
              };
              return (
                <ChartTooltip>
                  <ChartTooltipLabel>{fmtDateShort(d.date)}</ChartTooltipLabel>
                  <div className="font-semibold mb-0.5">
                    ROAS{' '}
                    <ChartTooltipValue>
                      {d.roas !== null ? d.roas.toFixed(2) : '—'}
                    </ChartTooltipValue>
                  </div>
                  <div className="text-ink-muted text-[11px]">
                    הכנסות{' '}
                    <ChartTooltipValue className="text-ink-secondary text-[11px] font-normal">
                      {Math.round(d.revenue).toLocaleString('he-IL')}
                    </ChartTooltipValue>
                    {' · '}
                    הוצאה{' '}
                    <ChartTooltipValue className="text-ink-secondary text-[11px] font-normal">
                      {Math.round(d.spend).toLocaleString('he-IL')}
                    </ChartTooltipValue>
                  </div>
                </ChartTooltip>
              );
            }}
          />
        </ComposedChart>
      </ChartContainer>

      {/* Date axis labels — c/CR-03: report the full calendar day count
          (matches the eyebrow above) rather than the post-filter active-day
          count. The two used to disagree whenever a range contained paused
          days, leaving the operator with two contradictory "how many days"
          numbers for the same scope. */}
      <div className="flex items-center justify-between text-[10px] sm:text-[11px] text-white/55 tabular-nums mt-1" dir="ltr">
        <span>{fmtDateShort(fromDate)}</span>
        <span className="text-white/35">{daysInRange} ימים</span>
        <span>{fmtDateShort(toDate)}</span>
      </div>
    </section>
  );
}

function FloatingKpi({
  label,
  value,
  valuePrefix,
  delta,
  rawDelta,
  chip,
  accent,
  inverseDelta = false,
}: {
  label: string;
  value: React.ReactNode;
  valuePrefix?: string;
  /** Pass null when there's no percentage delta (e.g. ROAS uses points diff). */
  delta: number | null;
  rawDelta?: number; // signed absolute value (used for ROAS-style deltas)
  chip?: { text: string; tone: string };
  accent?: 'positive' | 'negative';
  inverseDelta?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] sm:text-xs uppercase tracking-[0.12em] font-semibold text-white/65">
        {label}
      </span>
      <div className="flex items-baseline gap-1.5 sm:gap-2">
        {valuePrefix && (
          <span className="text-[11px] sm:text-xs text-white/55 font-medium">{valuePrefix}</span>
        )}
        <span
          className={cn(
            'font-light tabular-nums tracking-tight leading-none',
            'text-[1.5rem] sm:text-[2rem] md:text-[2.25rem]',
            accent === 'negative' ? 'text-orange-200' : 'text-white',
          )}
        >
          {value}
        </span>
      </div>
      {chip && (
        <span
          className={cn(
            'inline-flex w-fit items-center mt-1 px-1.5 py-0.5 text-[10px] font-semibold rounded',
            TONE_CHIP[chip.tone],
          )}
        >
          {chip.text}
        </span>
      )}
      {delta !== null && (
        <DeltaPill value={delta} inverse={inverseDelta} />
      )}
      {delta === null && rawDelta !== undefined && (
        <RawDeltaPill value={rawDelta} />
      )}
    </div>
  );
}

function DeltaPill({ value, inverse }: { value: number; inverse?: boolean }) {
  // Reserved-red rule: "down" in metrics that should grow (revenue, ROAS, net
  // profit) is shown in a muted *amber* not red — because it's information,
  // not yet an actionable failure. Red is reserved for things broken.
  // For "spend" (inverse), a down delta is *good*, so it gets the positive
  // treatment.
  const isFlat = Math.abs(value) < 0.005;
  const dirIsUp = value > 0;
  const isPositive = inverse ? !dirIsUp : dirIsUp;
  const Icon = isFlat ? Minus : dirIsUp ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-medium tabular-nums',
        isFlat && 'text-white/55',
        !isFlat && isPositive && 'text-emerald-300',
        !isFlat && !isPositive && 'text-status-warning-fg',
      )}
    >
      <Icon size={11} className="shrink-0" />
      {isFlat ? <span>ללא שינוי</span> : <>{fmtDeltaPct(value)} <span className="text-white/45">מהקודמת</span></>}
    </span>
  );
}

function RawDeltaPill({ value }: { value: number }) {
  // For ROAS: show as absolute points change ("+0.42 נק׳").
  const isFlat = Math.abs(value) < 0.01;
  const Icon = isFlat ? Minus : value > 0 ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-medium tabular-nums',
        isFlat && 'text-white/55',
        !isFlat && value > 0 && 'text-emerald-300',
        !isFlat && value < 0 && 'text-status-warning-fg',
      )}
    >
      <Icon size={11} className="shrink-0" />
      {isFlat
        ? <span>יציב</span>
        : <><bdi dir="ltr">{value > 0 ? '+' : '−'}{Math.abs(value).toFixed(2)}</bdi> <span className="text-white/45">נק׳</span></>
      }
    </span>
  );
}

function ContextStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-white/55">{label}</span>
      <span className="font-semibold text-white/90 tabular-nums">{value}</span>
    </span>
  );
}
