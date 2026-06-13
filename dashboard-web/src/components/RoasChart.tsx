'use client';

import { useEffect, useMemo, useRef, useState, type Key } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import { TrendingUp, LineChart as LineChartIcon } from 'lucide-react';
import type { DailySeries } from '@/lib/analytics';
import { formatDate, formatNumber } from '@/lib/utils';
import { storeColor, STORE_COLORS } from '@/lib/storeColors';
import { isHeavyRefundDay } from '@/lib/refundDayHeuristic';
import type { DailyRow } from '@/lib/types';
import { ChartContainer } from '@/components/ui/chart/ChartContainer';
import { StateBlock } from '@/components/ui/StateBlock';
import {
  ChartTooltip,
  ChartTooltipLabel,
  ChartTooltipRow,
  ChartTooltipValue,
} from '@/components/ui/chart/ChartTooltip';
import { CHART_WARNING_COLOR } from '@/lib/chartColors';
import { Heading } from '@/components/ui/Typography';
import { ChartAnnotationPins } from '@/components/ui/ChartAnnotationPins';
import {
  annotationsInScope,
  readAnnotations,
  type Annotation,
} from '@/lib/annotations';
import { annotationsToPins } from '@/lib/home/adapters';

// Recharts plot geometry — kept as named constants so the annotation-pin
// overlay math (which maps a date index → left%) can't drift from the
// <LineChart> margin + <YAxis width> below. The plot's inner band runs from
// `MARGIN_LEFT + Y_AXIS_WIDTH` to `containerWidth − MARGIN_RIGHT`.
const MARGIN_LEFT = 8;
const MARGIN_RIGHT = 12;
const Y_AXIS_WIDTH = 32;
const PLOT_INSET_LEFT = MARGIN_LEFT + Y_AXIS_WIDTH; // 40px
const PLOT_INSET_RIGHT = MARGIN_RIGHT; // 12px

// The cyan primary color is the visual anchor — the first store's line
// gets bold label treatment to guide the eye. Using STORE_COLORS directly
// keeps this sentinel value in sync with the canonical palette.
const PRIMARY_COLOR = STORE_COLORS.uzoshop; // 'var(--chart-store-uzoshop)' — cyan (light) / bright cyan (dark)

function colorFor(name: string, idx: number, brandColorByName?: Record<string, string>) {
  // Self-serve stores Phase 6a — prefer the operator-chosen brand_color token
  // (keyed by display name) over the name-keyed palette. The known 3 backfill
  // to their canonical token, so their lines stay byte-identical; a self-serve
  // store's line draws in its chosen color. Falls back to FALLBACK_PALETTE when
  // the map is empty / has no entry (existing callers pass no map).
  return storeColor(name, idx, brandColorByName?.[name]);
}

type Props = {
  data: DailySeries[];
  stores: string[];
  /**
   * Self-serve stores Phase 6a — optional display-name → `stores.brand_color`
   * token map. When a store has a brand_color, its line/legend swatch render in
   * that color (a self-serve 4th+ store shows its chosen color instead of an
   * arbitrary fallback). Omitted/empty → name-keyed canonical palette (the
   * existing behaviour; the known 3 are unaffected because their backfilled
   * brand_color equals their canonical token).
   */
  brandColorByName?: Record<string, string>;
  /** Raw DailyRow array (same slice that produced `data`). Used to surface
   *  heavy-refund days with an amber dot ring and tooltip refund line. */
  rows: DailyRow[];
  /** When true, render only the chart with no surrounding card/title.
   *  Used when wrapped in a CollapsibleSection that already provides the title. */
  bare?: boolean;
  /** Active date range — scopes which logged annotations show as pins.
   *  Matches the AnnotationsPanel's `annotationsInScope(items, range, store)`.
   *  Omit to suppress pins (back-compat for callers without filter context). */
  range?: { from: string; to: string };
  /** Active store filter ("All" or a store name) — same scope contract as
   *  the AnnotationsPanel. Defaults to "All" when a `range` is given. */
  store?: string;
};

