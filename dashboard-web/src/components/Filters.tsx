'use client';

import { useEffect, useRef, useState } from 'react';
import {
  PRESET_FEATURED,
  PRESET_LABELS,
  PRESET_SECONDARY,
  COMPARE_BASELINE_LABELS,
  computePresetRange,
} from '@/lib/presets';
import type { CompareBaseline } from '@/lib/presets';
import type { Filters as F, PresetKey } from '@/lib/types';
import { Bookmark, Calendar, ChevronDown, Pencil, Store, Trash2, Zap } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { NativeSelect } from '@/components/ui/NativeSelect';
import { applyFromCandidate, applyToCandidate } from '@/lib/rangeClamp';
import { useSavedViews } from '@/lib/hooks/useSavedViews';
import {
  saveView,
  deleteView,
  renameView,
  touchView,
  type SavedView,
} from '@/lib/savedViews';

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
  /**
   * Wave 4 (opt-in) — render the period-compare baseline pills below the main
   * strip. Defaults false so every existing call-site is byte-identical.
   */
  showCompareBaseline?: boolean;
  /**
   * Wave 4 (opt-in) — render the saved-views dropdown in the strip. Defaults
   * false so existing call-sites are unaffected.
   */
  showSavedViews?: boolean;
};

/** Canonical compare-baseline order for the pill row. */
const COMPARE_BASELINE_ORDER: CompareBaseline[] = [
  'prev_period',
  'prev_7d',
  'prev_month',
  'prev_year',
  'none',
];

/**
 * Short pill labels for the MOBILE A3 bar. The two long presets are shortened
 * so 4 pills fit a phone width; 'היום' and 'אתמול' stay verbatim (operator
 * explicitly wants 'אתמול' present and unabbreviated). Keys are the same
 * PRESET_FEATURED entries so this map never drifts from PRESET_LABELS order.
 */
const PILL_SHORT_LABELS: Partial<Record<PresetKey, string>> = {
  last_7_days: '7 ימים',
  this_month: 'מהחודש',
};

