import { useMemo } from 'react';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import { ChartContainer } from '@/components/ui/chart/ChartContainer';
import {
  ChartTooltip,
  ChartTooltipLabel,
  ChartTooltipRow,
  ChartTooltipValue,
} from '@/components/ui/chart/ChartTooltip';
import { cn } from '@/lib/utils';

export interface QuadrantPoint {
  name: string;
  roas: number;
  cac: number;
  spend: number;
}

export function QuadrantScatter({
  data,
  title,
  className,
  height = 260,
}: {
  data: QuadrantPoint[];
  title?: string;
  className?: string;
  height?: number;
}) {
  const { medRoas, medCac } = useMemo(() => {
    if (data.length === 0) return { medRoas: 0, medCac: 0 };
    const roasSorted = [...data].map(d => d.roas).sort((a, b) => a - b);
    const cacSorted = [...data].map(d => d.cac).sort((a, b) => a - b);
    const med = (arr: number[]) => arr[Math.floor(arr.length / 2)];
    return { medRoas: med(roasSorted), medCac: med(cacSorted) };
  }, [data]);

  const points = useMemo(
    () =>
      data.map(d => ({
        ...d,
        z: Math.max(4, Math.min(12, Math.sqrt(Math.max(d.spend, 0)) / 6)),
      })),
    [data],
  );

  if (data.length === 0) {
    return (
      <div className={cn('rounded-xl bg-elevated border border-line p-5', className)}>
        {title && (
          <h3 className="text-sm sm:text-base font-semibold text-ink mb-2">{title}</h3>
        )}
        <div className="text-ink-muted text-sm text-center py-8">
          אין נתונים להצגה — בחר טווח עם קמפיינים פעילים.
        </div>
      </div>
    );
  }

  return (
    <div className={cn('rounded-xl bg-elevated border border-line p-3 sm:p-5', className)}>
      {title && (
        <h3 className="text-sm sm:text-base font-semibold text-ink mb-1">{title}</h3>
      )}
      {/* Hotfix-6: legend caption explaining the visualization. User reported
          "לא ברורה בעליל לא מבין מה אני רואה שם" — without context, scatter
          plots are abstract. The caption maps each visual encoding to its
          meaning in plain Hebrew. */}
      <p className="text-[11px] sm:text-xs text-ink-secondary mb-3 leading-relaxed">
        כל נקודה = קמפיין. <span className="text-ink-muted">גודל</span> הנקודה ∝ הוצאה.
        <br className="sm:hidden" />
        <span className="text-status-green font-medium">ROAS גבוה ימינה</span> = רווחי יותר ·
        <span className="text-status-blue font-medium"> CAC נמוך למעלה</span> = יעיל יותר.
        הקו המקווקו = חציון הקבוצה (חוצה ל-4 רביעונים).
      </p>
      <ChartContainer height={height}>
        <ScatterChart margin={{ top: 12, right: 16, left: 8, bottom: 36 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="var(--chart-grid)" strokeOpacity={0.55} />
          <XAxis
            type="number"
            dataKey="roas"
            name="ROAS"
            tick={{ fontSize: 10, fill: 'var(--chart-axis)', fontVariant: 'tabular-nums' }}
            axisLine={false}
            tickLine={false}
            tickMargin={4}
            domain={['auto', 'auto']}
            label={{ value: 'ROAS (ערך ÷ הוצאה) — ימינה = רווחי יותר', position: 'insideBottom', offset: -22, fontSize: 11, fill: 'var(--chart-axis)' }}
          />
          <YAxis
            type="number"
            dataKey="cac"
            name="CAC"
            width={52}
            tick={{ fontSize: 10, fill: 'var(--chart-axis)', fontVariant: 'tabular-nums' }}
            axisLine={false}
            tickLine={false}
            tickMargin={4}
            domain={['auto', 'auto']}
            label={{ value: 'CAC (CAD/לקוח) — למעלה = יעיל יותר', angle: -90, position: 'insideLeft', offset: 12, fontSize: 11, fill: 'var(--chart-axis)' }}
            reversed
          />
          <ReferenceLine x={medRoas} stroke="var(--chart-cursor)" strokeDasharray="3 5" strokeOpacity={0.55} />
          <ReferenceLine y={medCac} stroke="var(--chart-cursor)" strokeDasharray="3 5" strokeOpacity={0.55} />
          <Tooltip
            cursor={{ stroke: 'var(--chart-cursor)', strokeDasharray: '3 3' }}
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null;
              const p = payload[0].payload as QuadrantPoint;
              return (
                <ChartTooltip>
                  <ChartTooltipLabel>{p.name}</ChartTooltipLabel>
                  <ChartTooltipRow color="var(--status-green)" label="ROAS">
                    <ChartTooltipValue>{p.roas.toFixed(2)}</ChartTooltipValue>
                  </ChartTooltipRow>
                  <ChartTooltipRow color="var(--status-orange)" label="CAC">
                    <ChartTooltipValue>CAD {Math.round(p.cac).toLocaleString('he-IL')}</ChartTooltipValue>
                  </ChartTooltipRow>
                  <ChartTooltipRow color="var(--accent)" label="הוצאה">
                    <ChartTooltipValue>CAD {Math.round(p.spend).toLocaleString('he-IL')}</ChartTooltipValue>
                  </ChartTooltipRow>
                </ChartTooltip>
              );
            }}
          />
          <Scatter
            data={points}
            fill="var(--accent)"
            shape={(props: { cx?: number; cy?: number; payload?: QuadrantPoint & { z: number } }) => {
              const { cx, cy, payload } = props;
              if (cx == null || cy == null || !payload) return <g />;
              return (
                <circle
                  cx={cx}
                  cy={cy}
                  r={payload.z}
                  fill="var(--accent)"
                  fillOpacity={0.7}
                  stroke="var(--accent)"
                  strokeWidth={1}
                />
              );
            }}
          />
        </ScatterChart>
      </ChartContainer>
    </div>
  );
}