export function RoasChart({ data, stores, rows, bare = false, range, store = 'All', brandColorByName }: Props) {
  // Build an O(1) lookup Set for heavy-refund (date|store) keys so the
  // dot renderer and tooltip body can check cheaply without filtering.
  const refundDayKeys = useMemo(() => {
    const set = new Set<string>(); // key: "YYYY-MM-DD|storeName"
    for (const r of rows) {
      if (isHeavyRefundDay(r)) set.add(`${r.date}|${r.storeName}`);
    }
    return set;
  }, [rows]);

  // Annotation pins — read the SAME store the AnnotationsPanel writes to and
  // re-read on the `roas-annotations-changed` event so a freshly-logged event
  // appears on the chart without a reload. Single source of truth: the pins
  // are converted via the shared `annotationsToPins` adapter (same as the hero
  // RoasTargetChart) and rendered with the shared <ChartAnnotationPins>.
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  useEffect(() => {
    setAnnotations(readAnnotations());
    const onChange = () => setAnnotations(readAnnotations());
    window.addEventListener('roas-annotations-changed', onChange);
    return () => window.removeEventListener('roas-annotations-changed', onChange);
  }, []);
  const pins = useMemo(() => {
    if (!range) return [];
    return annotationsToPins(annotationsInScope(annotations, range, store));
  }, [annotations, range, store]);

  // Measure the plot wrapper width so the overlay can convert a date index →
  // left% against Recharts' inner plot band (which is inset by the YAxis +
  // margins). A ResizeObserver keeps the pins glued to their day on resize.
  const plotRef = useRef<HTMLDivElement | null>(null);
  const [plotWidth, setPlotWidth] = useState(0);
  useEffect(() => {
    const el = plotRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? el.clientWidth;
      setPlotWidth(w);
    });
    ro.observe(el);
    setPlotWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  if (!data.length) {
    // No series points in the active scope. Previously returned `null`, which
    // left the parent's bare card frame empty (a confusing blank panel). Render
    // the shared <StateBlock mode="empty"> so the operator gets a clear "no
    // data in range" message instead of dead space — in both the bare and
    // standalone (titled-section) layouts.
    const empty = (
      <StateBlock
        mode="empty"
        icon={<LineChartIcon aria-hidden="true" />}
        description="אין נתוני ROAS בטווח שבחרת. שנה את הטווח או הסינון למעלה."
      />
    );
    if (bare) return <div className="p-3 sm:p-5">{empty}</div>;
    return (
      <section className="rounded-hz glass bg-clip-border p-3 sm:p-5">
        <Heading level="section" className="flex items-center gap-2 mb-3 sm:mb-4">
          <TrendingUp size={18} className="text-ink-secondary" />
          מגמת ROAS לאורך זמן
        </Heading>
        {empty}
      </section>
    );
  }
  const chartData = data.map(d => ({
    date: d.date,
    dateLabel: formatDate(d.date).slice(0, 5), // DD/MM
    ...d.byStore,
  }));

  const dates = data.map(d => d.date);

  // index → overlay left% across the FULL wrapper width. The plot band sits
  // between PLOT_INSET_LEFT and (width − PLOT_INSET_RIGHT); a single point
  // centres on the band. Falls back to a flat band-edge estimate before the
  // first width measurement (pins still render, just re-snap on the next tick).
  const leftPctForIndex = (idx: number): number => {
    const w = plotWidth > 0 ? plotWidth : 0;
    if (w <= 0) {
      // Pre-measure fallback: spread evenly across [0,100] so SSR / first
      // paint isn't blank; ResizeObserver corrects it on mount.
      return dates.length <= 1 ? 50 : (idx / (dates.length - 1)) * 100;
    }
    const bandLeft = PLOT_INSET_LEFT;
    const bandWidth = Math.max(1, w - PLOT_INSET_LEFT - PLOT_INSET_RIGHT);
    const frac = dates.length <= 1 ? 0.5 : idx / (dates.length - 1);
    return ((bandLeft + frac * bandWidth) / w) * 100;
  };

  // ISO date → that day's blended ROAS, for the pin tooltip context line.
  const roasForDate = (date: string): number | null => {
    const row = data.find(d => d.date === date);
    const v = row?.totalRoas;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };

  const chart = (
    <div className="space-y-3">
      {/* Custom legend — RTL-aware, tabular spacing, distinguishes the
          dominant brand series from the muted neutrals so the eye anchors
          to the primary line. */}
      <div className="flex items-center justify-end gap-3 sm:gap-4 flex-wrap text-fs-2xs sm:text-fs-xs">
        {stores.map((s, i) => {
          const color = colorFor(s, i, brandColorByName);
          const isPrimary = color === PRIMARY_COLOR;
          return (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block w-3.5 h-[3px] rounded-sm shrink-0"
                style={{ backgroundColor: color }}
              />
              <span className={isPrimary ? 'font-semibold text-ink' : 'text-ink-secondary'}>
                {s}
              </span>
            </span>
          );
        })}
        <span className="inline-flex items-center gap-1.5 ms-auto sm:ms-2">
          <span
            className="inline-block w-3 h-[2px] border-t border-dashed shrink-0"
            style={{ borderTopColor: 'var(--chart-target-line)' }}
          />
          <span className="text-ink-muted">יעד 3.0</span>
        </span>
      </div>

      {/* Relative plot wrapper — hosts the Recharts surface AND the shared
          annotation-pin overlay. `plotRef` is measured so the overlay can map
          a date index → left% against the inset plot band. */}
      <div ref={plotRef} className="relative">
      <ChartContainer className="h-64 sm:h-80" height="100%">
        <LineChart data={chartData} margin={{ top: 10, right: MARGIN_RIGHT, left: MARGIN_LEFT, bottom: 0 }}>
            {/* Very quiet grid — guidance, not decoration. */}
            <CartesianGrid strokeDasharray="2 4" stroke="var(--chart-grid)" strokeOpacity={0.55} vertical={false} />
            <XAxis
              dataKey="dateLabel"
              tick={{ fontSize: 11, fill: 'var(--chart-axis)', fontVariant: 'tabular-nums' }}
              axisLine={false}
              tickLine={false}
              tickMargin={6}
            />
            <YAxis
              tick={{ fontSize: 11, fill: 'var(--chart-axis)', fontVariant: 'tabular-nums' }}
              axisLine={false}
              tickLine={false}
              domain={[0, 'auto']}
              width={Y_AXIS_WIDTH}
              tickFormatter={v => (Number.isInteger(v) ? String(v) : v.toFixed(1))}
            />
            <ReferenceLine
              y={3}
              stroke="var(--chart-target)"
              strokeDasharray="4 4"
              strokeOpacity={0.55}
              strokeWidth={1.5}
            />
            <Tooltip
              cursor={{ stroke: 'var(--chart-cursor)', strokeWidth: 1, strokeDasharray: '3 3' }}
              content={({ active, payload }) => {
                if (!active || !payload || payload.length === 0) return null;
                const date = payload[0].payload.date as string;
                return (
                  <ChartTooltip>
                    <ChartTooltipLabel>{formatDate(date)}</ChartTooltipLabel>
                    <ul className="space-y-0.5">
                      {payload.map(entry => {
                        const v = Number(entry.value);
                        if (!Number.isFinite(v)) return null;
                        return (
                          <li key={String(entry.dataKey)}>
                            {/* c/HI-04: prefix the value with the unit label
                                ("ROAS") so the tooltip is self-describing.
                                Previously the tooltip rendered a bare number
                                like "2.85" which an operator briefly hovering
                                could mistake for CAD or another metric.
                                Matches HeroOverview's pattern. */}
                            <ChartTooltipRow color={entry.color as string} label={String(entry.dataKey)}>
                              ROAS{' '}
                              <ChartTooltipValue>{formatNumber(v)}</ChartTooltipValue>
                            </ChartTooltipRow>
                          </li>
                        );
                      })}
                    </ul>
                    {(() => {
                      let refundSum = 0;
                      let anyHeavy = false;
                      for (const entry of payload) {
                        const storeName = entry.dataKey as string;
                        const row = rows.find(r => r.date === date && r.storeName === storeName);
                        if (row?.refundDeduction) refundSum += row.refundDeduction;
                        if (refundDayKeys.has(`${date}|${storeName}`)) anyHeavy = true;
                      }
                      if (!anyHeavy || refundSum <= 0) return null;
                      return (
                        <div className="mt-1 pt-1 border-t border-status-orange text-xs text-status-orangeFg">
                          ↩ יום רפאנד כבד — החזרים: -CAD{' '}
                          <ChartTooltipValue className="font-normal text-status-orangeFg">
                            {Math.round(refundSum).toLocaleString('he-IL')}
                          </ChartTooltipValue>
                          . ה-ROAS משקף את הנטו.
                        </div>
                      );
                    })()}
                  </ChartTooltip>
                );
              }}
            />
            {stores.map((s, i) => {
              const color = colorFor(s, i, brandColorByName);
              const isPrimary = color === PRIMARY_COLOR;
              return (
                <Line
                  key={s}
                  type="monotone"
                  dataKey={s}
                  stroke={color}
                  // Mild hierarchy via stroke weight only — opacity stays full
                  // for every line so each store stays clearly visible.
                  strokeWidth={isPrimary ? 2.75 : 2}
                  dot={(props: { cx?: number; cy?: number; payload?: { date?: string }; key?: Key | null }) => {
                    const date = props.payload?.date;
                    if (!date || props.cx == null || props.cy == null) return <g key={props.key} />;
                    const isHeavy = refundDayKeys.has(`${date}|${s}`);
                    if (!isHeavy) return <g key={props.key} />;
                    return (
                      <g key={props.key}>
                        <circle cx={props.cx} cy={props.cy} r={5} fill={color} />
                        <circle
                          cx={props.cx}
                          cy={props.cy}
                          r={8}
                          fill="transparent"
                          // Heavy-refund-day warning ring. Routes through
                          // chartColors.ts (CHART_WARNING_COLOR) so the
                          // `local/no-cross-palette-import` rule stays
                          // green — chart files cannot directly consume
                          // --band-* / --status-* (see Q1 in v2 plan).
                          stroke={CHART_WARNING_COLOR}
                          strokeWidth={2}
                        />
                      </g>
                    );
                  }}
                  activeDot={{ r: isPrimary ? 5 : 4, strokeWidth: 0 }}
                  // Audit fix 2026-05-23 (CRIT-3 + HIGH-8): missing
                  // (store, day) cells now flow through as `null` from
                  // `dailySeries`. We must NOT bridge those nulls — the
                  // gap IS the honest signal. Same pattern as HeroOverview's
                  // RoasTrendChart (v2 c/CR-03).
                  connectNulls={false}
                />
              );
            })}
        </LineChart>
      </ChartContainer>

      {/* Annotation pins — same pipeline as the hero RoasTargetChart. Guides
          ON because Recharts can't draw the dashed verticals for us here. The
          pins are absolutely positioned over the plot band; they only render
          when their date falls inside the active range. */}
      <ChartAnnotationPins
        pins={pins}
        dates={dates}
        leftPctForIndex={leftPctForIndex}
        valueForDate={roasForDate}
        valueLabel="ROAS"
        showGuides
      />
      </div>
    </div>
  );

  if (bare) return <div className="p-3 sm:p-5">{chart}</div>;

  return (
    <section className="rounded-hz glass bg-clip-border p-3 sm:p-5">
      <Heading level="section" className="flex items-center gap-2 mb-3 sm:mb-4">
        <TrendingUp size={18} className="text-ink-secondary" />
        מגמת ROAS לאורך זמן
      </Heading>
      {chart}
    </section>
  );
}
