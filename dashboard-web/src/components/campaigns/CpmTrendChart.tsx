'use client';

/**
 * Horizon re-skin Wave 4 (debt #6) — the ONE CPM-vs-ROAS trend chart.
 *
 * Consolidates two near-identical inline implementations that had begun to
 * diverge (margins / right-axis / plot-scrim):
 *   - CampaignsTable.tsx  (the summary-strip CPM expander)
 *   - campaign-drawer/CampaignDrawerDaily.tsx  (Daily sub-tab, section 2)
 *
 * The shared MATH was already extracted to `lib/cpmRoasAnalysis.ts`
 * (`analyzeCpmVsRoas`, `indexPrevByDateOffset`, `dayOffsetFromRangeStart`);
 * this component lifts the remaining duplicated RENDER/JSX into a single
 * source. Behavior is byte-identical to the pre-split blocks:
 *   - same `analyzeCpmVsRoas(cur, mode==='prev' ? {prev} : undefined)` call,
 *   - same calendar-offset prev pairing (`indexPrevByDateOffset` keyed on
 *     `prevRange.from`; `dayOffsetFromRangeStart` keyed on `range.from`),
 *   - same ROAS-overlay toggle, same tone-coded verdict box, same FIX-19
 *     half-over-half fallback banner, same legend swatches, same tooltip.
 *
 * Horizon re-skin applied on top:
 *   - baseline pill-toggle → shared `<SegmentedControl>` (kills the 3rd
 *     hand-rolled segmented control),
 *   - sub-floor px text literals → `text-fs-2xs` ramp token (the floor),
 *   - both charts now draw on the neutral plot scrim ChartContainer
 *     (`bg-glass-2/40 border border-glass-edge` + operator min-h) so the
 *     CPM/ROAS series ink stays legible on any colored card, both themes,
 *   - reduced-motion gates the animated CPM/ROAS strokes.
 *
 * The Y-axis tick formatters stay RAW (`C$${…}`) — they are axis ticks, not
 * money cells, and are allowlisted in moneyPrimitiveGuard accordingly.
 */

import { useState, type ReactNode } from 'react';
import {
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Heading } from '@/components/ui/Typography';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ChartContainer } from '@/components/ui/chart/ChartContainer';
import {
  ChartTooltip,
  ChartTooltipLabel,
  ChartTooltipRow,
  ChartTooltipValue,
} from '@/components/ui/chart/ChartTooltip';
import { X } from 'lucide-react';
import { CHART_AXIS_COLOR, CHART_COLORS } from '@/lib/chartColors';
import {
  analyzeCpmVsRoas,
  dayOffsetFromRangeStart,
  indexPrevByDateOffset,
  PREV_PERIOD_MIN_DAYS,
  type DailyCpmRoasPoint,
} from '@/lib/cpmRoasAnalysis';
import { useReducedMotion } from '@/lib/hooks/useReducedMotion';
import { cn, formatCurrency, formatDate, formatNumber } from '@/lib/utils';

/** Current-period day point — both call-sites build this exact shape. */
export interface CpmTrendPoint {
  date: string;
  cpm: number;
  roas: number;
  impressions: number;
  spend: number;
  value?: number;
}

export interface CpmTrendChartProps {
  /** Current-period CPM/ROAS daily series (pre-filtered, impressions>0). */
  cpmDaily: CpmTrendPoint[];
  /** Previous-period CPM/ROAS daily series (null/undefined when mode='half'
   *  or before the prev fetch resolves). */
  cpmDailyPrev: DailyCpmRoasPoint[] | null | undefined;
  /** Current visible date range. */
  range: { from: string; to: string };
  /** Equally-long window immediately before `range` (drives the baseline
   *  label + the calendar-offset prev pairing). */
  prevRange: { from: string; to: string };
  /** Parenthetical scope text rendered after the "CPM לאורך זמן" heading
   *  (e.g. "(כל החנויות · Meta, CAD)" or "(עלות ל-1000 חשיפות, CAD)"). */
  scopeLabel?: ReactNode;
  /** Baseline mode (controlled): 'half' = first vs second half of range;
   *  'prev' = vs the equally-long previous period. */
  mode: 'half' | 'prev';
  onModeChange: (mode: 'half' | 'prev') => void;
  /** True while the 'prev' fetch is still resolving — gates the FIX-19
   *  fallback banner (WR-01) and the verdict-box loading note. */
  isLoadingPrev?: boolean;
  /** Initial ROAS-overlay checkbox state (default false). */
  showRoasDefault?: boolean;
  /** Optional leading heading icon (drawer passes <TrendingUp/>). */
  headingIcon?: ReactNode;
  /** When provided, renders a close (X) button in the header
   *  (CampaignsTable's expander; the drawer omits it). */
  onClose?: () => void;
}

