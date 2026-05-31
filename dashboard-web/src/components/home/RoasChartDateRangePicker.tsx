'use client';

/**
 * Task 3.2 — date-range picker for <RoasTargetChart>.
 *
 * INDEPENDENT of the page-level range tabs by design — the chart owns its
 * own window so the operator can read a 90-day arc without losing the
 * page-wide "today" snapshot above. Persistence via `?chartRange=` URL
 * param so refresh / share keeps the chart's window. Default is 30 days.
 *
 * Picker UX:
 *   • 6 preset chip buttons (7 / 30 / 90 / MTD / QTD / YTD) inline.
 *   • A "מותאם" toggle that reveals two native `<input type="date" />`
 *     pickers (no heavyweight dep — the spec explicitly avoids adding a
 *     new DatePicker library). Selecting a valid from+to range emits
 *     onRangeChange('custom', { from, to }) and writes
 *     `?chartRange=custom&chartFrom=…&chartTo=…` to the URL.
 *
 * Why native inputs instead of a shadcn DatePicker? The codebase doesn't
 * ship a DatePicker primitive (grep confirmed 0 hits) and the v2 plan
 * forbids adding new heavyweight deps. The native `<input type="date" />`
 * gives us a real OS-level calendar on mobile + decent desktop chrome
 * without 50 KB of JS — acceptable tradeoff for an internal-tool date
 * field that's already polished by the URL persistence.
 */

