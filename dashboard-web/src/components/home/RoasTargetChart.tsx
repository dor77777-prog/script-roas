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
import { Button } from '@/components/ui/Button';
import { FreshnessBadge } from '@/components/ui/FreshnessBadge';
import { Heading } from '@/components/ui/Typography';
import { cn, formatCurrency, formatNumber, formatDate } from '@/lib/utils';
import {
  useRoasBandGradient,
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
const Y_MAX = 4;              // gridlines at 1.0 / 2.0 / 3.0 / 4.0
const TARGET_Y_DEFAULT = 3.0;

/* --------------------------------------------------------------------------
 * Helpers — kept inline so the component is single-file readable.
 * -------------------------------------------------------------------------- */

function bandClassForRoas(band: RoasBand): string {
  // The KPI tile tint matches the chart band — pulls colour from the same
  // CSS variables that <Card data-band> uses, so the two never diverge.
  switch (band) {
    case 'red':    return 'text-status-red';
    case 'orange': return 'text-status-warning';
    case 'green':  return 'text-status-green';
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

function bandLabelHe(band: RoasBand): string {
  switch (band) {
    case 'red':    return 'מתחת ליעד';
    case 'orange': return 'דורש מעקב';
    case 'green':  return 'סביב היעד';
    case 'blue':   return 'מעל יעד';
    case 'gray':
    default:       return 'אין נתונים';
  }
}

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
  // Single `openPinId` — hover sets it, click toggles it, document-level
  // click clears it. Per [[home-visual-rules]] pin tooltips are NEVER
  // always-visible.
  const [openPinId, setOpenPinId] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Dismiss-on-click-outside (touch-friendly). The pointerdown listener
  // fires before click, so a tap on a pin still toggles the right one.
  useEffect(() => {
    if (openPinId === null) return;
    const handler = (e: MouseEvent | PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      const wrap = wrapRef.current;
      if (!wrap) return;
      // If click landed outside the chart-wrap, close. We can't trust
      // `closest('.pin-anchor')` here because the pointer might land on a
      // sibling pin — handled inside the pin's onClick.
      if (!wrap.contains(target)) {
        setOpenPinId(null);
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [openPinId]);

  /* --- derived ----------------------------------------------------------- */
  const { points, pins, kpis, prevPeriod, daysActive } = data;
  const synthesis = useMemo(
    () => synthesizeRoasChart({ points, range, target }),
    [points, range, target],
  );
  const minMax = useMemo(() => findMinMax(points), [points]);
  const roasBand = useRoasBandGradient(kpis.roas).band;
  const accentBand: RoasBand =
    synthesis.confidence === 'high' ? synthesis.band : roasBand;

  // SVG path for the daily ROAS line — skip null-roas segments.
  const linePath = useMemo(() => {
    if (points.length === 0) return '';
    const segments: string[] = [];
    let penDown = false;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (p.roas == null || Number.isNaN(p.roas)) {
        penDown = false;
        continue;
      }
      const x = xForIndex(i, points.length);
      const y = yForRoas(p.roas);
      segments.push(`${penDown ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`);
      penDown = true;
    }
    return segments.join(' ');
  }, [points]);

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
            {renderTldr(synthesis, accentBand, kpis.roas)}
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
                'bg-status-warningBg text-status-warning border border-status-warning/30',
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
          value={`${kpis.roas.toFixed(2)}x`}
          chipClass={chipClassForBand(accentBand)}
          chipLabel={bandLabelHe(accentBand)}
          accentClass={bandClassForRoas(accentBand)}
          highlight
          testId="chart-kpi-roas"
        />
        <KpiTile label="הוצאת פרסום" value={formatCurrency(kpis.spend)} suffix="CAD" />
        <KpiTile label="רווח תפעולי" value={formatCurrency(kpis.netProfit)} suffix="CAD" />
        <KpiTile label="CPM" value={formatNumber(kpis.cpm, 2)} suffix="CAD" />
      </div>

      {/* Legend + min/max ------------------------------------------------ */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1.5 px-1 text-[11px] text-ink-muted">
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-1.5 font-mono tracking-wide">
            <span className="inline-block w-4 h-0.5 bg-ink rounded-sm" />
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
          viewBox={`0 0 ${VB_WIDTH} ${VB_HEIGHT}`}
          preserveAspectRatio="none"
          width="100%"
          height="200"
          className="block"
          role="img"
          aria-label={synthesis.text || 'גרף ROAS יומי מול יעד'}
          data-testid="chart-svg"
        >
          {/* Gridlines at integer ROAS values */}
          {[Y_MAX, 3, 2, 1].map((v) => (
            <line
              key={`grid-${v}`}
              x1={PADDING_LEFT}
              x2={VB_WIDTH}
              y1={yForRoas(v)}
              y2={yForRoas(v)}
              style={{ stroke: 'var(--chart-grid-line)', strokeWidth: 1 }}
            />
          ))}

          {/* Y-axis labels */}
          {[Y_MAX, 3, 2, 1].map((v) => (
            <text
              key={`yl-${v}`}
              x={0}
              y={yForRoas(v) + 4}
              style={{
                fontFamily: 'var(--font-mono, ui-monospace)',
                fontSize: 10,
                fill: 'var(--text-subtle, oklch(48% 0.020 250))',
              }}
            >
              {v.toFixed(1)}
            </text>
          ))}

          {/* Target line */}
          <line
            x1={PADDING_LEFT}
            x2={VB_WIDTH}
            y1={yForRoas(target)}
            y2={yForRoas(target)}
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

          {/* ROAS line */}
          {linePath && (
            <path
              d={linePath}
              fill="none"
              style={{
                stroke: 'var(--chart-roas-line)',
                strokeWidth: 2,
              }}
              data-testid="chart-roas-line"
            />
          )}

          {/* Data dots */}
          {points.map((p, i) => {
            if (p.roas == null || Number.isNaN(p.roas)) return null;
            const x = xForIndex(i, points.length);
            const y = yForRoas(p.roas);
            const isMax = minMax.max?.index === i;
            const isMin = minMax.min?.index === i;
            const fill = isMax
              ? 'var(--chart-dot-max)'
              : isMin
                ? 'var(--chart-dot-min)'
                : 'var(--chart-roas-line)';
            const r = isMax || isMin ? 3 : 2.5;
            return (
              <circle
                key={`dot-${i}`}
                cx={x}
                cy={y}
                r={r}
                style={{ fill }}
              >
                <title>
                  {`${formatDate(p.date)} · ROAS ${p.roas.toFixed(2)}`}
                </title>
              </circle>
            );
          })}

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
                fill: 'var(--text-subtle, oklch(48% 0.020 250))',
              }}
            >
              {l.text}
            </text>
          ))}
        </svg>

        {/* Pins overlay --------------------------------------------------- */}
        {/* RTL note: pins are positioned via `left:` percentages on a wrapper
            with explicit `dir="ltr"` so the percentage is measured from the
            SVG's visual-left edge regardless of the page's text direction.
            Without this, RTL flips the % anchor and the pin lands on the
            wrong day. */}
        <div
          className="absolute inset-0 pointer-events-none"
          dir="ltr"
        >
          {renderablePins.map(({ pin, leftPct }) => {
            const isOpen = openPinId === pin.id;
            return (
              <div
                key={pin.id}
                className="absolute"
                style={{ left: `${leftPct}%`, top: 0 }}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-testid={`chart-pin-${pin.id}`}
                  aria-label={pin.label}
                  aria-expanded={isOpen}
                  onMouseEnter={() => setOpenPinId(pin.id)}
                  onMouseLeave={() => setOpenPinId((prev) => (prev === pin.id ? null : prev))}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenPinId((prev) => (prev === pin.id ? null : pin.id));
                  }}
                  className={cn(
                    'pointer-events-auto absolute p-0 h-auto bg-transparent hover:bg-transparent',
                    'text-lg leading-none cursor-pointer rounded-sm',
                  )}
                  style={{
                    transform: 'translateX(-50%)',
                    top: -6,
                    textShadow: '0 0 8px oklch(from var(--chart-pin-line) l c h / 0.7)',
                  }}
                >
                  {pin.icon ?? '💰'}
                </Button>
                {isOpen && (
                  <div
                    role="tooltip"
                    data-testid={`chart-pin-tooltip-${pin.id}`}
                    className={cn(
                      'absolute z-10 whitespace-nowrap text-[11px] text-ink px-2.5 py-1 rounded-md',
                      'bg-glass-2 backdrop-blur-md border border-status-warning/30 shadow-overlay',
                      // Wave-6 Task 6.1 — pin tooltip entrance: 120 ms
                      // opacity + ~4 px Y translate via tailwindcss-animate.
                      // slide-in-from-bottom-1 = 0.25 rem (4 px) — see the
                      // plugin's CSS-var-driven utility. prefers-reduced-motion
                      // (Task 6.2) collapses the keyframe to instant via the
                      // targeted `[role="tooltip"]` rule in globals.css.
                      'animate-in fade-in-0 slide-in-from-bottom-1 duration-snap ease-out',
                    )}
                    style={{ transform: 'translateX(-50%)', top: -44 }}
                    dir="rtl"
                  >
                    <span className="me-1" aria-hidden>{pin.icon ?? '💰'}</span>
                    {pin.label}
                  </div>
                )}
              </div>
            );
          })}
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
                  ? 'text-status-green'
                  : 'text-status-red',
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
) {
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
