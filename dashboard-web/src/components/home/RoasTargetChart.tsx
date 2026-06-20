'use client';

/**
 * Task 3.2 — <RoasTargetChart> section.
 *
 * Full-width glass card placed between <PerStoreRow> and the bottom 2-up
 * Home row. Composition (top to bottom):
 *
 *   1. Header
 *      ├── Left  — TL;DR Hebrew sentence (band-tinted accent number) +
 *      │           eyebrow "מטרה 3.0 · 30 ימים אחרונים"
 *      └── Right — scope text + pin-count chip + <RoasChartDateRangePicker>
 *   2. 5-up KPI strip (Revenue / ROAS / Spend / Net / CPM)
 *      Only the ROAS tile carries a band tint (matches the chart line band).
 *   3. SVG chart — dashed target at ROAS=3.0, daily ROAS line, min/max dots,
 *      annotation pins. Pin tooltips are HOVER-AND-CLICK ONLY (never
 *      always-visible) per [[home-visual-rules]].
 *   4. Footer strip — prev-period comparison, cumulative revenue, days active.
 *
 * The card is NEUTRAL (no band on `<Card>`) — the inner ROAS KPI tile owns
 * the colour signal. This matches the mockup (mockup-04h-roas-chart-section
 * + mockup-04-final:141-198) where the card itself is glass and the ROAS
 * tile inside is the only tinted surface.
 *
 * Data flow: presentational. The container in Dashboard.tsx (Task 3.x)
 * computes the points/pins/kpis for the chartRange and passes them in.
 * The picker emits a key (and optionally a custom range) — owner refetches
 * + re-renders with the new dataset.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { FreshnessBadge } from '@/components/ui/FreshnessBadge';
import { ChartAnnotationPins } from '@/components/ui/ChartAnnotationPins';
import { Heading } from '@/components/ui/Typography';
import { cn, formatCurrency, formatNumber, formatDate } from '@/lib/utils';
import {
  BAND_TAG_LABEL,
  type RoasBand,
} from '@/lib/format/useRoasBandGradient';
import { useStaleness, type StalenessInput } from '@/lib/freshness/useStaleness';
import {
  RoasChartDateRangePicker,
  readChartRangeFromUrl,
  writeChartRangeToUrl,
  type ChartCustomRange,
} from './RoasChartDateRangePicker';
import {
  synthesizeRoasChart,
  type RoasChartPoint,
  type RoasChartRangeKey,
} from '@/lib/synthesis/roasChart';
import {
  bandForPeriod,
  chartLineStyleForBand,
  areaGradientIdForBand,
  BAND_STROKE_VAR,
} from './roasChartBand';

/* --------------------------------------------------------------------------
 * Props — data shape locked by Task 3.2 spec.
 * -------------------------------------------------------------------------- */

export interface AnnotationPin {
  id: string;
  /** ISO YYYY-MM-DD — anchor x-position is `points.findIndex(date)`. */
  date: string;
  /** Emoji glyph; defaults to 💰 (matches mockup). */
  icon?: string;
  /** Tooltip text — Hebrew-first. */
  label: string;
}

export interface RoasChartKpis {
  revenue: number;
  roas: number;
  spend: number;
  netProfit: number;
  cpm: number;
}

export interface RoasChartPrevPeriod {
  roas: number;
  revenue: number;
}

export interface RoasChartData {
  points: RoasChartPoint[];
  pins: AnnotationPin[];
  kpis: RoasChartKpis;
  prevPeriod?: RoasChartPrevPeriod;
  daysActive: number;
}

export interface RoasTargetChartProps {
  /** Caller resolves `range` → dataset and re-passes both. */
  range: RoasChartRangeKey;
  /** Optional custom-range bounds; only honoured when range='custom'. */
  customRange?: ChartCustomRange;
  data: RoasChartData;
  /** Scope summary — passed by owner (e.g. "כל החנויות · 31 ימים"). */
  scopeLabel?: string;
  /** ROAS target line — defaults to 3.0. */
  target?: number;
  /**
   * Freshness signal — drives both the in-header <FreshnessBadge> chip
   * and the <Card freshness="…"> desaturation (Task 3.6). Accepts the
   * same StalenessInput shape as `useStaleness`: a single ISO timestamp
   * (e.g. the freshest underlying row across the chart range) or a
   * per-platform record `{ meta, google, tiktok }`. Omit if the owner
   * has not yet wired freshness — the badge is then skipped and the
   * Card carries no `data-freshness` attribute.
   */
  updatedAt?: StalenessInput;
  /** Owner refetches on range change. */
  onRangeChange?: (
    next: RoasChartRangeKey,
    customRange?: ChartCustomRange,
  ) => void;
  className?: string;
}

/* --------------------------------------------------------------------------
 * SVG geometry constants — mirror mockup-04-final.html:141-198.
 * -------------------------------------------------------------------------- */

const VB_WIDTH = 1000;
const VB_HEIGHT = 220;
const PADDING_LEFT = 40;      // axis-label gutter
const PADDING_RIGHT = 0;
const PADDING_TOP = 20;
const PADDING_BOTTOM = 40;    // x-axis labels
const Y_MIN = 0;
const Y_MAX = 4;              // FLOOR for the y-domain (gridlines 1.0-4.0 on a normal series)
const TARGET_Y_DEFAULT = 3.0;

/**
 * Dynamic y-domain top (2026-06-10 audit): a fixed Y_MAX=4 silently CLAMPED
 * every day above 4.0 onto the top gridline while the שיא label printed the
 * real value — the drawn shape lied about the best days. The domain now grows
 * to fit the data (never shrinks below the 4.0 floor so a normal ≤4 series
 * renders byte-identically), and the 3.0 target line stays fixed.
 */