import { useCallback, useEffect, useId, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { RoasChartRangeKey } from '@/lib/synthesis/roasChart';

/* --------------------------------------------------------------------------
 * Custom-range shape — mirrors the global `DateRange` but kept local so this
 * primitive does not import from `lib/types` (keeps the surface narrow + the
 * primitive trivially reusable outside of Dashboard.tsx).
 * -------------------------------------------------------------------------- */

export interface ChartCustomRange {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
}

export interface RoasChartDateRangePickerProps {
  /** Current selection. Owner reads this from URL on mount. */
  value: RoasChartRangeKey;
  /** Owner reads this from URL too — only meaningful when value='custom'. */
  customRange?: ChartCustomRange;
  /** Emitted when the operator picks a preset OR confirms a custom range. */
  onRangeChange: (
    next: RoasChartRangeKey,
    customRange?: ChartCustomRange,
  ) => void;
  className?: string;
}

/* --------------------------------------------------------------------------
 * Preset metadata. Hebrew labels match the existing `PRESET_LABELS` style
 * (uppercase mono for ALL-caps acronyms only — Hebrew labels are plain).
 * -------------------------------------------------------------------------- */

const PRESETS: ReadonlyArray<{ key: RoasChartRangeKey; label: string }> = [
  { key: '7',   label: '7 ימים' },
  { key: '30',  label: '30 ימים' },
  { key: '90',  label: '90 ימים' },
  { key: 'mtd', label: 'מהחודש' },
  { key: 'qtd', label: 'מהרבעון' },
  { key: 'ytd', label: 'מהשנה' },
] as const;

const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

/* --------------------------------------------------------------------------
 * URL helpers — owned here so the chart card can stay declarative. The
 * Dashboard.tsx wiring can also import these to seed the initial value
 * server-side (Next.js SSR doesn't have access to window.location, so the
 * read happens client-side on mount — initial render uses '30' default).
 * -------------------------------------------------------------------------- */

export function readChartRangeFromUrl(search: string): {
  range: RoasChartRangeKey;
  customRange?: ChartCustomRange;
} {
  if (!search) return { range: '30' };
  const params = new URLSearchParams(
    search.startsWith('?') ? search.slice(1) : search,
  );
  const raw = params.get('chartRange');
  if (!raw) return { range: '30' };
  const allowed: RoasChartRangeKey[] = ['7', '30', '90', 'mtd', 'qtd', 'ytd', 'custom'];
  if (!(allowed as string[]).includes(raw)) return { range: '30' };
  const range = raw as RoasChartRangeKey;
  if (range === 'custom') {
    const from = params.get('chartFrom');
    const to = params.get('chartTo');
    if (from && to && DATE_RX.test(from) && DATE_RX.test(to)) {
      return { range, customRange: { from, to } };
    }
    // Custom requested but no valid bounds — degrade gracefully to default.
    return { range: '30' };
  }
  return { range };
}

export function writeChartRangeToUrl(
  range: RoasChartRangeKey,
  customRange?: ChartCustomRange,
): void {
  if (typeof window === 'undefined') return;
  const existing = new URLSearchParams(
    window.location.search.startsWith('?')
      ? window.location.search.slice(1)
      : window.location.search,
  );

  // Always clear all three params first — keeps the URL clean when the
  // operator toggles between presets and custom.
  existing.delete('chartRange');
  existing.delete('chartFrom');
  existing.delete('chartTo');

  if (range !== '30') {
    existing.set('chartRange', range);
    if (range === 'custom' && customRange) {
      existing.set('chartFrom', customRange.from);
      existing.set('chartTo', customRange.to);
    }
  }

  const next = existing.toString();
  const nextSearch = next ? `?${next}` : '';
  if (nextSearch === window.location.search) return;
  const url = window.location.pathname + nextSearch + window.location.hash;
  window.history.replaceState(null, '', url);
}

/* --------------------------------------------------------------------------
 * Component
 * -------------------------------------------------------------------------- */

export function RoasChartDateRangePicker({
  value,
  customRange,
  onRangeChange,
  className,
}: RoasChartDateRangePickerProps) {
  const [customOpen, setCustomOpen] = useState(value === 'custom');
  const [draftFrom, setDraftFrom] = useState(customRange?.from ?? '');
  const [draftTo, setDraftTo] = useState(customRange?.to ?? '');
  const fromId = useId();
  const toId = useId();

  // Keep the open state in sync if the URL is restored to 'custom' from
  // an external source (e.g. bookmark) after mount.
  useEffect(() => {
    if (value === 'custom' && !customOpen) setCustomOpen(true);
  }, [value, customOpen]);

  const handlePreset = useCallback(
    (key: RoasChartRangeKey) => {
      setCustomOpen(false);
      onRangeChange(key);
    },
    [onRangeChange],
  );

  const handleApplyCustom = useCallback(() => {
    if (!DATE_RX.test(draftFrom) || !DATE_RX.test(draftTo)) return;
    if (draftFrom > draftTo) return;
    onRangeChange('custom', { from: draftFrom, to: draftTo });
  }, [draftFrom, draftTo, onRangeChange]);

  return (
    <div
      className={cn(
        'flex flex-col items-end gap-2',
        className,
      )}
      data-testid="chart-range-picker"
    >
      {/* Preset chips ----------------------------------------------------- */}
      {/* Note: we use Button with size="sm" + a custom className override
          for chip-like compactness. The Button primitive enforces the
          focus-ring contrast invariant (P0-11) so we get correct a11y
          behaviour for free. */}
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="טווח תאריכים לתרשים">
        {PRESETS.map((p) => {
          const active = value === p.key;
          return (
            <Button
              key={p.key}
              type="button"
              variant={active ? 'secondary' : 'ghost'}
              size="sm"
              data-testid={`chart-range-preset-${p.key}`}
              aria-pressed={active}
              onClick={() => handlePreset(p.key)}
              className={cn(
                'h-7 px-2.5 text-[11px] font-mono font-medium tracking-wide',
                active
                  ? 'border border-accent/50 bg-accent/[0.10] text-ink'
                  : 'border border-glass-edge bg-glass-2 text-ink-muted hover:text-ink hover:bg-glass-1 hover:border-accent/30',
              )}
            >
              {p.label}
            </Button>
          );
        })}
        <Button
          type="button"
          variant={value === 'custom' ? 'secondary' : 'ghost'}
          size="sm"
          data-testid="chart-range-custom-toggle"
          aria-pressed={value === 'custom'}
          aria-expanded={customOpen}
          onClick={() => setCustomOpen((open) => !open)}
          className={cn(
            'h-7 px-2.5 text-[11px] font-mono font-medium tracking-wide',
            value === 'custom'
              ? 'border border-accent/50 bg-accent/[0.10] text-ink'
              : 'border border-glass-edge bg-glass-2 text-ink-muted hover:text-ink hover:bg-glass-1 hover:border-accent/30',
          )}
        >
          מותאם
        </Button>
      </div>

      {/* Custom from/to inputs — revealed on demand --------------------- */}
      {customOpen && (
        <div
          className="flex items-center gap-2"
          data-testid="chart-range-custom-panel"
        >
          <label className="flex items-center gap-1 text-[10px] text-ink-muted font-mono uppercase tracking-wide">
            <span>מ-</span>
            <Input
              id={fromId}
              type="date"
              data-testid="chart-range-from-input"
              value={draftFrom}
              onChange={(e) => setDraftFrom(e.target.value)}
              className="h-7 w-auto text-[11px] font-mono py-0.5 px-1.5"
            />
          </label>
          <label className="flex items-center gap-1 text-[10px] text-ink-muted font-mono uppercase tracking-wide">
            <span>עד</span>
            <Input
              id={toId}
              type="date"
              data-testid="chart-range-to-input"
              value={draftTo}
              onChange={(e) => setDraftTo(e.target.value)}
              className="h-7 w-auto text-[11px] font-mono py-0.5 px-1.5"
            />
          </label>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            data-testid="chart-range-custom-apply"
            onClick={handleApplyCustom}
            disabled={!DATE_RX.test(draftFrom) || !DATE_RX.test(draftTo) || draftFrom > draftTo}
            className="h-7 px-2 text-[11px] font-mono font-medium border border-accent/40 bg-accent/[0.12] text-ink hover:bg-accent/[0.20]"
          >
            החל
          </Button>
        </div>
      )}
    </div>
  );
}
