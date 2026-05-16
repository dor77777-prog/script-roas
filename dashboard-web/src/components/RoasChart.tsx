'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import { TrendingUp } from 'lucide-react';
import type { DailySeries } from '@/lib/analytics';
import { formatDate, formatNumber } from '@/lib/utils';

const STORE_COLORS: Record<string, string> = {
  uzoshop: '#1c4587',
  'Zol Plus': '#ea4335',
  '360usmile': '#34a853',
};

function colorFor(name: string, idx: number) {
  return STORE_COLORS[name] || ['#1c4587', '#ea4335', '#34a853', '#fbbc04', '#9c27b0'][idx % 5];
}

export function RoasChart({ data, stores }: { data: DailySeries[]; stores: string[] }) {
  if (!data.length) return null;
  const chartData = data.map(d => ({
    date: d.date,
    dateLabel: formatDate(d.date).slice(0, 5), // DD/MM
    ...d.byStore,
  }));

  return (
    <section className="rounded-xl bg-surface border border-border p-3 sm:p-5 shadow-card">
      <h2 className="flex items-center gap-2 text-sm sm:text-base font-semibold text-text-primary mb-3 sm:mb-4">
        <TrendingUp size={18} className="text-text-secondary" />
        מגמת ROAS לאורך זמן
      </h2>
      <div className="h-64 sm:h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis
              dataKey="dateLabel"
              tick={{ fontSize: 12, fill: '#475569' }}
              axisLine={{ stroke: '#e5e7eb' }}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 12, fill: '#475569' }}
              axisLine={false}
              tickLine={false}
              domain={[0, 'auto']}
            />
            <ReferenceLine y={3} stroke="#16a34a" strokeDasharray="4 4" strokeOpacity={0.5} label={{ value: 'יעד 3.0', fill: '#16a34a', fontSize: 11, position: 'insideTopRight' }} />
            <Tooltip
              formatter={(value: number) => formatNumber(value)}
              labelFormatter={(label, payload) => {
                if (payload && payload.length > 0) {
                  return formatDate(payload[0].payload.date);
                }
                return label;
              }}
            />
            <Legend
              wrapperStyle={{ paddingTop: 10 }}
              iconType="line"
              align="center"
            />
            {stores.map((s, i) => (
              <Line
                key={s}
                type="monotone"
                dataKey={s}
                stroke={colorFor(s, i)}
                strokeWidth={2.5}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