function computeYMax(maxRoas: number | null | undefined): number {
  if (maxRoas == null || !Number.isFinite(maxRoas)) return Y_MAX;
  return Math.max(Y_MAX, Math.ceil(maxRoas));
}

/** Integer gridline values for a given yMax, descending (top first). Steps of
 *  1 up to 6; wider steps beyond so an outlier day can't flood the axis. */
function gridValuesFor(yMax: number): number[] {
  const step = yMax <= 6 ? 1 : Math.ceil(yMax / 4);
  const vals: number[] = [];
  for (let v = yMax; v >= 1; v -= step) vals.push(v);
  return vals;
}

/* --------------------------------------------------------------------------
 * Helpers — kept inline so the component is single-file readable.
 * -------------------------------------------------------------------------- */

function bandClassForRoas(band: RoasBand): string {
  // The KPI tile tint matches the chart band — pulls colour from the same
  // CSS variables that <Card data-band> uses, so the two never diverge.
  switch (band) {
    case 'red':    return 'text-band-red';
    case 'orange': return 'text-band-orange';
    case 'green':  return 'text-band-green';
    case 'blue':   return 'text-band-blue';
    case 'gray':
    default:       return 'text-ink-muted';
  }
}

function chipClassForBand(band: RoasBand): string {
  switch (band) {
    case 'red':    return 'chip-red';
    case 'orange': return 'chip-orange';
    case 'green':  return 'chip-green';
    case 'blue':   return 'chip-blue';
    case 'gray':
    default:       return 'chip-gray';
  }
}

// bandLabelHe removed 2026-06-09 (Task 10) — the KPI chip now uses the shared
// canonical BAND_TAG_LABEL so its wording matches the per-store pills.

function xForIndex(index: number, count: number): number {
  if (count <= 1) return PADDING_LEFT;
  const usable = VB_WIDTH - PADDING_LEFT - PADDING_RIGHT;
  return PADDING_LEFT + (index / (count - 1)) * usable;
}

function yForRoas(roas: number, yMin = Y_MIN, yMax = Y_MAX): number {
  const usable = VB_HEIGHT - PADDING_TOP - PADDING_BOTTOM;
  const clamped = Math.max(yMin, Math.min(yMax, roas));
  // y=0 at top → invert the value range to map into screen coords.
  return PADDING_TOP + (1 - (clamped - yMin) / (yMax - yMin)) * usable;
}

interface MinMaxPoint {
  index: number;
  value: number;
  date: string;
}

function findMinMax(points: RoasChartPoint[]): {
  min: MinMaxPoint | null;
  max: MinMaxPoint | null;
} {
  let min: MinMaxPoint | null = null;
  let max: MinMaxPoint | null = null;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.roas == null || Number.isNaN(p.roas)) continue;
    if (min === null || p.roas < min.value) {
      min = { index: i, value: p.roas, date: p.date };
    }
    if (max === null || p.roas > max.value) {
      max = { index: i, value: p.roas, date: p.date };
    }
  }
  return { min, max };
}

/**
 * A single contiguous run of non-null ROAS points (index + screen coords).
 * The chart skips null gaps, so a sparse series yields several segments.
 */
interface PlotPoint {
  index: number;
  x: number;
  y: number;
  roas: number;
  date: string;
}

function buildSegments(points: RoasChartPoint[], yMax: number): PlotPoint[][] {
  const segments: PlotPoint[][] = [];
  let cur: PlotPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.roas == null || Number.isNaN(p.roas)) {
      if (cur.length) segments.push(cur);
      cur = [];
      continue;
    }
    cur.push({
      index: i,
      x: xForIndex(i, points.length),
      y: yForRoas(p.roas, Y_MIN, yMax),
      roas: p.roas,
      date: p.date,
    });
  }
  if (cur.length) segments.push(cur);
  return segments;
}

/**
 * Catmull-Rom → cubic-bézier smoothing (V4 mockup smoothPath). Produces the
 * same "type=monotone"-style soft curve the recommended mockup uses without
 * pulling in Recharts. A single point degrades to a move; two+ smooth.
 */
