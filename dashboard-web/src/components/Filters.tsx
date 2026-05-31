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
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { NativeSelect } from '@/components/ui/NativeSelect';
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
    <Card className="!p-0 overflow-hidden w-full">
      {/* ===== Compact horizontal strip =====
       *
       * 2026-05-31 UX rework — was a tall right-aligned block (~300 px) with
       * the featured presets in a 2×2 grid stacked above a separate store
       * picker, a selected-range banner row, and a full-width "טווחים
       * נוספים" toggle row. Operator feedback: leaves the rest of the page
       * empty on the side. New layout collapses everything into ONE flex
       * row that spans the full page width and wraps at narrow viewports.
       *
       *   [⚡ טווח מהיר] [היום][אתמול][7 ימים][מתחילת החודש] | [חנות ▾] | [📅 from — to · N ימים] | [▾ טווחים נוספים]
       *
       * The advanced section (secondary presets + custom-date inputs) is
       * still toggled inline beneath the strip but only appears when the
       * operator opens it (or auto-opens because a secondary/custom preset
       * is active).
       */}
      <div className="px-3 py-2.5 sm:px-4 sm:py-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
          {/* Label (anchor on the right under RTL) */}
          <div className="flex items-center gap-1.5 text-[11px] sm:text-xs font-medium text-ink-secondary tracking-wide whitespace-nowrap">
            <Zap size={12} className="text-status-orange fill-status-orange" />
            טווח מהיר
          </div>

          {/* Featured presets — wrap naturally if width is constrained */}
          <div className="flex flex-wrap items-center gap-1.5">
            {PRESET_FEATURED.map(p => (
              <Button
                key={p}
                variant={filters.preset === p ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => selectPreset(p)}
                className={cn(
                  'rounded-lg text-xs sm:text-sm font-semibold',
                  filters.preset === p
                    ? 'border-accent shadow-glass'
                    : 'hover:border-accent/40 active:scale-[0.98]',
                )}
              >
                {PRESET_LABELS[p]}
              </Button>
            ))}
          </div>

          {/* Spacer pushes store-picker + range banner + toggle to the
           * opposite end of the row. `flex-1` only takes effect when there
           * is room to grow; otherwise the wrap absorbs it. */}
          <div className="hidden md:block flex-1" />

          {/* Store picker — compact inline */}
          <div className="flex items-center gap-1.5">
            <Store size={13} className="text-ink-muted" aria-hidden="true" />
            <NativeSelect
              value={filters.store}
              onChange={e => onChange({ ...filters, store: e.target.value })}
              className="h-8 py-0 text-xs sm:text-sm font-medium min-w-[140px]"
              aria-label="חנות"
            >
              <option value="All">כל החנויות</option>
              {stores.map(s => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </NativeSelect>
          </div>

          {/* Selected range chip */}
          <div className="flex items-center gap-2 rounded-lg bg-glass-2 px-2.5 py-1.5 text-xs sm:text-sm whitespace-nowrap">
            <Calendar size={13} className="text-ink-muted" aria-hidden="true" />
            <span className="tabular-nums text-ink-secondary">
              {formatDate(filters.range.from)} — {formatDate(filters.range.to)}
            </span>
            <span className="font-semibold text-ink tabular-nums">· {days} ימים</span>
          </div>

          {/* Advanced toggle — inline chevron button */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setAdvancedOpen(v => !v)}
            className="h-8 px-2 text-[11px] sm:text-xs text-ink-secondary hover:text-ink gap-1 font-medium"
            aria-expanded={showAdvanced}
          >
            <ChevronDown
              size={13}
              className={cn('transition-transform duration-DEFAULT', showAdvanced && 'rotate-180')}
            />
            טווחים נוספים
          </Button>
        </div>

        {showAdvanced && (
          <div className="space-y-2.5 pt-2.5 mt-2.5 border-t border-glass-edge animate-fade-in">
            <div className="flex flex-wrap items-center gap-1.5">
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
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-center gap-2 max-w-md">
                <Input
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
                />
                <span className="text-ink-secondary text-center hidden sm:inline">—</span>
                <Input
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
                />
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
