'use client';

import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { TrendingUp } from 'lucide-react';
import type { DailySeries } from '@/lib/analytics';
import { formatDate, formatNumber } from '@/lib/utils';
import { storeColor, STORE_COLORS } from '@/lib/storeColors';
import { isHeavyRefundDay } from '@/lib/refundDayHeuristic';
import type { DailyRow } from '@/lib/types';

// The navy primary color is the visual anchor — the first store's line
// gets bold label treatment to guide the eye. Using STORE_COLORS directly
// keeps this sentinel value in sync with the canonical palette.
const PRIMARY_COLOR = STORE_COLORS.uzoshop; // '#1c4587' navy

function colorFor(name: string, idx: number) {
  return storeColor(name, idx);
}

type Props = {
  data: DailySeries[];
  stores: string[];
  /** Raw DailyRow array (same slice that produced `data`). Used to surface
   *  heavy-refund days with an amber dot ring and tooltip refund line. */
  rows: DailyRow[];
  /** When true, render only the chart with no surrounding card/title.
   *  Used when wrapped in a CollapsibleSection that already provides the title. */
  bare?: boolean;
};

export function RoasChart({ data, stores, rows, bare = false }: Props) {
  // Build an O(1) lookup Set for heavy-refund (date|store) keys so the
  // dot renderer and tooltip body can check cheaply without filtering.
  const refundDayKeys = useMemo(() => {
    const set = new Set<string>(); // key: "YYYY-MM-DD|storeName"
    for (const r of rows) {
      if (isHeavyRefundDay(r)) set.add(`${r.date}|${r.storeName}`);
    }
    return set;
  }, [rows]);

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
          const isPrimary = color === PRIMARY_COLOR;
          return (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block w-3.5 h-[3px] rounded-sm shrink-0"
                style={{ backgroundColor: color }}
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
                            {/* c/HI-04: prefix the value with the unit label
                                ("ROAS") so the tooltip is self-describing.
                                Previously the tooltip rendered a bare number
                                like "2.85" which an operator briefly hovering
                                could mistake for CAD or another metric.
                                Matches HeroOverview's pattern. */}
                            <bdi dir="ltr" className="font-semibold ms-auto">
                              ROAS {formatNumber(v)}
                            </bdi>
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
                        <div className="mt-1 pt-1 border-t border-amber-400/30 text-xs text-amber-300">
                          ↩ יום רפאנד כבד — החזרים: -CAD {Math.round(refundSum).toLocaleString('he-IL')}. ה-ROAS משקף את הנטו.
                        </div>
                      );
                    })()}
                  </div>
                );
              }}
            />
            {stores.map((s, i) => {
              const color = colorFor(s, i);
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
                  dot={(props: { cx?: number; cy?: number; payload?: { date?: string }; key?: string | number }) => {
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
                          stroke="rgb(245, 158, 11)" /* amber-500 */
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