function smoothPath(pts: PlotPoint[]): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  let d = `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d +=
      ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ` +
      `${c2x.toFixed(2)},${c2y.toFixed(2)} ` +
      `${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }
  return d;
}

/** Close a smoothed line down to the plot baseline → a fillable area path. */
function areaPathFromSegment(seg: PlotPoint[]): string {
  if (seg.length === 0) return '';
  const top = smoothPath(seg);
  const baseY = (VB_HEIGHT - PADDING_BOTTOM).toFixed(2);
  const firstX = seg[0].x.toFixed(2);
  const lastX = seg[seg.length - 1].x.toFixed(2);
  return `${top} L${lastX},${baseY} L${firstX},${baseY} Z`;
}

/* --------------------------------------------------------------------------
 * Component
 * -------------------------------------------------------------------------- */

export function RoasTargetChart({
  range,
  customRange,
  data,
  scopeLabel,
  target = TARGET_Y_DEFAULT,
  updatedAt,
  onRangeChange,
  className,
}: RoasTargetChartProps) {
  // Task 3.6 — freshness signal. Hook safely accepts undefined (falls
  // through to a stale verdict with em-dash); we gate the badge render
  // on `updatedAt !== undefined` so owners that haven't wired it yet
  // don't get a "—" chip pinned in the header.
  const freshness = useStaleness(updatedAt);
  /* --- pin tooltip state ----------------------------------------------- */
  // Pin open/close + hover-and-click + dismiss-on-outside now live in the
  // shared <ChartAnnotationPins> primitive ([[home-visual-rules]]: pin
  // tooltips are NEVER always-visible). This component only owns the
  // crosshair readout below.

  /* --- crosshair + rich tooltip state (V4) ----------------------------- */
  // `hoverIndex` is the nearest data point under the pointer; null = no
  // crosshair. Driven by pointermove (and pointerdown for touch) over the SVG
  // plot. The custom tooltip (date · ROAS · target · delta-vs-target) renders
  // in HTML over the chart.
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Dismiss-on-tap-outside (touch-friendly) for the crosshair readout. On a
  // phone there is no pointerleave, so a tap outside the chart wrap is what
  // closes a lingering crosshair. Active whenever the crosshair is open.
  useEffect(() => {
    if (hoverIndex === null) return;
    const handler = (e: MouseEvent | PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      const wrap = wrapRef.current;
      if (!wrap) return;
      if (!wrap.contains(target)) setHoverIndex(null);
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [hoverIndex]);

  /* --- derived ----------------------------------------------------------- */
  const { points, pins, kpis, prevPeriod, daysActive } = data;
  const synthesis = useMemo(
    () => synthesizeRoasChart({ points, range, target }),
    [points, range, target],
  );
  const minMax = useMemo(() => findMinMax(points), [points]);
  // Dynamic y-domain top — grows to fit the best day (floor 4.0) so points
  // above 4.0 are never clamped onto the top gridline. Target line stays 3.0.
  const yMax = useMemo(() => computeYMax(minMax.max?.value), [minMax]);
  const gridValues = useMemo(() => gridValuesFor(yMax), [yMax]);
  // Spec §3.2.2 — the LINE + AREA are a SINGLE hue = the band of the
  // PERIOD-AVERAGE ROAS (replaces the old two-tone area split at the target).
  // Source = the SAME headline aggregation the KPI tile shows: kpis.roas
  // (= agg.roas = total revenue / total spend) + kpis.spend (= agg.spend).
  // No second average is computed. Organic (spend === 0) → gray + dashed.
  const chartBand = useMemo(
    () => bandForPeriod({ roas: kpis.roas, spend: kpis.spend }),
    [kpis.roas, kpis.spend],
  );
  // FIX #21 — the KPI tile + TL;DR band from the SAME spend-aware classifier
  // the chart LINE uses, so an organic (spend===0) period reads gray "אורגני"
  // on the tile instead of red "0.00x". For a spend-backed period this equals
  // useRoasBandGradient(kpis.roas).band (bandForPeriod delegates to bandForRoas
  // when spend>0), so the non-organic colouring is unchanged.
  const kpiBand: RoasBand = chartBand.band;
  const lineStyle = useMemo(
    () => chartLineStyleForBand(chartBand.band, chartBand.isOrganic),
    [chartBand],
  );
  const areaGradientId = useMemo(
    () => areaGradientIdForBand(chartBand.band, chartBand.isOrganic),
    [chartBand],
  );

  // Contiguous non-null runs → smoothed line + two-tone area paths. The
  // line keeps the `chart-roas-line` testid (now a smooth monotone-style
  // curve instead of straight segments); the area is a NEW overlay clipped
  // at the target line so green sits above the target and red below it.
  const segments = useMemo(() => buildSegments(points, yMax), [points, yMax]);
  const smoothLinePath = useMemo(
    () => segments.map((seg) => smoothPath(seg)).join(' '),
    [segments],
  );
  const areaPaths = useMemo(
    () => segments.map((seg) => areaPathFromSegment(seg)),
    [segments],
  );

  // Last non-null point = the "today" marker anchor.
  const todayPoint = useMemo<PlotPoint | null>(() => {
    for (let i = points.length - 1; i >= 0; i--) {
      const p = points[i];
      if (p.roas != null && !Number.isNaN(p.roas)) {
        return {
          index: i,
          x: xForIndex(i, points.length),
          y: yForRoas(p.roas, Y_MIN, yMax),
          roas: p.roas,
          date: p.date,
        };
      }
    }
    return null;
  }, [points, yMax]);

  // Crosshair anchor — only when the hovered index has a real ROAS value.
  const hoverPoint = useMemo<PlotPoint | null>(() => {
    if (hoverIndex == null) return null;
    const p = points[hoverIndex];
    if (!p || p.roas == null || Number.isNaN(p.roas)) return null;
    return {
      index: hoverIndex,
      x: xForIndex(hoverIndex, points.length),
      y: yForRoas(p.roas, Y_MIN, yMax),
      roas: p.roas,
      date: p.date,
    };
  }, [hoverIndex, points, yMax]);

  // Map pointer clientX → nearest data index (viewBox-space, RTL-safe:
  // getBoundingClientRect is screen-space and the viewBox maps left→right).
  const handlePlotMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg || points.length === 0) return;
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0) return;
      const rel = (e.clientX - rect.left) / rect.width; // 0..1 visual L→R
      const vbx = rel * VB_WIDTH;
      const usable = VB_WIDTH - PADDING_LEFT - PADDING_RIGHT;
      const frac = Math.max(0, Math.min(1, (vbx - PADDING_LEFT) / usable));
      const idx = Math.round(frac * (points.length - 1));
      setHoverIndex(Math.max(0, Math.min(points.length - 1, idx)));
    },
    [points.length],
  );
  const handlePlotLeave = useCallback(() => setHoverIndex(null), []);

  // Pin → x position (only pins whose date is in the dataset are rendered).
  const renderablePins = useMemo(() => {
    const dateIndex = new Map(points.map((p, i) => [p.date, i]));
    return pins
      .map((pin) => {
        const idx = dateIndex.get(pin.date);
        if (idx === undefined) return null;
        const xPct =
          points.length <= 1
            ? 50
            : ((idx / (points.length - 1)) *
                ((VB_WIDTH - PADDING_LEFT) / VB_WIDTH) +
                PADDING_LEFT / VB_WIDTH) *
              100;
        return { pin, index: idx, leftPct: xPct };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);
  }, [pins, points]);

  // viewBox-x → overlay `left:` percentage (matches the renderablePins math
  // so the HTML overlays sit exactly above their SVG anchor under both LTR
  // and the page's RTL — the wrapper is dir="ltr").
  const leftPctForIndex = useCallback(
    (idx: number): number =>
      points.length <= 1
        ? 50
        : ((idx / (points.length - 1)) *
            ((VB_WIDTH - PADDING_LEFT) / VB_WIDTH) +
            PADDING_LEFT / VB_WIDTH) *
          100,
    [points.length],
  );

  // ISO date → that day's ROAS, for the pin tooltip's context line. Passed to
  // <ChartAnnotationPins valueForDate> so the bubble can append "· ROAS 2.84".
  const roasByDate = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const p of points) m.set(p.date, p.roas ?? null);
    return m;
  }, [points]);
  const roasForDate = useCallback(
    (date: string) => roasByDate.get(date) ?? null,
    [roasByDate],
  );

  const todayLeftPct = useMemo(
    () => (todayPoint ? leftPctForIndex(todayPoint.index) : null),
    [todayPoint, leftPctForIndex],
  );

  const xAxisLabels = useMemo(() => {
    if (points.length === 0) return [] as Array<{ text: string; x: number; anchor: 'start' | 'middle' | 'end' }>;
    const first = points[0];
    const last = points[points.length - 1];
    const midIdx = Math.floor(points.length / 2);
    const mid = points[midIdx];
    return [
      { text: formatDate(first.date), x: xForIndex(0, points.length), anchor: 'start' as const },
      { text: formatDate(mid.date), x: xForIndex(midIdx, points.length), anchor: 'middle' as const },
      { text: formatDate(last.date), x: xForIndex(points.length - 1, points.length), anchor: 'end' as const },
    ];
  }, [points]);

  /* --- range-change handler (URL persistence) -------------------------- */
  const handleRangeChange = useCallback(
    (next: RoasChartRangeKey, nextCustomRange?: ChartCustomRange) => {
      writeChartRangeToUrl(next, nextCustomRange);
      onRangeChange?.(next, nextCustomRange);
    },
    [onRangeChange],
  );

  /* --- render ----------------------------------------------------------- */
  const eyebrowText = `מטרה ${target.toFixed(1)} · ${rangeEyebrowHe(range, customRange)}`;
  const pinChipLabel = `${pins.length} ${pins.length === 1 ? 'ציון דרך' : 'ציוני דרך'}`;

  return (
    <Card
      className={cn('roas-card', className)}
      data-testid="roas-target-chart"
      freshness={updatedAt !== undefined ? freshness.stage : undefined}
    >
      {/* Header --------------------------------------------------------- */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div className="flex-1 min-w-0">
          <span
            className="block font-mono text-[10px] uppercase tracking-[0.12em] text-ink-subtle font-semibold mb-1"
            data-testid="chart-eyebrow"
          >
            {eyebrowText}
          </span>
          <Heading
            level="section"
            className="text-base sm:text-lg leading-snug"
            data-testid="chart-tldr"
          >
            {/* FIX #21 — organic (spend===0) period: the TL;DR fallback must
                read gray "אורגני", never a red "0.00" beside the chart's gray
                organic line. Spend-backed periods are unchanged (kpiBand equals
                the displayed-number band). */}
            {renderTldr(synthesis, kpiBand, kpis.roas, chartBand.isOrganic)}
          </Heading>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            {updatedAt !== undefined && (
              <FreshnessBadge updatedAt={updatedAt} />
            )}
            <span
              className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted"
              data-testid="chart-scope"
            >
              {scopeLabel ?? '—'}
            </span>
          </div>
          {pins.length > 0 && (
            <span
              className={cn(
                'inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-full',
                'bg-status-warningBg text-status-warningFg border border-status-warning',
              )}
              data-testid="chart-pin-count"
            >
              <span aria-hidden>💰</span>
              {pinChipLabel}
            </span>
          )}
          <RoasChartDateRangePicker
            value={range}
            customRange={customRange}
            onRangeChange={handleRangeChange}
          />
        </div>
      </div>

      {/* KPI strip ------------------------------------------------------- */}
      <div
        className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-px rounded-card border border-glass-edge overflow-hidden bg-glass-edge/40 mb-4"
        data-testid="chart-kpi-strip"
      >
        <KpiTile label="הכנסות" value={formatCurrency(kpis.revenue)} suffix="CAD" />
        <KpiTile
          label="ROAS"
          // FIX #21 (2026-06-20): in an ORGANIC period (spend===0) the ratio
          // is meaningless (kpis.roas folds to 0). Banding from
          // useRoasBandGradient(0) painted the tile RED "0.00x" while the chart
          // LINE already read gray "organic" (bandForPeriod) — the two surfaces
          // disagreed. Band + label the tile from the SAME spend-aware source
          // the line uses (chartBand = bandForPeriod) and render "אורגני"
          // instead of a fake "0.00x".
          value={chartBand.isOrganic ? 'אורגני' : `${kpis.roas.toFixed(2)}x`}
          // 2026-06-09 (Task 9 + 10): band the tile from the DISPLAYED number,
          // not accentBand (which uses the unweighted daily-mean band when
          // confidence is high) — so the color always matches the tile. Wording
          // is the canonical BAND_TAG_LABEL (shared with the per-store pills).
          chipClass={chipClassForBand(kpiBand)}
          chipLabel={BAND_TAG_LABEL[kpiBand]}
          accentClass={bandClassForRoas(kpiBand)}
          highlight
          testId="chart-kpi-roas"
        />
        <KpiTile label="הוצאת פרסום" value={formatCurrency(kpis.spend)} suffix="CAD" />
        <KpiTile label="רווח תפעולי" value={formatCurrency(kpis.netProfit)} suffix="CAD" />
        {/* 2026-06-09 (Task 13): "—" when CPM is missing/0, matching the hero
            (which nulls it). Was a hard "0.00" — inconsistent across surfaces. */}
        <KpiTile label="CPM" value={kpis.cpm > 0 ? formatNumber(kpis.cpm, 2) : '—'} suffix={kpis.cpm > 0 ? 'CAD' : undefined} />
      </div>

      {/* Legend + min/max ------------------------------------------------ */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1.5 px-1 text-[11px] text-ink-muted">
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-1.5 font-mono tracking-wide">
            {/* Swatch mirrors the band-coloured line (dashed when organic) so
                the legend always matches the actual stroke (spec §3.2.2). */}
            <span
              className={cn(
                'inline-block w-4 rounded-sm',
                lineStyle.isDashed
                  ? 'h-0 border-t-2 border-dashed'
                  : 'h-0.5',
              )}
              style={
                lineStyle.isDashed
                  ? { borderTopColor: lineStyle.strokeVar }
                  : { backgroundColor: lineStyle.strokeVar }
              }
            />
            ROAS יומי
          </span>
          <span className="inline-flex items-center gap-1.5 font-mono tracking-wide">
            <span
              className="inline-block w-4 h-0 border-t-[1.5px] border-dashed"
              style={{ borderTopColor: 'var(--chart-target-line)' }}
            />
            יעד {target.toFixed(1)}
          </span>
        </div>
        <div className="font-mono tabular-nums">
          {minMax.max && (
            <>
              מקסימום: <span className="text-ink font-semibold">{minMax.max.value.toFixed(2)}</span>
            </>
          )}
          {minMax.max && minMax.min && (
            <span className="opacity-40 mx-2">·</span>
          )}
          {minMax.min && (
            <>
              מינימום: <span className="text-ink font-semibold">{minMax.min.value.toFixed(2)}</span>
            </>
          )}
        </div>
      </div>

      {/* Chart ----------------------------------------------------------- */}
      <div
        ref={wrapRef}
        className="relative"
        data-testid="chart-wrap"
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VB_WIDTH} ${VB_HEIGHT}`}
          preserveAspectRatio="none"
          width="100%"
          height="200"
          className="block"
          role="img"
          aria-label={synthesis.text || 'גרף ROAS יומי מול יעד'}
          data-testid="chart-svg"
          // onPointerDown also serves touch: a tap on the plot shows the
          // crosshair readout at the tapped day; a tap outside the chart wrap
          // dismisses it (the document pointerdown listener below clears both
          // the open pin tooltip AND the crosshair on touch).
          onPointerDown={handlePlotMove}
          onPointerMove={handlePlotMove}
          onPointerLeave={handlePlotLeave}
        >
          {/* defs (spec §3.2.2): a SINGLE-HUE area gradient keyed to the
              period-average band (replaces the old two-tone green/red split at
              the target). The fill is the band hue fading top ~0.2 → bottom 0,
              so the colour reads as one band, not a green/red boundary.
              `--chart-line-halo` is the casing/halo colour (a neutral plot-scrim
              tint) drawn UNDER the coloured line so the series hue never
              collides with a colored card in either theme. */}
          <defs>
            <linearGradient
              id={areaGradientId}
              x1="0"
              y1={PADDING_TOP}
              x2="0"
              y2={VB_HEIGHT - PADDING_BOTTOM}
              gradientUnits="userSpaceOnUse"
            >
              <stop
                offset="0%"
                stopColor={BAND_STROKE_VAR[chartBand.band]}
                stopOpacity={chartBand.isOrganic ? 0.1 : 0.2}
              />
              <stop
                offset="100%"
                stopColor={BAND_STROKE_VAR[chartBand.band]}
                stopOpacity={0}
              />
            </linearGradient>
            <clipPath id="roas-plot-clip">
              <rect
                x={PADDING_LEFT}
                y={PADDING_TOP - 4}
                width={VB_WIDTH - PADDING_LEFT - PADDING_RIGHT}
                height={VB_HEIGHT - PADDING_TOP - PADDING_BOTTOM + 8}
              />
            </clipPath>
          </defs>

          {/* Gridlines at integer ROAS values (re-derived from the dynamic yMax) */}
          {gridValues.map((v) => (
            <line
              key={`grid-${v}`}
              data-testid={`chart-gridline-${v}`}
              x1={PADDING_LEFT}
              x2={VB_WIDTH}
              y1={yForRoas(v, Y_MIN, yMax)}
              y2={yForRoas(v, Y_MIN, yMax)}
              style={{ stroke: 'var(--chart-grid-line)', strokeWidth: 1 }}
            />
          ))}

          {/* Y-axis labels */}
          {gridValues.map((v) => (
            <text
              key={`yl-${v}`}
              x={0}
              y={yForRoas(v, Y_MIN, yMax) + 4}
              style={{
                fontFamily: 'var(--font-mono, ui-monospace)',
                fontSize: 10,
                fill: 'var(--text-subtle)',
              }}
            >
              {v.toFixed(1)}
            </text>
          ))}

          {/* Gradient area fill — SINGLE band hue (spec §3.2.2), drawn UNDER
              the line. The `roas-area-rise` class fades+slides it up on mount
              (collapsed by the global prefers-reduced-motion sweep). */}
          {areaPaths.map((d, i) =>
            d ? (
              <path
                key={`area-${i}`}
                d={d}
                fill={`url(#${areaGradientId})`}
                clipPath="url(#roas-plot-clip)"
                className="roas-area-rise"
                data-testid={i === 0 ? 'chart-roas-area' : undefined}
              />
            ) : null,
          )}

          {/* Target line — anchor value stays FIXED at the 3.0 target even
              when the y-domain grows (only its pixel position rescales). */}
          <line
            x1={PADDING_LEFT}
            x2={VB_WIDTH}
            y1={yForRoas(target, Y_MIN, yMax)}
            y2={yForRoas(target, Y_MIN, yMax)}
            style={{
              stroke: 'var(--chart-target-line)',
              strokeWidth: 1.5,
              strokeDasharray: '4 4',
              opacity: 0.7,
            }}
            data-testid="chart-target-line"
          />

          {/* Pin vertical guides */}
          {renderablePins.map(({ pin, index }) => (
            <line
              key={`pl-${pin.id}`}
              x1={xForIndex(index, points.length)}
              x2={xForIndex(index, points.length)}
              y1={PADDING_TOP}
              y2={VB_HEIGHT - PADDING_BOTTOM + 10}
              style={{
                stroke: 'var(--chart-pin-line)',
                strokeWidth: 1.2,
                opacity: 0.5,
                strokeDasharray: '2 3',
              }}
            />
          ))}

          {/* Casing / halo — a wider stroke in the plot-scrim colour drawn
              UNDER the coloured line so the band hue is "cut out" of the
              surface and never collides with a colored card, in both themes.
              Skipped for the organic dashed state (the gaps would show the
              casing through). */}
          {smoothLinePath && !lineStyle.isDashed && (
            <path
              d={smoothLinePath}
              fill="none"
              style={{
                stroke: 'var(--chart-line-halo)',
                strokeWidth: 5,
                strokeLinejoin: 'round',
                strokeLinecap: 'round',
                opacity: 0.9,
              }}
              data-testid="chart-roas-line-halo"
              aria-hidden
            />
          )}

          {/* ROAS line — smooth monotone-style curve. Spec §3.2.2: the stroke
              is the SINGLE band hue of the period-average ROAS (was a static
              neutral --chart-roas-line). SOLID for every spend-backed band;
              for the ORGANIC / no-spend state it's gray + dashed ("1 6",
              mockup-locked). The solid line keeps the `roas-line-draw` "draw
              in" on mount (--roas-line-len sizes the dash to the path); the
              organic line skips that class so the static "1 6" dash is not
              fought by the draw-in dasharray. */}
          {smoothLinePath && (
            <path
              d={smoothLinePath}
              fill="none"
              className={lineStyle.isDashed ? undefined : 'roas-line-draw'}
              style={{
                stroke: lineStyle.strokeVar,
                strokeWidth: lineStyle.isDashed ? 2.5 : 2,
                strokeLinejoin: 'round',
                strokeLinecap: 'round',
                ...(lineStyle.isDashed
                  ? { strokeDasharray: lineStyle.dash }
                  : {
                      strokeDasharray: 'var(--roas-line-len, 1600)',
                      ['--roas-line-len' as string]: '1600',
                    }),
              }}
              data-band={chartBand.band}
              data-organic={chartBand.isOrganic ? 'true' : undefined}
              data-testid="chart-roas-line"
            />
          )}

          {/* Crosshair vertical guide — follows the nearest hovered point. */}
          {hoverPoint && (
            <line
              className="roas-crosshair on"
              x1={hoverPoint.x}
              x2={hoverPoint.x}
              y1={PADDING_TOP}
              y2={VB_HEIGHT - PADDING_BOTTOM}
              data-testid="chart-crosshair"
            />
          )}

          {/* Data dots */}
          {points.map((p, i) => {
            if (p.roas == null || Number.isNaN(p.roas)) return null;
            const x = xForIndex(i, points.length);
            const y = yForRoas(p.roas, Y_MIN, yMax);
            const isMax = minMax.max?.index === i;
            const isMin = minMax.min?.index === i;
            const fill = isMax
              ? 'var(--chart-dot-max)'
              : isMin
                ? 'var(--chart-dot-min)'
                // Spec §3.2.2 — ordinary dots follow the period band hue so they
                // sit ON the band line (was the static neutral --chart-roas-line).
                : lineStyle.strokeVar;
            const r = isMax || isMin ? 3 : 2.5;
            return (
              // Decision §6.5.4 — no SVG <title> on data dots; the crosshair
              // tooltip already covers each point on hover (a native <title>
              // would double-render a browser tooltip on top of it).
              <circle
                key={`dot-${i}`}
                cx={x}
                cy={y}
                r={r}
                style={{ fill }}
              />
            );
          })}

          {/* min / max value labels (שיא / שפל) — only when both exist and
              are distinct points, so we don't double-label a flat series. */}
          {minMax.max && minMax.max.index !== minMax.min?.index && (
            <text
              x={xForIndex(minMax.max.index, points.length)}
              y={yForRoas(minMax.max.value, Y_MIN, yMax) - 8}
              textAnchor="middle"
              style={{
                fontFamily: 'var(--font-mono, ui-monospace)',
                fontSize: 10,
                fontWeight: 700,
                fill: 'var(--chart-dot-max)',
              }}
              data-testid="chart-max-label"
            >
              {`שיא ${minMax.max.value.toFixed(1)}`}
            </text>
          )}
          {minMax.min && minMax.min.index !== minMax.max?.index && (
            <text
              x={xForIndex(minMax.min.index, points.length)}
              y={yForRoas(minMax.min.value, Y_MIN, yMax) + 16}
              textAnchor="middle"
              style={{
                fontFamily: 'var(--font-mono, ui-monospace)',
                fontSize: 10,
                fontWeight: 700,
                fill: 'var(--chart-dot-min)',
              }}
              data-testid="chart-min-label"
            >
              {`שפל ${minMax.min.value.toFixed(1)}`}
            </text>
          )}

          {/* "Today" marker — a violet/accent vertical line + pulsing dot at
              the last data point, visually distinct from the amber event
              pins. Labelled "היום" above the plot. */}
          {todayPoint && (
            <g data-testid="chart-today-marker">
              <line
                x1={todayPoint.x}
                x2={todayPoint.x}
                y1={PADDING_TOP}
                y2={VB_HEIGHT - PADDING_BOTTOM}
                style={{
                  stroke: 'var(--chart-today)',
                  strokeWidth: 1.5,
                  strokeDasharray: '2 4',
                  opacity: 0.85,
                }}
              />
              <circle
                className="roas-today-pulse"
                cx={todayPoint.x}
                cy={todayPoint.y}
                r={6}
                style={{ fill: 'var(--chart-today-pulse)' }}
              />
              <circle
                cx={todayPoint.x}
                cy={todayPoint.y}
                r={4}
                style={{ fill: 'var(--chart-today)' }}
              />
            </g>
          )}

          {/* Crosshair hover dot — a ring + core on the hovered point. */}
          {hoverPoint && (
            <g className="roas-hover-dot on">
              <circle
                cx={hoverPoint.x}
                cy={hoverPoint.y}
                r={6}
                style={{
                  fill: 'var(--chart-hover-ring)',
                  // Match the band line so the crosshair dot reads as part of it.
                  stroke: lineStyle.strokeVar,
                  strokeWidth: 2,
                }}
              />
              <circle
                cx={hoverPoint.x}
                cy={hoverPoint.y}
                r={2.5}
                style={{ fill: lineStyle.strokeVar }}
              />
            </g>
          )}

          {/* X-axis labels */}
          {xAxisLabels.map((l, i) => (
            <text
              key={`xl-${i}`}
              x={l.x}
              y={VB_HEIGHT - 4}
              textAnchor={l.anchor}
              style={{
                fontFamily: 'var(--font-mono, ui-monospace)',
                fontSize: 10,
                fill: 'var(--text-subtle)',
              }}
            >
              {l.text}
            </text>
          ))}
        </svg>

        {/* Pins overlay — shared <ChartAnnotationPins> primitive (single
            source of truth, also mounted on the Trends-tab RoasChart). It
            owns hover/click + dismiss-on-outside and forces dir="ltr" so the
            left-% anchors from the visual-left edge under the page's RTL. The
            SVG already draws the dashed vertical guides above, so guides stay
            OFF here to avoid doubling them. */}
        <ChartAnnotationPins
          pins={pins}
          dates={points.map((p) => p.date)}
          leftPctForIndex={leftPctForIndex}
          valueForDate={roasForDate}
          valueLabel="ROAS"
        />

        {/* Today + crosshair overlay ------------------------------------- */}
        <div
          className="absolute inset-0 pointer-events-none"
          dir="ltr"
        >
          {/* "היום" today label — HTML badge above the SVG today marker
              (SVG text would distort under preserveAspectRatio="none"). */}
          {todayLeftPct != null && (
            <div
              className="absolute"
              style={{ left: `${todayLeftPct}%`, top: -2 }}
              data-testid="chart-today-label"
            >
              <span
                className="absolute -translate-x-1/2 px-1.5 py-0.5 rounded-full text-[9px] font-extrabold leading-none text-accent-fg"
                style={{ transform: 'translateX(-50%)', backgroundColor: 'var(--chart-today)' }}
                dir="rtl"
              >
                היום
              </span>
            </div>
          )}

          {/* Rich crosshair tooltip — date · ROAS · target · delta-vs-target.
              Mirrors the V4 mockup card: glass-2 surface, ink text, the
              delta row tinted green (≥target ▲) / red (<target ▼). */}
          {hoverPoint && (
            <div
              className="absolute"
              style={{ left: `${leftPctForIndex(hoverPoint.index)}%`, top: 0 }}
            >
              <div
                role="tooltip"
                data-testid="chart-hover-tooltip"
                dir="rtl"
                className={cn(
                  // Shared rich-card chrome (matches RichPopover + Toggletip).
                  // pointer-events-none keeps it a passive crosshair readout, so
                  // role="tooltip" is correct (no focusable content inside).
                  'absolute z-10 -translate-x-1/2 w-max min-w-[9.5rem] px-3 py-2 rounded-card',
                  'bg-glass-1 border border-glass-edge shadow-overlay',
                  'text-[12px] text-ink pointer-events-none',
                )}
                style={{ transform: 'translateX(-50%)', top: -84 }}
              >
                <div className="font-bold text-[11px] mb-1">
                  {formatDate(hoverPoint.date)}
                </div>
                <div className="flex items-center justify-between gap-4 leading-relaxed">
                  <span className="text-ink-muted">ROAS</span>
                  <span className="font-bold tabular-nums">{hoverPoint.roas.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between gap-4 leading-relaxed">
                  <span className="text-ink-muted">יעד</span>
                  <span className="font-bold tabular-nums">{target.toFixed(2)}</span>
                </div>
                <div
                  className={cn(
                    'mt-1 pt-1 border-t border-glass-edge flex items-center gap-1 font-bold tabular-nums',
                    hoverPoint.roas >= target
                      ? 'text-[color:var(--up)]'
                      : 'text-[color:var(--dn)]',
                  )}
                >
                  <span aria-hidden>{hoverPoint.roas >= target ? '▲' : '▼'}</span>
                  {hoverPoint.roas >= target ? '+' : ''}
                  {(hoverPoint.roas - target).toFixed(2)} מול היעד
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer ---------------------------------------------------------- */}
      <div
        className="mt-3 pt-3 border-t border-glass-edge flex flex-wrap items-center justify-between gap-3 text-[12px]"
        data-testid="chart-footer"
      >
        <div className="inline-flex items-baseline gap-1.5">
          <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted">
            ROAS תקופה קודמת
          </span>
          <span
            className={cn(
              'tabular-nums font-bold',
              prevPeriod ? 'text-ink' : 'text-ink-subtle',
            )}
          >
            {prevPeriod ? prevPeriod.roas.toFixed(2) : '—'}
          </span>
          {prevPeriod && (
            <span
              className={cn(
                'text-[11px] font-mono tabular-nums',
                kpis.roas >= prevPeriod.roas
                  ? 'text-[color:var(--up)]'
                  : 'text-[color:var(--dn)]',
              )}
            >
              {prevPeriod.roas === 0
                ? ''
                : `${kpis.roas >= prevPeriod.roas ? '+' : ''}${(((kpis.roas - prevPeriod.roas) / prevPeriod.roas) * 100).toFixed(1)}%`}
            </span>
          )}
        </div>
        <span className="text-ink-subtle opacity-40">·</span>
        <div className="inline-flex items-baseline gap-1.5">
          <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted">
            הכנסות שכבר נצברו
          </span>
          <span className="text-ink font-bold tabular-nums">
            {formatCurrency(kpis.revenue)} CAD
          </span>
        </div>
        <span className="text-ink-subtle opacity-40">·</span>
        <div className="inline-flex items-baseline gap-1.5">
          <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted">
            ימי פעילות
          </span>
          <span className="text-ink font-bold tabular-nums">{daysActive}</span>
        </div>
      </div>
    </Card>
  );
}

