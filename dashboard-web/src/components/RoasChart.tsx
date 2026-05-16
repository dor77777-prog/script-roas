'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { TrendingUp } from 'lucide-react';
import type { DailySeries } from '@/lib/analytics';
import { formatDate, formatNumber } from '@/lib/utils';

/**
 * Series palette: a single dominant brand color + muted neutrals for the other
 * stores. The previous "rainbow" (red / green / yellow / purple) gave every
 * store equal visual weight, which made it impossible to track any single one.
 * Per the frontend-design playbook: dominant + sharp accents > evenly-spread
 * color. We pick a fixed brand color for the primary store and assign neutrals
 * to the rest.
 */
const SERIES_PALETTE = [
  '#1c4587', // dominant — deep navy (matches dashboard primary)
  '#94a3b8', // slate-400 — muted
  '#64748b', // slate-500 — muted darker
  '#0891b2', // cyan-600 — fallback accent if 4+ stores
  '#7c3aed', // violet-600 — fallback accent if 5+ stores
];
const STORE_COLORS: Record<string, string> = {
  uzoshop: SERIES_PALETTE[0],
  'Zol Plus': SERIES_PALETTE[1],
  '360usmile': SERIES_PALETTE[2],
};

function colorFor(name: string, idx: number) {
  return STORE_COLORS[name] || SERIES_PALETTE[idx % SERIES_PALETTE.length];
}

type Props = {
  data: DailySeries[];
  stores: string[];
  /** When true, render only the chart with no surrounding card/title.
   *  Used when wrapped in a CollapsibleSection that already provides the title. */
  bare?: boolean;
};

export function RoasChart({ data, stores, bare = false }: Props) {
  if (!data.length) return null;
  const chartData = data.map(d => ({
    date: d.date,
    dateLabel: formatDate(d.date).slice(0, 5), // DD/MM
    ...d.byStore,
  }));

  const chart = (
    <div className="space-y-3">
      {/* Custom legend — RTL-aware, tabular spacing, distinguishes the
          dominant brand series from the muted neutrals so the eye anchors
          to the primary line. */}
      <div className="flex items-center justify-end gap-3 sm:gap-4 flex-wrap text-[11px] sm:text-xs">
        {stores.map((s, i) => {
          const color = colorFor(s, i);
          const isPrimary = color === SERIES_PALETTE[0];
          return (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block w-3 h-[3px] rounded-sm shrink-0"
                style={{ backgroundColor: color, opacity: isPrimary ? 1 : 0.85 }}
              />
              <span className={isPrimary ? 'font-semibold text-text-primary' : 'text-text-secondary'}>
                {s}
              </span>
            </span>
          );
        })}
        <span className="inline-flex items-center gap-1.5 ms-auto sm:ms-2">
          <span className="inline-block w-3 h-[2px] border-t border-dashed border-roas-green/70 shrink-0" />
          <span className="text-text-muted">יעד 3.0</span>
        </span>
      </div>

      <div className="h-64 sm:h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 10, right: 12, left: 8, bottom: 0 }}>
            {/* Very quiet grid — guidance, not decoration. */}
            <CartesianGrid strokeDasharray="2 4" stroke="#e5e7eb" strokeOpacity={0.55} vertical={false} />
            <XAxis
              dataKey="dateLabel"
              tick={{ fontSize: 11, fill: '#64748b', fontVariant: 'tabular-nums' }}
              axisLine={false}
              tickLine={false}
              tickMargin={6}
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#64748b', fontVariant: 'tabular-nums' }}
              axisLine={false}
              tickLine={false}
              domain={[0, 'auto']}
              width={32}
              tickFormatter={v => (Number.isInteger(v) ? String(v) : v.toFixed(1))}
            />
            <ReferenceLine
              y={3}
              stroke="#16a34a"
              strokeDasharray="4 4"
              strokeOpacity={0.55}
              strokeWidth={1.5}
            />
            <Tooltip
              cursor={{ stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '3 3' }}
              content={({ active, payload }) => {
                if (!active || !payload || payload.length === 0) return null;
                const date = payload[0].payload.date as string;
                return (
                  <div
                    dir="rtl"
                    className="rounded-lg bg-text-primary/95 text-white px-3 py-2 text-xs shadow-elevated tabular-nums backdrop-blur-sm"
                  >
                    <div className="text-white/65 mb-1 text-[10px]">{formatDate(date)}</div>
                    <ul className="space-y-0.5">
                      {payload.map(entry => {
                        const v = Number(entry.value);
                        if (!Number.isFinite(v)) return null;
                        return (
                          <li key={String(entry.dataKey)} className="flex items-center gap-2">
                            <span
                              className="inline-block w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: entry.color }}
                            />
                            <span className="text-white/85">{String(entry.dataKey)}</span>
                            <bdi dir="ltr" className="font-semibold ms-auto">
                              {formatNumber(v)}
                            </bdi>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              }}
            />
            {stores.map((s, i) => {
              const color = colorFor(s, i);
              const isPrimary = color === SERIES_PALETTE[0];
              return (
                <Line
                  key={s}
                  type="monotone"
                  dataKey={s}
                  stroke={color}
                  strokeWidth={isPrimary ? 2.5 : 1.5}
                  strokeOpacity={isPrimary ? 1 : 0.78}
                  dot={false}
                  activeDot={{ r: isPrimary ? 5 : 4, strokeWidth: 0 }}
                  connectNulls
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );

  if (bare) return <div className="p-3 sm:p-5">{chart}</div>;

  return (
    <section className="rounded-xl bg-surface border border-border p-3 sm:p-5 shadow-card">
      <h2 className="flex items-center gap-2 text-sm sm:text-base font-semibold text-text-primary mb-3 sm:mb-4">
        <TrendingUp size={18} className="text-text-secondary" />
        מגמת ROAS לאורך זמן
      </h2>
      {chart}
    </section>
  );
}