export function Filters({
  filters,
  stores,
  onChange,
  showCompareBaseline = false,
  showSavedViews = false,
}: Props) {
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

  // ── A3 mobile pill bar ───────────────────────────────────────────────────
  // The active pill index drives the absolutely-positioned thumb. When the
  // active preset is NOT one of the 4 featured (secondary / custom), the index
  // is -1 → the thumb hides and no pill is marked active. The advanced section
  // + store picker stay reachable on mobile so secondary/custom remain usable.
  const activePillIndex = PRESET_FEATURED.indexOf(filters.preset);
  const hasActivePill = activePillIndex >= 0;
  // RTL thumb math: 4 equal pills in a flex row. inset-inline-start tracks the
  // start edge of pill N at (N/4 * 100%), width is a fixed 25%. Because the
  // wrapper is dir=rtl, `inset-inline-start` resolves to the RIGHT edge, so the
  // thumb correctly slides right→left as the index grows — matching the pills,
  // which are laid out right→left under RTL.
  const thumbStart = `${(Math.max(0, activePillIndex) / PRESET_FEATURED.length) * 100}%`;
  const thumbWidth = `${100 / PRESET_FEATURED.length}%`;

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
            <Zap size={12} className="text-status-orangeFg fill-status-orange" />
            טווח מהיר
          </div>

          {/* Featured presets — DESKTOP (md+). Wrapped `hidden md:flex` so the
           * md+ layout is byte-identical to before; the MOBILE pill bar below
           * (md:hidden) replaces it on small screens. */}
          <div
            className="hidden md:flex flex-wrap items-center gap-1.5"
            data-testid="filters-featured-desktop"
          >
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
                    : 'hover:border-glass-edge-hot active:scale-[0.98]',
                )}
              >
                {PRESET_LABELS[p]}
              </Button>
            ))}
          </div>

          {/* Featured presets — MOBILE (< md). Sliding-thumb pill bar. Full
           * width so the 4 pills + thumb fill the phone row. The thumb is an
           * absolutely-positioned slab UNDER the active pill; it animates
           * between pills with a bouncy curve and is RTL-correct via
           * inset-inline-start. */}
          <div
            className="md:hidden w-full basis-full"
            data-testid="filters-pillbar"
          >
            <div className="relative flex rounded-control bg-pill-track p-1">
              {/* Sliding thumb — hidden (opacity 0) when no featured pill is
               * active so secondary/custom presets degrade gracefully. */}
              <span
                aria-hidden="true"
                data-testid="filters-pill-thumb"
                className="filters-pill-thumb absolute top-1 bottom-1 rounded-[0.5625rem] bg-pill-thumb shadow-soft"
                style={{
                  insetInlineStart: thumbStart,
                  width: thumbWidth,
                  opacity: hasActivePill ? 1 : 0,
                }}
              />
              {PRESET_FEATURED.map(p => {
                const isActive = filters.preset === p;
                return (
                  <Button
                    key={p}
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => selectPreset(p)}
                    aria-pressed={isActive}
                    className={cn(
                      // min-h-[44px] = touch target; relative+z so the label
                      // sits above the thumb slab. Transparent so only the
                      // sliding thumb paints the active background.
                      'relative z-[1] flex-1 h-auto min-h-[44px] px-1 rounded-[0.5625rem]',
                      'bg-transparent hover:bg-transparent text-xs font-bold',
                      'transition-colors duration-DEFAULT active:scale-[0.96]',
                      isActive ? 'text-pill-inkOn' : 'text-pill-ink',
                    )}
                  >
                    {PILL_SHORT_LABELS[p] ?? PRESET_LABELS[p]}
                  </Button>
                );
              })}
            </div>
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

          {/* Saved views — opt-in dropdown (Wave 4) */}
          {showSavedViews && (
            <SavedViewsDropdown filters={filters} onChange={onChange} />
          )}
        </div>

        {/* Compare-baseline pills — opt-in row (Wave 4) */}
        {showCompareBaseline && (
          <div
            data-testid="filters-compare-row"
            className="flex flex-wrap items-center gap-1.5 pt-2.5 mt-2.5 border-t border-glass-edge"
          >
            <span className="text-[11px] sm:text-xs font-medium text-ink-muted whitespace-nowrap me-1">
              בסיס השוואה:
            </span>
            {COMPARE_BASELINE_ORDER.map(b => {
              const isActive = (filters.compareBaseline ?? 'prev_period') === b;
              return (
                <Button
                  key={b}
                  type="button"
                  variant={isActive ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => onChange({ ...filters, compareBaseline: b })}
                  aria-pressed={isActive}
                  className={cn(
                    'rounded-lg text-xs sm:text-sm font-semibold',
                    isActive
                      ? 'border-accent shadow-glass'
                      : 'hover:border-glass-edge-hot active:scale-[0.98]',
                  )}
                >
                  {COMPARE_BASELINE_LABELS[b]}
                </Button>
              );
            })}
          </div>
        )}

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
                      : 'hover:border-glass-edge-hot active:scale-[0.98]',
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

/**
 * Saved-views dropdown (Wave 4). Lists persisted named filter snapshots
 * (most-recently-used first), applies one with relative-range re-derivation,
 * and saves the current filters under a typed name. Renders inline in the page
 * filter bar (not over a Sheet) so a plain absolutely-positioned panel is fine.
 */
