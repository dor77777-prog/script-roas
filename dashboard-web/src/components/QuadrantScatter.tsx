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

type QuadrantTone = 'winner' | 'efficient-low-roas' | 'profitable-but-expensive' | 'loser';

/**
 * Maps a point to one of the 4 quadrants relative to the group medians.
 *
 *   ↑ low CAC (efficient, top)
 *   ┌────────────────────┬────────────────────┐
 *   │ efficient-low-roas │ winner             │
 *   │ blue               │ green              │
 *   ├────────────────────┼────────────────────┤
 *   │ loser              │ profitable-but-    │
 *   │ red                │ expensive (orange) │
 *   └────────────────────┴────────────────────┘
 *   ← low ROAS                     high ROAS →
 */
function quadrantOf(p: { roas: number; cac: number }, medRoas: number, medCac: number): QuadrantTone {
  const highRoas = p.roas >= medRoas;
  const lowCac = p.cac <= medCac;
  if (highRoas && lowCac) return 'winner';
  if (highRoas && !lowCac) return 'profitable-but-expensive';
  if (!highRoas && lowCac) return 'efficient-low-roas';
  return 'loser';
}

const QUADRANT_FILL: Record<QuadrantTone, string> = {
  winner: 'var(--status-green)',
  'efficient-low-roas': 'var(--status-blue)',
  'profitable-but-expensive': 'var(--status-orange)',
  loser: 'var(--status-red)',
};

export function QuadrantScatter({
  data,
  title,
  className,
  height = 280,
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
        quadrant: quadrantOf(d, medRoas, medCac),
      })),
    [data, medRoas, medCac],
  );

  // Per-quadrant counts for the legend below the chart.
  const counts = useMemo(() => {
    const out = { winner: 0, 'efficient-low-roas': 0, 'profitable-but-expensive': 0, loser: 0 };
    for (const p of points) out[p.quadrant]++;
    return out;
  }, [points]);

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
      {/* Hotfix-8: caption expanded to address user confusion about the
          uneven distribution. The chart shows real performance — most
          campaigns cluster in ROAS 1-3 (normal for paid ads), only a few
          break into the high-ROAS "winner" zone. The dot color now flags
          which quadrant each point falls in, making "who's winning"
          immediately scannable instead of requiring the operator to
          mentally compute the median lines. */}
      <p className="text-[11px] sm:text-xs text-ink-secondary mb-3 leading-relaxed">
        כל נקודה = קמפיין · גודל ∝ הוצאה · צבע = רביעון. החצי השמאלי = ROAS מתחת לחציון של הקבוצה (לרוב היכן שרוב הקמפיינים נופלים — זה רגיל); החצי הימני = ROAS מעל החציון (המנצחים).
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
          <ReferenceLine
            x={medRoas}
            stroke="var(--chart-cursor)"
            strokeDasharray="3 5"
            strokeOpacity={0.7}
            label={{ value: `חציון ROAS: ${medRoas.toFixed(1)}`, position: 'insideTopLeft', fontSize: 10, fill: 'var(--chart-axis)' }}
          />
          <ReferenceLine
            y={medCac}
            stroke="var(--chart-cursor)"
            strokeDasharray="3 5"
            strokeOpacity={0.7}
            label={{ value: `חציון CAC: ${Math.round(medCac)}`, position: 'insideBottomRight', fontSize: 10, fill: 'var(--chart-axis)' }}
          />
          <Tooltip
            cursor={{ stroke: 'var(--chart-cursor)', strokeDasharray: '3 3' }}
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null;
              const p = payload[0].payload as QuadrantPoint & { quadrant: QuadrantTone };
              const tone = p.quadrant;
              const toneLabel: Record<QuadrantTone, string> = {
                winner: '✅ מנצח (ROAS גבוה + CAC נמוך)',
                'efficient-low-roas': '🔵 יעיל אבל ROAS נמוך',
                'profitable-but-expensive': '🟠 רווחי אבל יקר',
                loser: '🔴 הפסד (ROAS נמוך + CAC גבוה)',
              };
              return (
                <ChartTooltip>
                  <ChartTooltipLabel>{p.name}</ChartTooltipLabel>
                  <ChartTooltipRow color={QUADRANT_FILL[tone]} label="רביעון">
                    <ChartTooltipValue>{toneLabel[tone]}</ChartTooltipValue>
                  </ChartTooltipRow>
                  <ChartTooltipRow color="var(--status-green)" label="ROAS">
                    <ChartTooltipValue>{p.roas.toFixed(2)}</ChartTooltipValue>
                  </ChartTooltipRow>
                  <ChartTooltipRow color="var(--status-blue)" label="CAC">
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
            shape={(props: { cx?: number; cy?: number; payload?: QuadrantPoint & { z: number; quadrant: QuadrantTone } }) => {
              const { cx, cy, payload } = props;
              if (cx == null || cy == null || !payload) return <g />;
              const fill = QUADRANT_FILL[payload.quadrant];
              return (
                <circle
                  cx={cx}
                  cy={cy}
                  r={payload.z}
                  fill={fill}
                  fillOpacity={0.75}
                  stroke={fill}
                  strokeWidth={1.5}
                />
              );
            }}
          />
        </ScatterChart>
      </ChartContainer>
      {/* Quadrant legend with per-tone counts — helps the operator see at
          a glance how many campaigns fall into each bucket. */}
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] sm:text-xs">
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-status-green shrink-0" aria-hidden />
          <span className="text-ink-secondary">
            <span className="text-ink font-medium">מנצח</span> ({counts.winner}) — ROAS↑ CAC↓
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-status-orange shrink-0" aria-hidden />
          <span className="text-ink-secondary">
            <span className="text-ink font-medium">רווחי אבל יקר</span> ({counts['profitable-but-expensive']}) — ROAS↑ CAC↑
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-status-blue shrink-0" aria-hidden />
          <span className="text-ink-secondary">
            <span className="text-ink font-medium">יעיל</span> ({counts['efficient-low-roas']}) — ROAS↓ CAC↓
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-status-red shrink-0" aria-hidden />
          <span className="text-ink-secondary">
            <span className="text-ink font-medium">הפסד</span> ({counts.loser}) — ROAS↓ CAC↑
          </span>
        </div>
      </div>
    </div>
  );
}
