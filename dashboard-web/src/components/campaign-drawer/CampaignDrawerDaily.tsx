'use client';

/**
 * Task 5.5 (Wave 5) — Daily sub-tab.
 *
 * Two day-grain charts:
 *   1. Spend ↔ Value over time (stacked area)
 *   2. CPM over time with optional ROAS overlay + previous-period dashed
 *      line + the smart "what changed" analysis box
 *
 * All data-derivation logic (the prevDaily series builder, the
 * dayOffsetFromRangeStart pairing, the analysis tone bucket) is lifted
 * BYTE-IDENTICAL from the pre-split CampaignDrawer.tsx. State for the
 * baseline mode toggle + ROAS overlay toggle is owned here because they
 * affect the Daily tab only.
 */

import { useState } from 'react';
import { TrendingUp } from 'lucide-react';
import {
  Area,
  AreaChart,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Heading } from '@/components/ui/Typography';
import { ChartContainer } from '@/components/ui/chart/ChartContainer';
import {
  ChartTooltip,
  ChartTooltipLabel,
  ChartTooltipRow,
  ChartTooltipValue,
} from '@/components/ui/chart/ChartTooltip';
import { CHART_AXIS_COLOR, CHART_COLORS } from '@/lib/chartColors';
import {
  analyzeCpmVsRoas,
  dayOffsetFromRangeStart,
  indexPrevByDateOffset,
  PREV_PERIOD_MIN_DAYS,
} from '@/lib/cpmRoasAnalysis';
import { cn, formatCurrency, formatDate, formatNumber } from '@/lib/utils';
import type { CampaignsResponse } from '@/app/api/campaigns/route';

export interface DailyPoint {
  date: string;
  spend: number;
  value: number;
  impressions: number;
  cpm: number;
  roas: number;
}

export interface CampaignDrawerDailyProps {
  dailyArr: DailyPoint[];
  rangeFrom: string;
  rangeTo: string;
  prevRange: { from: string; to: string };
  /** Previous-period campaign rows (already fetched by parent — may be
   *  undefined when the analysis mode is 'half'). */
  campaignsDataPrev: CampaignsResponse | undefined;
  /** Lets the parent register that the operator switched to 'prev' so
   *  the parent can flip its SWR fetch from null → the prev key. */
  onAnalysisModeChange?: (mode: 'half' | 'prev') => void;
  storeId: string;
  campaignId: string;
  platform: string;
}