export function CpmTrendChart({
  cpmDaily,
  cpmDailyPrev,
  range,
  prevRange,
  scopeLabel,
  mode,
  onModeChange,
  isLoadingPrev = false,
  showRoasDefault = false,
  headingIcon,
  onClose,
}: CpmTrendChartProps) {
  const [showRoas, setShowRoas] = useState(showRoasDefault);
  // Reduced-motion: skip Recharts' draw-in on the CPM + ROAS strokes when
  // the user opts out of motion (the dashed prev line is already static).
  const reduced = useReducedMotion();

  // ── analysis ──────────────────────────────────────────────────────────
  // Identical call to the pre-split blocks: pass the prev series ONLY when
  // the operator toggled 'prev' AND we have rows.
  const analysis = analyzeCpmVsRoas(
    cpmDaily.map(d => ({ date: d.date, cpm: d.cpm, roas: d.roas })),
    mode === 'prev' && cpmDailyPrev ? { prev: cpmDailyPrev } : undefined,
  );

  const toneBg: Record<typeof analysis.tone, string> = {
    positive: 'bg-status-greenBg border-status-green text-status-greenFg',
    warning: 'bg-status-warningBg border-status-warning text-status-warningFg',
    negative: 'bg-status-redBg border-status-red text-status-redFg',
    neutral: 'bg-glass-2 border-glass-edge text-ink-secondary',
  };

  // ── baseline label (actual date windows) ──────────────────────────────
  const fmtRangeShort = (from: string, to: string) => {
    const f = from.slice(5).replace('-', '/');
    const t = to.slice(5).replace('-', '/');
    return `${f}—${t}`;
  };
  const halfMidIdx = Math.floor(cpmDaily.length / 2);
  const firstHalfDates = cpmDaily.length >= 4
    ? `${cpmDaily[0].date.slice(5).replace('-', '/')}—${cpmDaily[halfMidIdx - 1].date.slice(5).replace('-', '/')}`
    : '';
  const secondHalfDates = cpmDaily.length >= 4
    ? `${cpmDaily[halfMidIdx].date.slice(5).replace('-', '/')}—${cpmDaily[cpmDaily.length - 1].date.slice(5).replace('-', '/')}`
    : '';
  const baselineLabel = analysis.mode === 'previous-period'
    ? `השוואה: ${fmtRangeShort(range.from, range.to)} מול ${fmtRangeShort(prevRange.from, prevRange.to)} (תקופה קודמת באותו אורך)`
    : firstHalfDates && secondHalfDates
    ? `השוואה: חצי שני (${secondHalfDates}) מול חצי ראשון (${firstHalfDates})`
    : 'השוואה: חצי שני vs חצי ראשון של הטווח';

  // ── chart data — calendar-offset prev pairing ─────────────────────────
  // "day 0 of current pairs with day 0 of prev", regardless of which days
  // got filtered out for zero impressions (guards c/CR-01).
  const prevByOffset = indexPrevByDateOffset(cpmDailyPrev, prevRange.from);
  const cpmChartData = cpmDaily.map(d => {
    const offset = dayOffsetFromRangeStart(d.date, range.from);
    const prev = prevByOffset.get(offset);
    return {
      ...d,
      prevCpm: prev?.cpm ?? null,
      prevDate: prev?.date ?? null,
    };
  });
  const showPrevLine = mode === 'prev' && !isLoadingPrev && (cpmDailyPrev?.length ?? 0) > 0;

  return (
    <div className="mt-3 rounded-lg bg-glass-1 border border-glass-edge p-3">
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <Heading level="panel" className="inline-flex items-center gap-1.5 text-xs sm:text-sm">
          {headingIcon}
          CPM לאורך זמן
          {scopeLabel != null && (
            <span className="text-fs-2xs font-medium text-ink-muted">
              {scopeLabel}
            </span>
          )}
        </Heading>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Analysis baseline toggle — picks what the smart-analysis box
              compares against. Horizon SegmentedControl (radiogroup: a
              single-choice form control, no associated content panel). */}
          <SegmentedControl
            role="radiogroup"
            size="sm"
            aria-label="בסיס השוואה לניתוח CPM"
            value={mode}
            onChange={v => onModeChange(v as 'half' | 'prev')}
            options={[
              { value: 'half', label: 'חצי-חצי' },
              { value: 'prev', label: 'vs תקופה קודמת' },
            ]}
            data-testid="cpm-trend-mode"
          />
          <label className="inline-flex items-center gap-1.5 text-xs text-ink-secondary cursor-pointer select-none">
            <Input
              type="checkbox"
              checked={showRoas}
              onChange={e => setShowRoas(e.target.checked)}
              className="rounded border-glass-edge text-accent focus:ring-accent cursor-pointer"
              data-testid="cpm-trend-roas-toggle"
            />
            הוסף ROAS לגרף
          </label>
          {onClose && (
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              className="h-auto p-0 text-xs text-ink-muted hover:text-ink"
              aria-label="סגור"
            >
              <X size={12} aria-hidden />
            </Button>
          )}
        </div>
      </div>
      {/* Neutral plot scrim + casing: the CPM/ROAS series ink draws on a
          glass-2 sub-surface with a hairline border (operator min-h so the
          line never squishes inside a modal) so the band-tinted line never
          collides with a colored card, in both themes. */}
      <ChartContainer
        className="h-40 sm:h-48 min-h-[200px] rounded-xl bg-glass-2/40 border border-glass-edge p-2"
        height="100%"
      >
        <LineChart data={cpmChartData} margin={{ top: 8, right: showRoas ? 56 : 16, left: 4, bottom: 0 }}>
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: CHART_AXIS_COLOR }}
            tickLine={false}
            axisLine={false}
            tickFormatter={d => {
              const m = String(d).match(/^\d{4}-(\d{2})-(\d{2})/);
              return m ? `${m[2]}/${m[1]}` : String(d);
            }}
            padding={{ left: 12, right: 12 }}
          />
          <YAxis
            yAxisId="cpm"
            tick={{ fontSize: 10, fill: CHART_AXIS_COLOR }}
            tickLine={false}
            axisLine={false}
            tickFormatter={v => `C$${Number(v).toFixed(2)}`}
            width={68}
            // c/CR-02: zero-anchored Y axis. CPM is always >= 0; suppressing
            // the origin turns a 3% change into a chart-height-spanning curve
            // (the textbook misleading-axis pattern).
            domain={[0, (dataMax: number) => dataMax * 1.12]}
            allowDecimals
          />
          {showRoas && (
            <YAxis
              yAxisId="roas"
              orientation="right"
              tick={{ fontSize: 10, fill: CHART_COLORS.roas }}
              tickLine={false}
              axisLine={false}
              tickFormatter={v => Number(v).toFixed(2)}
              width={42}
              // c/CR-02: same zero-anchor rule for the ROAS overlay.
              domain={[0, (dataMax: number) => dataMax * 1.12]}
              allowDecimals
            />
          )}
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null;
              const d = payload[0].payload as {
                date: string;
                cpm: number;
                impressions: number;
                spend: number;
                roas: number;
                prevCpm: number | null;
                prevDate: string | null;
              };
              const prevDeltaPct = (showPrevLine && d.prevCpm != null && d.prevCpm > 0)
                ? ((d.cpm - d.prevCpm) / d.prevCpm) * 100
                : null;
              return (
                <ChartTooltip className="tabular-nums">
                  <ChartTooltipLabel>{formatDate(d.date)}</ChartTooltipLabel>
                  <ChartTooltipRow color={CHART_COLORS.cpm} label="CPM">
                    CAD <ChartTooltipValue>{formatCurrency(d.cpm, 2)}</ChartTooltipValue>
                  </ChartTooltipRow>
                  {showRoas && (
                    <ChartTooltipRow color={CHART_COLORS.roas} label="ROAS">
                      <ChartTooltipValue>{formatNumber(d.roas, 2)}</ChartTooltipValue>
                    </ChartTooltipRow>
                  )}
                  {showPrevLine && d.prevCpm != null && (
                    <div className="mt-1 pt-1 border-t border-glass-edge">
                      <div className="text-ink-muted text-fs-2xs mb-0.5">
                        תקופה קודמת{d.prevDate ? ` (${formatDate(d.prevDate)})` : ''}:
                      </div>
                      <ChartTooltipRow color={CHART_COLORS.cpmPrev} label="CPM">
                        CAD <ChartTooltipValue>{formatCurrency(d.prevCpm, 2)}</ChartTooltipValue>
                        {prevDeltaPct != null && (
                          <span className={cn(
                            'ms-1.5 text-fs-2xs font-semibold',
                            prevDeltaPct < 0 ? 'text-status-greenFg' : prevDeltaPct > 0 ? 'text-status-redFg' : 'text-ink-muted',
                          )}>
                            ({prevDeltaPct > 0 ? '+' : ''}{prevDeltaPct.toFixed(1)}%)
                          </span>
                        )}
                      </ChartTooltipRow>
                    </div>
                  )}
                  <div className="text-ink-muted text-fs-2xs mt-1">
                    {formatNumber(d.impressions, 0)} חשיפות · CAD {formatCurrency(d.spend, 2)}
                  </div>
                </ChartTooltip>
              );
            }}
          />
          <Line
            yAxisId="cpm"
            type="monotone"
            dataKey="cpm"
            stroke={CHART_COLORS.cpm}
            strokeWidth={1.75}
            dot={{ r: 2.5, fill: CHART_COLORS.cpm, stroke: 'none' }}
            activeDot={{ r: 4, fill: CHART_COLORS.cpm, stroke: 'var(--surface-elevated-1)', strokeWidth: 1.5 }}
            isAnimationActive={!reduced}
          />
          {showPrevLine && (
            <Line
              yAxisId="cpm"
              type="monotone"
              dataKey="prevCpm"
              stroke={CHART_COLORS.cpmPrev}
              strokeWidth={1.5}
              strokeDasharray="5 3"
              strokeOpacity={0.85}
              dot={{ r: 2, fill: CHART_COLORS.cpmPrev, stroke: 'none', fillOpacity: 0.7 }}
              activeDot={{ r: 3.5, fill: CHART_COLORS.cpmPrev, stroke: 'var(--surface-elevated-1)', strokeWidth: 1.5 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          )}
          {showRoas && (
            <Line
              yAxisId="roas"
              type="monotone"
              dataKey="roas"
              stroke={CHART_COLORS.roas}
              strokeWidth={1.75}
              strokeDasharray="5 3"
              dot={{ r: 2.5, fill: CHART_COLORS.roas, stroke: 'none' }}
              activeDot={{ r: 4, fill: CHART_COLORS.roas, stroke: 'var(--surface-elevated-1)', strokeWidth: 1.5 }}
              isAnimationActive={!reduced}
            />
          )}
        </LineChart>
      </ChartContainer>
      {(showRoas || showPrevLine) && (
        <div className="flex items-center justify-center gap-4 text-fs-2xs text-ink-muted mt-1.5 flex-wrap">
          <span className="inline-flex items-center gap-1.5">
            {/* CPM swatch tracks CHART_COLORS.cpm (token-driven) so the
                legend stays in sync with the chart line in both themes. */}
            <span className="inline-block w-3 h-[2px]" style={{ background: CHART_COLORS.cpm }} />
            CPM {showRoas ? '(ציר שמאל)' : ''}
          </span>
          {showPrevLine && (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-3 border-t-2 border-dashed border-status-warning" />
              CPM תקופה קודמת
            </span>
          )}
          {showRoas && (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-3 border-t-2 border-dashed border-status-green" />
              ROAS (ציר ימין)
            </span>
          )}
        </div>
      )}
      {mode === 'prev' && !isLoadingPrev && analysis.mode === 'half-over-half' && (
        <div className="text-fs-2xs text-status-warningFg bg-status-warningBg px-2 py-1 rounded mt-1" data-testid="cpm-trend-fallback-banner">
          {/* FIX-19 (5.2.2.1): fallback disclosure when the previous period had
              fewer than PREV_PERIOD_MIN_DAYS active days. Gated by
              !isLoadingPrev (WR-01) so the banner doesn't fire prematurely
              while the prev fetch is still resolving. The threshold N is sourced
              from PREV_PERIOD_MIN_DAYS (cpmRoasAnalysis.ts) so the copy can never
              drift from the analyzer gate (IN-08). */}
          {`לתקופה הקודמת פחות מ-${PREV_PERIOD_MIN_DAYS} ימים שבהם הקמפיין רץ (חשיפות + הוצאה) — מציג השוואת חצי-חצי במקום.`}
        </div>
      )}
      {/* FIX-24 (5.2.2.1): always render so sparse campaigns see an explicit
          placeholder instead of an empty space that looks like a UI bug. */}
      <div className={cn('mt-2 rounded-lg border px-3 py-2 text-fs-xs leading-relaxed', toneBg[analysis.tone])} data-testid="cpm-trend-verdict">
        {analysis.hasData && (
          <div className="text-fs-2xs opacity-70 mb-1">
            {baselineLabel}
            {isLoadingPrev && <span className="ms-2 opacity-50">· טוען נתוני תקופה קודמת...</span>}
          </div>
        )}
        <span className="font-semibold ms-1">ניתוח:</span>
        <span>{analysis.text}</span>
      </div>
    </div>
  );
}