/* --------------------------------------------------------------------------
 * Internal — KPI tile
 *
 * 5-up tiles inside the card. Only the ROAS tile uses `highlight + chip`;
 * the other four are neutral. Tile chrome matches mockup-04h .rkpi spec.
 * -------------------------------------------------------------------------- */

function KpiTile({
  label,
  value,
  suffix,
  chipClass,
  chipLabel,
  accentClass,
  highlight,
  testId,
}: {
  label: string;
  value: string;
  suffix?: string;
  chipClass?: string;
  chipLabel?: string;
  accentClass?: string;
  highlight?: boolean;
  testId?: string;
}) {
  return (
    <div
      className={cn(
        'px-3 py-3 bg-glass-2 flex flex-col gap-1',
        highlight && 'bg-glass-1',
      )}
      data-testid={testId}
    >
      <span className="text-[10px] uppercase tracking-[0.08em] text-ink-muted font-semibold">
        {label}
      </span>
      <div className="flex items-baseline gap-1.5 flex-wrap">
        <bdi
          dir="ltr"
          className={cn(
            'text-xl sm:text-[1.4rem] font-extrabold tracking-tight tabular-nums leading-none',
            accentClass ?? 'text-ink',
          )}
        >
          {value}
        </bdi>
        {suffix && (
          <span className="text-[10px] font-mono text-ink-subtle">
            {suffix}
          </span>
        )}
        {chipLabel && (
          <span className={cn('band-chip', chipClass)}>{chipLabel}</span>
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Internal helpers — TL;DR rendering + eyebrow text
 * -------------------------------------------------------------------------- */

import type { RoasChartSynthesisResult } from '@/lib/synthesis/roasChart';

function renderTldr(
  synthesis: RoasChartSynthesisResult,
  band: RoasBand,
  roasFallback: number,
  isOrganic = false,
) {
  // FIX #21 — organic period (no ad spend): ROAS is undefined, so the header
  // states the organic fact instead of a misleading "0.00" average.
  if (isOrganic) {
    return (
      <span>
        תקופה אורגנית — אין הוצאת פרסום, לכן אין{' '}
        <span className={cn('font-bold', bandClassForRoas('gray'))}>ROAS</span>{' '}
        משוקלל למדידה.
      </span>
    );
  }
  // Confidence='low' → fall back to a single neutral sentence so the
  // header doesn't lie about a non-existent trend.
  if (synthesis.confidence === 'low' || !synthesis.text) {
    return (
      <span>
        ROAS ממוצע{' '}
        <span
          className={cn('font-bold tabular-nums', bandClassForRoas(band))}
        >
          {roasFallback.toFixed(2)}
        </span>
        . אין מספיק נתונים לזיהוי מגמה.
      </span>
    );
  }

  // Split the sentence around the anchor metric so we can wrap it in a
  // tinted span. The synthesiser guarantees the anchor appears verbatim
  // (1-decimal clamped) somewhere in `text`.
  const anchorStr = synthesis.anchorMetric.toFixed(1);
  const idx = synthesis.text.indexOf(anchorStr);
  if (idx < 0) {
    return <span>{synthesis.text}</span>;
  }
  const before = synthesis.text.slice(0, idx);
  const after = synthesis.text.slice(idx + anchorStr.length);
  return (
    <span>
      {before}
      <span
        className={cn('font-bold tabular-nums', bandClassForRoas(band))}
        data-testid="chart-tldr-accent"
      >
        {anchorStr}
      </span>
      {after}
    </span>
  );
}

function rangeEyebrowHe(
  range: RoasChartRangeKey,
  customRange?: ChartCustomRange,
): string {
  switch (range) {
    case '7':  return '7 ימים אחרונים';
    case '30': return '30 ימים אחרונים';
    case '90': return '90 ימים אחרונים';
    case 'mtd': return 'מתחילת החודש';
    case 'qtd': return 'מתחילת הרבעון';
    case 'ytd': return 'מתחילת השנה';
    case 'custom':
      if (customRange) {
        return `${formatDate(customRange.from)} — ${formatDate(customRange.to)}`;
      }
      return 'טווח מותאם';
    default:
      return '';
  }
}

/* --------------------------------------------------------------------------
 * Re-export the URL helpers so the Dashboard container can seed the
 * initial range from the URL on mount without importing the picker
 * twice.
 * -------------------------------------------------------------------------- */

export { readChartRangeFromUrl, writeChartRangeToUrl };
export type { ChartCustomRange, RoasChartPoint, RoasChartRangeKey };
