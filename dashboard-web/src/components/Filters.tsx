'use client';

import { useState } from 'react';
import {
  PRESET_FEATURED,
  PRESET_LABELS,
  PRESET_SECONDARY,
  computePresetRange,
} from '@/lib/presets';
import type { Filters as F, PresetKey } from '@/lib/types';
import { Calendar, ChevronDown, Store, Zap } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';

type Props = {
  filters: F;
  stores: string[];
  onChange: (next: F) => void;
};

export function Filters({ filters, stores, onChange }: Props) {
  // Advanced presets are folded behind a toggle on small screens to reduce
  // visual noise — the two featured options + store + range cover the 95% case.
  const [advancedOpen, setAdvancedOpen] = useState(false);

  function selectPreset(preset: PresetKey) {
    if (preset === 'custom') {
      onChange({ ...filters, preset });
      // When user explicitly chooses "custom", open the inputs.
      setAdvancedOpen(true);
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

  // If the active preset is one of the secondary ones, force the section open
  // so the user sees what's selected without having to click "More options".
  const activeIsSecondary = PRESET_SECONDARY.includes(filters.preset);
  const showAdvanced = advancedOpen || activeIsSecondary || filters.preset === 'custom';

  return (
    <div className="rounded-xl bg-surface border border-borderSubtle shadow-card overflow-hidden">
      <div className="p-4 sm:p-5 space-y-3.5 sm:space-y-4">
        {/* ===== Row 1: featured presets + store ===== */}
        <div className="flex flex-col sm:flex-row sm:items-end gap-3 sm:gap-4">
          <div className="flex-1 min-w-0">
            <label className="text-[11px] sm:text-xs font-medium text-text-secondary flex items-center gap-1.5 mb-1.5 sm:mb-2 tracking-wide">
              <Zap size={12} className="text-amber-500 fill-amber-500" />
              טווח מהיר
            </label>
            <div className="grid grid-cols-2 gap-2">
              {PRESET_FEATURED.map(p => (
                <button
                  key={p}
                  onClick={() => selectPreset(p)}
                  className={cn(
                    'rounded-lg px-3 py-2.5 text-sm font-semibold transition-all',
                    'border ring-0 focus-visible:ring-2 focus-visible:ring-primary/30',
                    filters.preset === p
                      ? 'bg-primary text-white border-primary shadow-sm'
                      : 'bg-surface text-text-primary border-border hover:border-primary/40 hover:bg-surfaceMuted active:scale-[0.98]',
                  )}
                >
                  {PRESET_LABELS[p]}
                </button>
              ))}
            </div>
          </div>

          <div className="sm:w-[200px]">
            <label className="text-[11px] sm:text-xs font-medium text-text-secondary flex items-center gap-1.5 mb-1.5 sm:mb-2 tracking-wide">
              <Store size={12} />
              חנות
            </label>
            <div className="relative">
              <select
                value={filters.store}
                onChange={e => onChange({ ...filters, store: e.target.value })}
                className="w-full appearance-none rounded-lg border border-border bg-surface pl-3 pr-9 py-2.5 sm:py-2 text-sm font-medium text-text-primary hover:border-borderStrong focus:outline-none focus:border-primary focus:shadow-focus transition-colors cursor-pointer"
              >
                <option value="All">כל החנויות</option>
                {stores.map(s => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted"
              />
            </div>
          </div>
        </div>

        {/* ===== Selected range banner ===== */}
        <div className="flex items-center justify-between rounded-lg bg-surfaceMuted px-3 py-2 text-xs sm:text-sm">
          <div className="flex items-center gap-2 text-text-secondary">
            <Calendar size={13} className="text-text-muted" />
            <span className="tabular-nums">
              {formatDate(filters.range.from)} — {formatDate(filters.range.to)}
            </span>
          </div>
          <span className="font-semibold text-text-primary tabular-nums">{days} ימים</span>
        </div>

        {/* ===== Advanced toggle ===== */}
        <button
          type="button"
          onClick={() => setAdvancedOpen(v => !v)}
          className="text-[11px] sm:text-xs text-text-secondary hover:text-text-primary inline-flex items-center gap-1 transition-colors font-medium"
        >
          <ChevronDown
            size={13}
            className={cn('transition-transform duration-DEFAULT', showAdvanced && 'rotate-180')}
          />
          טווחים נוספים
        </button>

        {showAdvanced && (
          <div className="space-y-3 pt-1 animate-fade-in">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-1.5">
              {PRESET_SECONDARY.map(p => (
                <button
                  key={p}
                  onClick={() => selectPreset(p)}
                  className={cn(
                    'rounded-lg px-2.5 py-2 text-xs sm:text-sm font-medium transition-all border',
                    filters.preset === p
                      ? 'bg-primary text-white border-primary shadow-sm'
                      : 'bg-surface text-text-secondary border-border hover:border-primary/40 hover:text-text-primary active:scale-[0.98]',
                  )}
                >
                  {PRESET_LABELS[p]}
                </button>
              ))}
            </div>

            {filters.preset === 'custom' && (
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-center gap-2">
                <input
                  type="date"
                  value={filters.range.from}
                  onChange={e =>
                    onChange({ ...filters, range: { ...filters.range, from: e.target.value } })
                  }
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-sm w-full focus:outline-none focus:border-primary focus:shadow-focus transition-colors"
                />
                <span className="text-text-secondary text-center hidden sm:inline">—</span>
                <input
                  type="date"
                  value={filters.range.to}
                  onChange={e =>
                    onChange({ ...filters, range: { ...filters.range, to: e.target.value } })
                  }
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-sm w-full focus:outline-none focus:border-primary focus:shadow-focus transition-colors"
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