function SavedViewsDropdown({
  filters,
  onChange,
}: {
  filters: F;
  onChange: (next: F) => void;
}) {
  const { views } = useSavedViews();
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  // Per-row rename editing — { id, value } while a row is in edit mode.
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Dismiss-on-outside-pointerdown (page-bar dropdown convention — same pattern
  // as RoasTargetChart's crosshair dismissal). Self-scoped to this wrapper.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent | PointerEvent) => {
      const target = e.target as Node | null;
      const wrap = wrapRef.current;
      if (!target || !wrap) return;
      if (!wrap.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [open]);

  // Most-recently-used first.
  const sorted = Object.entries(views).sort(
    ([, a], [, b]) => (a.meta.lastUsedAt < b.meta.lastUsedAt ? 1 : -1),
  );

  function applyView(id: string, view: SavedView) {
    // Relative ranges re-derive so a saved "this month" tracks the CURRENT
    // month rather than freezing the stored range; 'custom' applies verbatim.
    // Either way `store` AND the saved `compareBaseline` come straight from the
    // view (spreading view.filters preserves the optional compareBaseline), so
    // applying a view restores its comparison baseline rather than resetting it.
    const next: F =
      view.filters.preset === 'custom'
        ? { ...view.filters }
        : { ...view.filters, range: computePresetRange(view.filters.preset) };
    onChange(next);
    touchView(id);
    setOpen(false);
  }

  function commitRename() {
    if (!editing) return;
    const name = editing.value.trim();
    if (name) renameView(editing.id, name);
    setEditing(null);
  }

  function handleSave() {
    const name = newName.trim();
    if (!name) return;
    saveView(name, filters);
    setNewName('');
  }

  return (
    <div ref={wrapRef} className="relative" data-testid="filters-savedviews">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="h-8 px-2 text-[11px] sm:text-xs text-ink-secondary hover:text-ink gap-1 font-medium"
      >
        <Bookmark size={13} aria-hidden="true" />
        תצוגות שמורות
        <ChevronDown
          size={13}
          className={cn('transition-transform duration-DEFAULT', open && 'rotate-180')}
        />
      </Button>

      {open && (
        <div
          className="absolute z-20 mt-1 w-72 max-w-sm rounded-control border border-glass-edge bg-glass-2 p-1.5 shadow-glass animate-fade-in"
          style={{ insetInlineEnd: 0 }}
        >
          {sorted.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-ink-muted">אין תצוגות שמורות</p>
          ) : (
            <ul className="space-y-0.5">
              {sorted.map(([id, view]) =>
                editing?.id === id ? (
                  <li key={id} className="px-1 py-1">
                    <Input
                      autoFocus
                      value={editing.value}
                      onChange={e => setEditing({ id, value: e.target.value })}
                      onKeyDown={e => {
                        if (e.key === 'Enter') commitRename();
                        if (e.key === 'Escape') setEditing(null);
                      }}
                      onBlur={commitRename}
                      className="h-9 text-xs"
                      aria-label="שם תצוגה"
                    />
                  </li>
                ) : (
                  <li
                    key={id}
                    className="flex items-center gap-1 rounded-md hover:bg-glass-1"
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => applyView(id, view)}
                      dir="auto"
                      className="flex-1 justify-start h-auto min-h-[44px] px-2 text-start text-xs sm:text-sm font-medium text-ink hover:bg-transparent"
                    >
                      {view.name || '(ללא שם)'}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setEditing({ id, value: view.name })}
                      aria-label={`שנה שם: ${view.name}`}
                      className="min-h-11 min-w-11 text-ink-muted hover:text-ink"
                    >
                      <Pencil size={14} aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteView(id)}
                      aria-label={`מחק תצוגה: ${view.name}`}
                      className="min-h-11 min-w-11 text-ink-muted hover:text-status-redFg"
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </Button>
                  </li>
                ),
              )}
            </ul>
          )}

          <div className="my-1.5 border-t border-glass-edge" />

          <div className="flex items-center gap-1.5 px-1 pb-0.5">
            <Input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleSave();
              }}
              placeholder="שם לתצוגה הנוכחית"
              className="h-9 text-xs"
              aria-label="שם לתצוגה הנוכחית"
            />
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleSave}
              disabled={newName.trim().length === 0}
              className="shrink-0 rounded-lg text-xs font-semibold"
            >
              שמור תצוגה
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
