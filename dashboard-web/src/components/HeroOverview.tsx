'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  Area,
  AreaChart,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { TrendingUp, TrendingDown, Minus, LineChart } from 'lucide-react';
import {
  annotationsInScope,
  ANNOTATION_KIND_COLOR,
  ANNOTATION_KIND_EMOJI,
  ANNOTATION_KIND_LABEL,
  readAnnotations,
  type Annotation,
} from '@/lib/annotations';
import type { DashboardData, Filters as F } from '@/lib/types';
import type { CampaignsResponse } from '@/app/api/campaigns/route';
import { aggregate, dailySeries, filterRows, roasLabel } from '@/lib/analytics';
import { buildDateRangeKey } from '@/lib/dateRange';
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
 *   │  הכנסות           [chip]      הוצאות         רווח נטו              │
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
  red:    'bg-roas-redBg text-roas-red',
  orange: 'bg-roas-orangeBg text-roas-orange',
  green:  'bg-roas-greenBg text-roas-green',
  blue:   'bg-roas-blueBg text-roas-blue',
  gray:   'bg-surfaceMuted text-text-muted',
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

  const { story, kpis, chartData } = useMemo(() => {
    const cur = filterRows(data.rows, filters.range, filters.store);
    const prev = filterRows(data.rows, previousRange(filters.range), filters.store);
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
    let story: string;
    if (curAgg.spend === 0 && curAgg.revenue === 0) {
      story = 'אין עדיין נתונים לטווח הזה.';
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
      story = `רווח נטו ${verb} ב-${Math.abs(dNet * 100).toFixed(0)}%, ROAS יציב על ${curAgg.roas.toFixed(2)}.`;
    } else {
      story = `הביצועים יציבים. ROAS ${curAgg.roas.toFixed(2)}, רווח נטו של ${curAgg.netProfit >= 0 ? '' : 'מינוס '}CAD ${Math.abs(Math.round(curAgg.netProfit)).toLocaleString('he-IL')}.`;
    }

    const kpis = {
      curAgg,
      prevAgg,
      dRev,
      dRoas,
      dSpend: prevAgg.spend > 0 ? (curAgg.spend - prevAgg.spend) / prevAgg.spend : 0,
      dNet,
    };

    return { story, kpis, chartData };
  }, [data, filters]);

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
        'relative overflow-hidden rounded-2xl',
        'bg-gradient-to-br from-primary-dark via-primary to-primary-light text-white',
        'shadow-elevated',
      )}
      style={{
        backgroundImage:
          'linear-gradient(135deg, #091c4a 0%, #0d3680 55%, #1d4ed8 105%)',
      }}
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
        <div className="flex items-center gap-2 sm:gap-3 text-[10px] sm:text-xs uppercase tracking-[0.14em] text-white/65 mb-3 sm:mb-4">
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
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-x-6 sm:gap-x-8 gap-y-5 sm:gap-y-6">
          <FloatingKpi
            label="הכנסות"
            value={fmtMoneyBare(kpis.curAgg.revenue)}
            valuePrefix="CAD"
            delta={kpis.dRev}
          />
          <div className="lg:border-s lg:border-white/12 lg:ps-7">
            <FloatingKpi
              label="ROAS"
              value={fmtNum2(kpis.curAgg.roas)}
              chip={{ text: roasInfo.text, tone: roasInfo.tone }}
              delta={null}
              rawDelta={kpis.dRoas}
            />
          </div>
          <div className="lg:border-s lg:border-white/12 lg:ps-7">
            <FloatingKpi
              label="הוצאות פרסום"
              value={fmtMoneyBare(kpis.curAgg.spend)}
              valuePrefix="CAD"
              delta={kpis.dSpend}
              inverseDelta
            />
          </div>
          <div className="lg:border-s lg:border-white/12 lg:ps-7">
            <FloatingKpi
              label="רווח נטו"
              value={fmtMoneyBare(kpis.curAgg.netProfit)}
              valuePrefix="CAD"
              delta={kpis.dNet}
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
  // Sanitise: drop days with no spend (where roas=0 isn't meaningful).
  const series = data.filter(d => d.spend > 0 || d.revenue > 0);

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

  if (series.length < 2) return null;

  const maxRoas = Math.max(3.2, ...series.map(d => d.roas));

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
              <bdi dir="ltr">{Math.max(...series.map(d => d.roas)).toFixed(2)}</bdi>
            </span>
          </span>
          <span>
            <span className="text-white/45">מינימום: </span>
            <span className="font-semibold text-white/85">
              <bdi dir="ltr">
                {Math.min(...series.filter(d => d.roas > 0).map(d => d.roas)).toFixed(2)}
              </bdi>
            </span>
          </span>
        </div>
      </div>

      {/* Chart */}
      <div className="h-32 sm:h-36">
        <ResponsiveContainer width="100%" height="100%">
          {/* top margin of 28 (not 8) so annotation emoji labels — positioned
              'top' on the ReferenceLines — get the vertical room they need.
              An emoji at fontSize 13 takes ~18-22 px; an 8 px margin clipped
              all but a sliver, which is what the user saw. */}
          <ComposedChart data={series} margin={{ top: 28, right: 12, left: 12, bottom: 0 }}>
            <defs>
              <linearGradient id="hero-roas-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#bfdbfe" stopOpacity={0.45} />
                <stop offset="100%" stopColor="#bfdbfe" stopOpacity={0} />
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
            {/* Annotation pins — one vertical line per logged event, only
                if its date appears in the visible series. Label = emoji of
                the annotation kind. Color follows the kind palette. */}
            {annotations.map(a => {
              if (!series.some(d => d.date === a.date)) return null;
              const color = ANNOTATION_KIND_COLOR[a.kind];
              return (
                <ReferenceLine
                  key={a.id}
                  x={a.date}
                  stroke={color}
                  strokeOpacity={0.85}
                  strokeWidth={1.5}
                  label={{
                    value: ANNOTATION_KIND_EMOJI[a.kind],
                    position: 'top',
                    fill: color,
                    fontSize: 13,
                  }}
                />
              );
            })}
            <Line
              type="monotone"
              dataKey="roas"
              stroke="#ffffff"
              strokeWidth={2}
              dot={{ r: 2.5, fill: '#ffffff', stroke: 'transparent' }}
              activeDot={{ r: 5, fill: '#ffffff', stroke: '#0d3680', strokeWidth: 3 }}
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
                  roas: number;
                };
                return (
                  <div
                    dir="rtl"
                    className="rounded-lg bg-text-primary/95 text-white px-3 py-2 text-xs shadow-elevated tabular-nums"
                  >
                    <div className="text-white/65 mb-1 text-[10px]">{fmtDateShort(d.date)}</div>
                    <div className="font-semibold">
                      ROAS <bdi dir="ltr">{d.roas.toFixed(2)}</bdi>
                    </div>
                    <div className="text-white/75 text-[11px] mt-0.5">
                      הכנסות <bdi dir="ltr">{Math.round(d.revenue).toLocaleString('he-IL')}</bdi>
                      {' · '}
                      הוצאה <bdi dir="ltr">{Math.round(d.spend).toLocaleString('he-IL')}</bdi>
                    </div>
                  </div>
                );
              }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Date axis labels */}
      <div className="flex items-center justify-between text-[10px] sm:text-[11px] text-white/55 tabular-nums mt-1" dir="ltr">
        <span>{fmtDateShort(fromDate)}</span>
        <span className="text-white/35">{series.length} ימים</span>
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
      <span className="text-[10px] sm:text-xs uppercase tracking-[0.12em] font-semibold text-white/65">
        {label}
      </span>
      <div className="flex items-baseline gap-1.5 sm:gap-2">
        {valuePrefix && (
          <span className="text-[10px] sm:text-xs text-white/55 font-medium">{valuePrefix}</span>
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
        !isFlat && !isPositive && 'text-amber-200',
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
        !isFlat && value < 0 && 'text-amber-200',
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
