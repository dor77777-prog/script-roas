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
import { Button } from '@/components/ui/Button';
import { applyFromCandidate, applyToCandidate } from '@/lib/rangeClamp';

/**
 * Asia/Jerusalem "today" as YYYY-MM-DD. Capped value for the custom-range
 * inputs (HIGH-3 audit fix 2026-05-23) so the operator cannot pick a
 * future date and cascade malformed YYYY-MM-DD into downstream SWR keys.
 *
 * Recomputed on every render — the dashboard runs as a long-lived SPA so
 * a render that straddles midnight in Asia/Jerusalem should pick up the
 * new boundary on the next render rather than freezing yesterday's value
 * for the session. Matches CampaignsTable.tsx's todayInIsrael() helper.
 */
function todayInIsrael(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

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
    <div className="rounded-xl bg-glass-1 border border-glass-edge shadow-glass overflow-hidden">
      <div className="p-4 sm:p-5 space-y-3.5 sm:space-y-4">
        {/* ===== Row 1: featured presets + store ===== */}
        <div className="flex flex-col sm:flex-row sm:items-end gap-3 sm:gap-4">
          <div className="flex-1 min-w-0">
            <label className="text-[11px] sm:text-xs font-medium text-ink-secondary flex items-center gap-1.5 mb-1.5 sm:mb-2 tracking-wide">
              <Zap size={12} className="text-status-orange fill-status-orange" />
              טווח מהיר
            </label>
            <div className="grid grid-cols-2 gap-2">
              {PRESET_FEATURED.map(p => (
                <Button
                  key={p}
                  variant={filters.preset === p ? 'primary' : 'secondary'}
                  onClick={() => selectPreset(p)}
                  className={cn(
                    'rounded-lg text-sm font-semibold',
                    filters.preset === p
                      ? 'border-accent shadow-glass'
                      : 'hover:border-accent/40 active:scale-[0.98]',
                  )}
                >
                  {PRESET_LABELS[p]}
                </Button>
              ))}
            </div>
          </div>

          <div className="sm:w-[200px]">
            <label className="text-[11px] sm:text-xs font-medium text-ink-secondary flex items-center gap-1.5 mb-1.5 sm:mb-2 tracking-wide">
              <Store size={12} />
              חנות
            </label>
            <div className="relative">
              <select
                value={filters.store}
                onChange={e => onChange({ ...filters, store: e.target.value })}
                className="w-full appearance-none rounded-lg border border-glass-edge bg-glass-1 ps-3 pe-9 py-2.5 sm:py-2 text-sm font-medium text-ink hover:border-glass-edge-hot focus:outline-none focus:border-accent transition-colors cursor-pointer"
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
                className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2 text-ink-muted"
              />
            </div>
          </div>
        </div>

        {/* ===== Selected range banner ===== */}
        <div className="flex items-center justify-between rounded-lg bg-glass-2 px-3 py-2 text-xs sm:text-sm">
          <div className="flex items-center gap-2 text-ink-secondary">
            <Calendar size={13} className="text-ink-muted" />
            <span className="tabular-nums">
              {formatDate(filters.range.from)} — {formatDate(filters.range.to)}
            </span>
          </div>
          <span className="font-semibold text-ink tabular-nums">{days} ימים</span>
        </div>

        {/* ===== Advanced toggle ===== */}
        <Button
          type="button"
          variant="ghost"
          onClick={() => setAdvancedOpen(v => !v)}
          className="h-auto p-0 text-[11px] sm:text-xs text-ink-secondary hover:text-ink gap-1 font-medium"
        >
          <ChevronDown
            size={13}
            className={cn('transition-transform duration-DEFAULT', showAdvanced && 'rotate-180')}
          />
          טווחים נוספים
        </Button>

        {showAdvanced && (
          <div className="space-y-3 pt-1 animate-fade-in">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-1.5">
              {PRESET_SECONDARY.map(p => (
                <Button
                  key={p}
                  variant={filters.preset === p ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => selectPreset(p)}
                  className={cn(
                    'rounded-lg text-xs sm:text-sm font-medium',
                    filters.preset === p
                      ? 'border-accent shadow-glass'
                      : 'hover:border-accent/40 active:scale-[0.98]',
                  )}
                >
                  {PRESET_LABELS[p]}
                </Button>
              ))}
            </div>

            {filters.preset === 'custom' && (
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-center gap-2">
                <input
                  type="date"
                  value={filters.range.from}
                  max={todayInIsrael()}
                  onChange={e => {
                    const next = applyFromCandidate(
                      filters.range,
                      e.target.value,
                      todayInIsrael(),
                    );
                    if (next === null) return;
                    onChange({ ...filters, range: next });
                  }}
                  className="rounded-lg border border-glass-edge bg-glass-1 px-3 py-2 text-sm w-full text-ink focus:outline-none focus:border-accent transition-colors"
                />
                <span className="text-ink-secondary text-center hidden sm:inline">—</span>
                <input
                  type="date"
                  value={filters.range.to}
                  max={todayInIsrael()}
                  onChange={e => {
                    const next = applyToCandidate(
                      filters.range,
                      e.target.value,
                      todayInIsrael(),
                    );
                    if (next === null) return;
                    onChange({ ...filters, range: next });
                  }}
                  className="rounded-lg border border-glass-edge bg-glass-1 px-3 py-2 text-sm w-full text-ink focus:outline-none focus:border-accent transition-colors"
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
