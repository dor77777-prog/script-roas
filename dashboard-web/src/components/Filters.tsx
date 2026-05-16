'use client';

import { PRESET_LABELS, PRESET_ORDER, computePresetRange } from '@/lib/presets';
import type { Filters as F, PresetKey } from '@/lib/types';
import { Calendar, Store } from 'lucide-react';
import { formatDate } from '@/lib/utils';

type Props = {
  filters: F;
  stores: string[];
  onChange: (next: F) => void;
};

export function Filters({ filters, stores, onChange }: Props) {
  function selectPreset(preset: PresetKey) {
    if (preset === 'custom') {
      onChange({ ...filters, preset });
      return;
    }
    const range = computePresetRange(preset);
    onChange({ ...filters, preset, range });
  }

  const days =
    Math.round(
      (new Date(filters.range.to + 'T00:00:00Z').getTime() -
        new Date(filters.range.from + 'T00:00:00Z').getTime()) /
        86400000,
    ) + 1;

  return (
    <div className="rounded-xl bg-surface border border-border p-5 shadow-card">
      <div className="flex flex-wrap items-end gap-5">
        {/* Period preset */}
        <div className="flex flex-col gap-2">
          <label className="text-xs text-text-secondary flex items-center gap-1.5">
            <Calendar size={14} /> תקופה
          </label>
          <div className="flex flex-wrap gap-1.5">
            {PRESET_ORDER.map(p => (
              <button
                key={p}
                onClick={() => selectPreset(p)}
                className={
                  'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ' +
                  (filters.preset === p
                    ? 'bg-primary text-white shadow-sm'
                    : 'bg-surfaceMuted text-text-secondary hover:bg-border')
                }
              >
                {PRESET_LABELS[p]}
              </button>
            ))}
          </div>
        </div>

        {/* Custom dates */}
        {filters.preset === 'custom' && (
          <div className="flex flex-col gap-2">
            <label className="text-xs text-text-secondary">תאריכים</label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={filters.range.from}
                onChange={e =>
                  onChange({ ...filters, range: { ...filters.range, from: e.target.value } })
                }
                className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm"
              />
              <span className="text-text-secondary">—</span>
              <input
                type="date"
                value={filters.range.to}
                onChange={e =>
                  onChange({ ...filters, range: { ...filters.range, to: e.target.value } })
                }
                className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm"
              />
            </div>
          </div>
        )}

        {/* Store selector */}
        <div className="flex flex-col gap-2">
          <label className="text-xs text-text-secondary flex items-center gap-1.5">
            <Store size={14} /> חנות
          </label>
          <select
            value={filters.store}
            onChange={e => onChange({ ...filters, store: e.target.value })}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium min-w-[160px]"
          >
            <option value="All">כל החנויות</option>
            {stores.map(s => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {/* Active range display */}
        <div className="ms-auto text-xs text-text-muted flex flex-col gap-0.5 items-end">
          <span className="font-medium text-text-secondary">{days} ימים</span>
          <span>
            {formatDate(filters.range.from)} — {formatDate(filters.range.to)}
          </span>
        </div>
      </div>
    </div>
  );
}
