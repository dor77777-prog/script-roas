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
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Heading } from '@/components/ui/Typography';
import { ChartContainer } from '@/components/ui/chart/ChartContainer';
import {
  ChartTooltip,
  ChartTooltipLabel,
  ChartTooltipRow,
  ChartTooltipValue,
} from '@/components/ui/chart/ChartTooltip';
import { CHART_AXIS_COLOR, CHART_COLORS } from '@/lib/chartColors';
import { CpmTrendChart } from '@/components/campaigns/CpmTrendChart';
import { formatCurrency, formatDate } from '@/lib/utils';
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
  // ROAS-overlay state now lives inside <CpmTrendChart> (showRoasDefault).
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
        return (
          <section>
            <CpmTrendChart
              cpmDaily={cpmSeries}
              cpmDailyPrev={prevDaily}
              range={{ from: rangeFrom, to: rangeTo }}
              prevRange={prevRange}
              scopeLabel="(עלות ל-1000 חשיפות, CAD)"
              headingIcon={<TrendingUp size={14} className="text-ink-secondary" />}
              mode={cpmAnalysisMode}
              onModeChange={changeMode}
              isLoadingPrev={cpmAnalysisMode === 'prev' && !campaignsDataPrev}
            />
          </section>
        );
      })()}
    </div>
  );
}