export function CampaignDrawerDaily({
  dailyArr,
  rangeFrom,
  rangeTo,
  prevRange,
  campaignsDataPrev,
  onAnalysisModeChange,
  storeId,
  campaignId,
  platform,
}: CampaignDrawerDailyProps) {
  const [showRoasOverlay, setShowRoasOverlay] = useState(false);
  const [cpmAnalysisMode, setCpmAnalysisMode] = useState<'half' | 'prev'>('half');

  function changeMode(mode: 'half' | 'prev') {
    setCpmAnalysisMode(mode);
    onAnalysisModeChange?.(mode);
  }

  return (
    <div className="space-y-5 sm:space-y-6" data-testid="campaign-drawer-tab-daily">
      {dailyArr.length >= 2 && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <Heading level="panel" className="inline-flex items-center gap-1.5">
              <TrendingUp size={14} className="text-ink-secondary" />
              הוצאה ↔ ערך המרות לאורך הזמן
            </Heading>
          </div>
          <ChartContainer
            // OPERATOR FIX (2026-06-01): explicit min-h so the chart never
            // squishes inside the modal (Sheet variant="modal" is a
            // flex-col/overflow-hidden card; SheetBody is the scroll area).
            // 200px gives the area chart room to breathe vs the prior 160px.
            className="h-40 sm:h-44 min-h-[200px] rounded-xl bg-glass-2/40 border border-glass-edge p-2"
            height="100%"
          >
            <AreaChart data={dailyArr} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="drawer-spend" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART_COLORS.spend} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={CHART_COLORS.spend} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="drawer-value" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART_COLORS.value} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={CHART_COLORS.value} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: CHART_AXIS_COLOR }}
                tickLine={false}
                axisLine={false}
                tickFormatter={d => {
                  const m = String(d).match(/^\d{4}-(\d{2})-(\d{2})/);
                  return m ? `${m[2]}/${m[1]}` : String(d);
                }}
              />
              <YAxis
                tick={{ fontSize: 10, fill: CHART_AXIS_COLOR }}
                tickLine={false}
                axisLine={false}
                tickFormatter={v => `C$${formatCurrency(Number(v))}`}
                width={60}
                domain={[0, 'auto']}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const d = payload[0].payload as { date: string; spend: number; value: number };
                  return (
                    <ChartTooltip className="tabular-nums">
                      <ChartTooltipLabel>{formatDate(d.date)}</ChartTooltipLabel>
                      <ChartTooltipRow color={CHART_COLORS.spend} label="הוצאה">
                        CAD <ChartTooltipValue>{formatCurrency(d.spend)}</ChartTooltipValue>
                      </ChartTooltipRow>
                      <ChartTooltipRow color={CHART_COLORS.value} label="ערך המרות">
                        CAD <ChartTooltipValue>{formatCurrency(d.value)}</ChartTooltipValue>
                      </ChartTooltipRow>
                    </ChartTooltip>
                  );
                }}
              />
              <Area type="monotone" dataKey="value" stroke={CHART_COLORS.value} strokeWidth={1.5} fill="url(#drawer-value)" />
              <Area type="monotone" dataKey="spend" stroke={CHART_COLORS.spend} strokeWidth={1.5} fill="url(#drawer-spend)" />
            </AreaChart>
          </ChartContainer>
          <div className="flex items-center gap-3 text-[10px] text-ink-muted mt-1.5">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-status-green" />
              ערך המרות
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-status-red" />
              הוצאה
            </span>
          </div>
        </section>
      )}

      {(() => {
        const cpmSeries = dailyArr.filter(d => d.impressions > 0);
        const fromMs = Date.UTC(
          Number(rangeFrom.slice(0, 4)),
          Number(rangeFrom.slice(5, 7)) - 1,
          Number(rangeFrom.slice(8, 10)),
        );
        const toMs = Date.UTC(
          Number(rangeTo.slice(0, 4)),
          Number(rangeTo.slice(5, 7)) - 1,
          Number(rangeTo.slice(8, 10)),
        );
        const rangeDays = Math.round((toMs - fromMs) / 86400000) + 1;
        if (rangeDays < 3 || cpmSeries.length < 2) return null;

        const prevDaily = (() => {
          if (cpmAnalysisMode !== 'prev') return undefined;
          const rows = (campaignsDataPrev?.rows ?? []).filter(r =>
            r.storeId === storeId &&
            r.platform === platform &&
            r.campaignId === campaignId,
          );
          if (rows.length === 0) return undefined;
          const byDay = new Map<string, { spend: number; impressions: number; value: number }>();
          for (const r of rows) {
            if (!byDay.has(r.date)) byDay.set(r.date, { spend: 0, impressions: 0, value: 0 });
            const d = byDay.get(r.date)!;
            d.spend += r.spend;
            d.impressions += r.impressions;
            d.value += r.conversionValue;
          }
          return Array.from(byDay.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .filter(([, v]) => v.impressions > 0)
            .map(([date, v]) => ({
              date,
              cpm: (v.spend / v.impressions) * 1000,
              roas: v.spend > 0 ? v.value / v.spend : 0,
            }));
        })();
        const analysis = analyzeCpmVsRoas(
          cpmSeries.map(d => ({ date: d.date, cpm: d.cpm, roas: d.roas })),
          prevDaily ? { prev: prevDaily } : undefined,
        );
        const prevByOffset = indexPrevByDateOffset(prevDaily, prevRange.from);
        const chartData = cpmSeries.map(d => {
          const offset = dayOffsetFromRangeStart(d.date, rangeFrom);
          const prev = prevByOffset.get(offset);
          return {
            ...d,
            prevCpm: prev?.cpm ?? null,
            prevDate: prev?.date ?? null,
          };
        });
        const isLoadingPrev = cpmAnalysisMode === 'prev' && !campaignsDataPrev;
        const showPrevLine = cpmAnalysisMode === 'prev' && !isLoadingPrev && (prevDaily?.length ?? 0) > 0;
        const fmtRangeShort = (from: string, to: string) => {
          const f = from.slice(5).replace('-', '/');
          const t = to.slice(5).replace('-', '/');
          return `${f}—${t}`;
        };
        const halfMidIdx = Math.floor(cpmSeries.length / 2);
        const firstHalfDates = cpmSeries.length >= 4
          ? `${cpmSeries[0].date.slice(5).replace('-', '/')}—${cpmSeries[halfMidIdx - 1].date.slice(5).replace('-', '/')}`
          : '';
        const secondHalfDates = cpmSeries.length >= 4
          ? `${cpmSeries[halfMidIdx].date.slice(5).replace('-', '/')}—${cpmSeries[cpmSeries.length - 1].date.slice(5).replace('-', '/')}`
          : '';
        const baselineLabel = analysis.mode === 'previous-period'
          ? `השוואה: ${fmtRangeShort(rangeFrom, rangeTo)} מול ${fmtRangeShort(prevRange.from, prevRange.to)} (תקופה קודמת באותו אורך)`
          : firstHalfDates && secondHalfDates
          ? `השוואה: חצי שני (${secondHalfDates}) מול חצי ראשון (${firstHalfDates})`
          : 'השוואה: חצי שני vs חצי ראשון של הטווח';
        const toneBg: Record<typeof analysis.tone, string> = {
          positive: 'bg-status-greenBg border-status-green text-status-greenFg',
          warning:  'bg-status-warningBg border-status-warning text-status-warningFg',
          negative: 'bg-status-redBg border-status-red text-status-redFg',
          neutral:  'bg-glass-2 border-glass-edge text-ink-secondary',
        };
        return (
          <section>
            <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
              <Heading level="panel" className="inline-flex items-center gap-1.5">
                <TrendingUp size={14} className="text-ink-secondary" />
                CPM לאורך זמן
                <span className="text-[10px] font-medium text-ink-muted">
                  (עלות ל-1000 חשיפות, CAD)
                </span>
              </Heading>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="inline-flex items-center gap-0.5 rounded-md border border-glass-edge bg-glass-1 p-0.5 text-[10px]">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => changeMode('half')}
                    className={cn(
                      'px-2 py-0.5 h-auto rounded transition-colors text-[10px]',
                      cpmAnalysisMode === 'half'
                        ? 'bg-accent-bg text-accent font-medium'
                        : 'text-ink-muted hover:text-ink',
                    )}
                  >
                    חצי-חצי
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => changeMode('prev')}
                    className={cn(
                      'px-2 py-0.5 h-auto rounded transition-colors text-[10px]',
                      cpmAnalysisMode === 'prev'
                        ? 'bg-accent-bg text-accent font-medium'
                        : 'text-ink-muted hover:text-ink',
                    )}
                  >
                    vs תקופה קודמת
                  </Button>
                </div>
                <label className="inline-flex items-center gap-1.5 text-[11px] text-ink-secondary cursor-pointer select-none">
                  <Input
                    type="checkbox"
                    checked={showRoasOverlay}
                    onChange={e => setShowRoasOverlay(e.target.checked)}
                    className="rounded border-glass-edge text-accent focus:ring-accent cursor-pointer"
                  />
                  הוסף ROAS לגרף
                </label>
              </div>
            </div>
            <ChartContainer
              // OPERATOR FIX (2026-06-01): explicit min-h so the CPM line
              // chart never squishes inside the modal. See the spend↔value
              // chart above for the rationale.
              className="h-40 sm:h-44 min-h-[200px] rounded-xl bg-glass-2/40 border border-glass-edge p-2"
              height="100%"
            >
              <LineChart data={chartData} margin={{ top: 8, right: showRoasOverlay ? 56 : 16, left: 4, bottom: 0 }}>
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
                  domain={[0, (dataMax: number) => dataMax * 1.12]}
                  allowDecimals
                />
                {showRoasOverlay && (
                  <YAxis
                    yAxisId="roas"
                    orientation="right"
                    tick={{ fontSize: 10, fill: CHART_COLORS.roas }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={v => Number(v).toFixed(2)}
                    width={42}
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
                        {showRoasOverlay && (
                          <ChartTooltipRow color={CHART_COLORS.roas} label="ROAS">
                            <ChartTooltipValue>{formatNumber(d.roas, 2)}</ChartTooltipValue>
                          </ChartTooltipRow>
                        )}
                        {showPrevLine && d.prevCpm != null && (
                          <div className="mt-1 pt-1 border-t border-glass-edge">
                            <div className="text-ink-muted text-[10px] mb-0.5">
                              תקופה קודמת{d.prevDate ? ` (${formatDate(d.prevDate)})` : ''}:
                            </div>
                            <ChartTooltipRow color={CHART_COLORS.cpmPrev} label="CPM">
                              CAD <ChartTooltipValue>{formatCurrency(d.prevCpm, 2)}</ChartTooltipValue>
                              {prevDeltaPct != null && (
                                <span className={cn(
                                  'ms-1.5 text-[10px] font-semibold',
                                  prevDeltaPct < 0 ? 'text-status-green' : prevDeltaPct > 0 ? 'text-status-red' : 'text-ink-muted',
                                )}>
                                  ({prevDeltaPct > 0 ? '+' : ''}{prevDeltaPct.toFixed(1)}%)
                                </span>
                              )}
                            </ChartTooltipRow>
                          </div>
                        )}
                        <div className="text-ink-muted text-[10px] mt-1">
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
                {showRoasOverlay && (
                  <Line
                    yAxisId="roas"
                    type="monotone"
                    dataKey="roas"
                    stroke={CHART_COLORS.roas}
                    strokeWidth={1.75}
                    strokeDasharray="5 3"
                    dot={{ r: 2.5, fill: CHART_COLORS.roas, stroke: 'none' }}
                    activeDot={{ r: 4, fill: CHART_COLORS.roas, stroke: 'var(--surface-elevated-1)', strokeWidth: 1.5 }}
                  />
                )}
              </LineChart>
            </ChartContainer>
            {(showRoasOverlay || showPrevLine) && (
              <div className="flex items-center justify-center gap-4 text-[10px] text-ink-muted mt-1.5 flex-wrap">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-3 h-[2px]" style={{ background: CHART_COLORS.cpm }} />
                  CPM {showRoasOverlay ? '(ציר שמאל)' : ''}
                </span>
                {showPrevLine && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block w-3 border-t-2 border-dashed border-status-warning" />
                    CPM תקופה קודמת
                  </span>
                )}
                {showRoasOverlay && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block w-3 border-t-2 border-dashed border-status-green" />
                    ROAS (ציר ימין)
                  </span>
                )}
              </div>
            )}
            {cpmAnalysisMode === 'prev' && !isLoadingPrev && analysis.mode === 'half-over-half' && (
              <div className="text-[10px] text-status-warningFg bg-status-warningBg px-2 py-1 rounded mt-1">
                {`לתקופה הקודמת פחות מ-${PREV_PERIOD_MIN_DAYS} ימים שבהם הקמפיין רץ (חשיפות + הוצאה) — מציג השוואת חצי-חצי במקום.`}
              </div>
            )}
            <div className={cn('mt-2 rounded-lg border px-3 py-2 text-[11px] leading-relaxed', toneBg[analysis.tone])}>
              {analysis.hasData && (
                <div className="text-[10px] opacity-70 mb-1">
                  {baselineLabel}
                  {isLoadingPrev && <span className="ms-2 opacity-50">· טוען נתוני תקופה קודמת...</span>}
                </div>
              )}
              <span className="font-semibold ms-1">ניתוח:</span>
              <span>{analysis.text}</span>
            </div>
          </section>
        );
      })()}
    </div>
  );
}
