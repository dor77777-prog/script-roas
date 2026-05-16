'use client';

import {
  PRESET_FEATURED,
  PRESET_LABELS,
  PRESET_SECONDARY,
  computePresetRange,
} from '@/lib/presets';
import type { Filters as F, PresetKey } from '@/lib/types';
import { Calendar, Store, Zap } from 'lucide-react';
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
    <div className="rounded-xl bg-surface border border-border p-4 sm:p-5 shadow-card space-y-4">
      {/* ====== Featured quick filters (אתמול, מתחילת החודש) ====== */}
      <div className="flex flex-col gap-2">
        <label className="text-xs text-text-secondary flex items-center gap-1.5">
          <Zap size={14} className="text-amber-500 fill-amber-500" /> קיצורים מהירים
        </label>
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
          {PRESET_FEATURED.map(p => (
            <button
              key={p}
              onClick={() => selectPreset(p)}
              className={
                'rounded-xl px-4 sm:px-5 py-3 sm:py-2.5 text-sm sm:text-base font-bold transition-all shadow-sm ' +
                (filters.preset === p
                  ? 'bg-gradient-to-br from-primary to-primary-dark text-white shadow-md scale-[1.02] ring-2 ring-primary/30'
                  : 'bg-white border-2 border-primary/20 text-primary hover:border-primary hover:shadow-md active:scale-95')
              }
            >
              {PRESET_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-border" />

      {/* Store + range display - mobile-first layout */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        {/* Store selector */}
        <div className="flex flex-col gap-2">
          <label className="text-xs text-text-secondary flex items-center gap-1.5">
            <Store size={14} /> חנות
          </label>
          <select
            value={filters.store}
            onChange={e => onChange({ ...filters, store: e.target.value })}
            className="rounded-lg border border-border bg-surface px-3 py-2 sm:py-1.5 text-sm font-medium w-full sm:min-w-[180px]"
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
        <div className="text-xs sm:text-sm text-text-muted flex flex-row sm:flex-col gap-1 items-center sm:items-end justify-between sm:justify-start">
          <span className="font-medium text-text-secondary">{days} ימים</span>
          <span className="tabular-nums">
            {formatDate(filters.range.from)} — {formatDate(filters.range.to)}
          </span>
        </div>
      </div>

      <div className="border-t border-border" />

      {/* Secondary period presets */}
      <div className="flex flex-col gap-2">
        <label className="text-xs text-text-secondary flex items-center gap-1.5">
          <Calendar size={14} /> טווחים נוספים
        </label>
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-1.5">
          {PRESET_SECONDARY.map(p => (
            <button
              key={p}
              onClick={() => selectPreset(p)}
              className={
                'rounded-lg px-3 py-2 sm:py-1.5 text-sm font-medium transition-colors text-center ' +
                (filters.preset === p
                  ? 'bg-primary text-white shadow-sm'
                  : 'bg-surfaceMuted text-text-secondary hover:bg-border active:scale-95')
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
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-center gap-2">
            <input
              type="date"
              value={filters.range.from}
              onChange={e =>
                onChange({ ...filters, range: { ...filters.range, from: e.target.value } })
              }
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm w-full"
            />
            <span className="text-text-secondary text-center hidden sm:inline">—</span>
            <input
              type="date"
              value={filters.range.to}
              onChange={e =>
                onChange({ ...filters, range: { ...filters.range, to: e.target.value } })
              }
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm w-full"
            />
          </div>
        </div>
      )}
    </div>
  );
}
