import { useMemo, useState } from 'react';
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
  // Hotfix-9: "zoom to main cluster" toggle. User reported the chart
  // looked left-skewed because rare high-ROAS outliers (ROAS 9+) stretched
  // the X-axis, compressing the dense cluster of normal campaigns. When
  // toggled on (default), axes clip to ~p90 of each dimension and outliers
  // are listed below. When off, full range is shown.
  const [zoomCluster, setZoomCluster] = useState(true);

  const { medRoas, medCac } = useMemo(() => {
    if (data.length === 0) return { medRoas: 0, medCac: 0 };
    const roasSorted = [...data].map(d => d.roas).sort((a, b) => a - b);
    const cacSorted = [...data].map(d => d.cac).sort((a, b) => a - b);
    const med = (arr: number[]) => arr[Math.floor(arr.length / 2)];
    return { medRoas: med(roasSorted), medCac: med(cacSorted) };
  }, [data]);

  // 90th percentile of each dimension — defines the "main cluster" boundary
  // when zoom-to-cluster is active. Anything beyond p90 is an outlier.
  const { p90Roas, p90Cac } = useMemo(() => {
    if (data.length === 0) return { p90Roas: 0, p90Cac: 0 };
    const roasSorted = [...data].map(d => d.roas).sort((a, b) => a - b);
    const cacSorted = [...data].map(d => d.cac).sort((a, b) => a - b);
    const p = (arr: number[], q: number) => arr[Math.min(arr.length - 1, Math.floor(arr.length * q))];
    return { p90Roas: p(roasSorted, 0.9), p90Cac: p(cacSorted, 0.9) };
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

  // Identify outliers (points beyond p90 in either dimension when zoomed).
  const outliers = useMemo(() => {
    if (!zoomCluster) return [];
    // Add small headroom so points right at p90 still render fully inside
    // the chart area instead of getting clipped at the edge.
    return data.filter(d => d.roas > p90Roas * 1.05 || d.cac > p90Cac * 1.05);
  }, [data, zoomCluster, p90Roas, p90Cac]);

  // Compute axis domains. When zoomed, clip to slightly above p90 so the
  // cluster expands and the rare outlier doesn't dominate. When not zoomed,
  // let Recharts auto-fit the full range.
  const xDomain: [number | 'auto', number | 'auto'] = zoomCluster && outliers.length > 0
    ? [0, Math.ceil(p90Roas * 1.15 * 10) / 10]
    : ['auto', 'auto'];
  const yDomain: [number | 'auto', number | 'auto'] = zoomCluster && outliers.length > 0
    ? [0, Math.ceil(p90Cac * 1.15)]
    : ['auto', 'auto'];

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
      <div className="flex items-start justify-between gap-2 mb-1 flex-wrap">
        {title && (
          <h3 className="text-sm sm:text-base font-semibold text-ink">{title}</h3>
        )}
        {/* Hotfix-9: zoom-to-cluster toggle. When ON (default), the chart
            clips axes to ~p90 of each dimension and lists outliers below,
            so the dense cluster of normal campaigns expands and is easier
            to read. When OFF, the full range shows (including the 1-2
            outliers that stretched the original chart). */}
        {data.length > 4 && (
          <label className="inline-flex items-center gap-1.5 text-[11px] sm:text-xs text-ink-secondary cursor-pointer select-none">
            <input
              type="checkbox"
              checked={zoomCluster}
              onChange={e => setZoomCluster(e.target.checked)}
              className="accent-accent"
            />
            <span>התמקד בקבוצה הראשית</span>
          </label>
        )}
      </div>
      {/* Hotfix-8: caption explains the visualization. Hotfix-9: clarifies
          the left-skew (most paid-ad campaigns cluster ROAS 1-3 — that's
          the normal pattern) and points to the zoom toggle for outliers. */}
      <p className="text-[11px] sm:text-xs text-ink-secondary mb-3 leading-relaxed">
        כל נקודה = קמפיין · גודל ∝ הוצאה · צבע = רביעון · <span className="text-ink-muted">מעבר עם העכבר → שם הקמפיין</span>.
        <br className="sm:hidden" />
        רוב הקמפיינים בפרסום ממומן יושבים ב-ROAS 1-3 (זה רגיל); קמפיינים זוכים בROAS גבוה יותר הם המנצחים.
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
            domain={xDomain}
            allowDataOverflow
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
            domain={yDomain}
            allowDataOverflow
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
      {outliers.length > 0 && (
        <details className="mt-3 text-[11px] sm:text-xs text-ink-secondary">
          <summary className="cursor-pointer hover:text-ink transition-colors">
            <span className="font-medium">{outliers.length} קמפיינים אאוטליירים מחוץ לגרף</span>
            {' '}— ROAS &gt; {(p90Roas * 1.05).toFixed(1)} או CAC &gt; CAD {Math.round(p90Cac * 1.05)}
          </summary>
          <ul className="mt-2 space-y-1 ps-3">
            {outliers
              .sort((a, b) => b.roas - a.roas)
              .map(o => (
                <li key={o.name} className="tabular-nums">
                  <span className="text-ink">{o.name}</span>
                  {' — '}
                  <span className="text-status-green">ROAS {o.roas.toFixed(2)}</span>
                  {' · '}
                  <span className="text-status-orange">CAC CAD {Math.round(o.cac).toLocaleString('he-IL')}</span>
                  {' · '}
                  <span className="text-ink-muted">הוצאה CAD {Math.round(o.spend).toLocaleString('he-IL')}</span>
                </li>
              ))}
          </ul>
        </details>
      )}
    </div>
  );
}
