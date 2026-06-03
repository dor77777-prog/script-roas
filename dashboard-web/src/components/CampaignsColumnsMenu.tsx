'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Columns3, RotateCcw, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { HelpTooltip } from '@/components/ui/Tooltip';
import { Heading } from '@/components/ui/Typography';
import {
  CAMPAIGNS_COLUMNS,
  REORDERABLE_COLUMN_IDS,
  readCampaignsColumnPrefs,
  toggleCampaignsColumnHidden,
  restoreAllCampaignsColumns,
  resetCampaignsColumnsToDefault,
  resolveCampaignsColumnOrder,
  moveCampaignsColumn,
  resetCampaignsColumnOrder,
  type CampaignsColumnPrefs,
} from '@/lib/campaignsColumnPrefs';

/**
 * Phase 05.7.9d — column-visibility menu for the Campaigns table.
 *
 * A button + popover that lists every column with a checkbox so the
 * operator can hide columns they don't care about. State persists in
 * localStorage and cloud-syncs (so the same hidden set follows the
 * operator across browsers).
 *
 * Pinned columns (campaign name, deep-link) are NOT toggleable — they
 * are filtered out of the list to keep the table usable.
 *
 * Reorder + color customization are deferred (Phase B).
 */
export function CampaignsColumnsMenu({
  mode,
}: {
  mode: 'campaign' | 'adset';
}) {
  const [open, setOpen] = useState(false);
  // SSR seed is intentionally `{hidden:[]}` (not the lean default seed): the
  // menu body only renders inside the popover, which is closed (`open=false`)
  // on first paint, so this value is never shown before the client mounts and
  // re-reads real prefs via readCampaignsColumnPrefs(). Harmless asymmetry.
  const [prefs, setPrefs] = useState<CampaignsColumnPrefs>(() =>
    typeof window === 'undefined' ? { hidden: [] } : readCampaignsColumnPrefs(),
  );
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Listen for cloud-sync updates (another device toggled a column).
  useEffect(() => {
    const onChange = () => setPrefs(readCampaignsColumnPrefs());
    window.addEventListener(
      'roas-campaigns-column-visibility-changed',
      onChange,
    );
    return () =>
      window.removeEventListener(
        'roas-campaigns-column-visibility-changed',
        onChange,
      );
  }, []);

  // Close on Esc + click-outside.
  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (!popoverRef.current) return;
      if (popoverRef.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onEsc);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onEsc);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  // Phase 05.7.x — order the visible list by the operator's saved
  // metric-column order. Structural columns (pinned + non-reorderable)
  // are appended at the end in their canonical positions. Metric columns
  // appear in the order they'll actually render in the table, so the
  // operator sees the change instantly when they click the up/down
  // chevrons.
  const REORDERABLE = REORDERABLE_COLUMN_IDS as readonly string[];
  const toggleable = useMemo(() => {
    const canonical = CAMPAIGNS_COLUMNS.filter(c => {
      if (c.pinned) return false;
      if (c.campaignOnly && mode !== 'campaign') return false;
      return true;
    });
    const effectiveOrder = resolveCampaignsColumnOrder(prefs.order);
    const orderIndex = new Map<string, number>();
    effectiveOrder.forEach((id, idx) => orderIndex.set(id, idx));
    return [...canonical].sort((a, b) => {
      const aReord = REORDERABLE.includes(a.id);
      const bReord = REORDERABLE.includes(b.id);
      // Non-reorderable columns (e.g. optimized checkbox) sink to the
      // bottom of the list — the operator can still hide them but can't
      // move them.
      if (aReord !== bReord) return aReord ? -1 : 1;
      if (aReord && bReord) {
        return (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0);
      }
      return 0;
    });
  }, [mode, prefs.order]);

  const hiddenCount = prefs.hidden.length;
  const hasCustomOrder = !!prefs.order && prefs.order.length > 0;

  const toggle = (id: string) => {
    const next = toggleCampaignsColumnHidden(id);
    setPrefs(next);
  };

  const restoreAll = () => {
    const next = restoreAllCampaignsColumns();
    setPrefs(next);
  };

  const move = (id: string, direction: 'up' | 'down') => {
    const next = moveCampaignsColumn(id, direction);
    setPrefs(next);
  };

  const resetOrder = () => {
    const next = resetCampaignsColumnOrder();
    setPrefs(next);
  };

  const resetToDefault = () => {
    const next = resetCampaignsColumnsToDefault();
    setPrefs(next);
  };

  return (
    <div className="relative" ref={popoverRef}>
      <HelpTooltip
        content={
          hiddenCount > 0
            ? `${hiddenCount} עמודות מוסתרות — לחץ לעריכה`
            : 'הסתר/הצג עמודות בטבלה'
        }
      >
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setOpen(v => !v)}
          className={cn(
            'gap-1.5',
            hiddenCount > 0
              ? 'border-status-warning bg-status-warningBg text-status-warningFg hover:bg-status-warningBg'
              : '',
          )}
          aria-haspopup="true"
          aria-expanded={open}
        >
          <Columns3 size={13} />
          <span>עמודות</span>
          {hiddenCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-status-warningBg text-status-warningFg text-[10px] font-bold">
              {hiddenCount}
            </span>
          )}
        </Button>
      </HelpTooltip>

      {open && (
        <div
          role="dialog"
          aria-label="עריכת עמודות"
          className="absolute end-0 top-full mt-1 z-30 w-[300px] rounded-xl border border-glass-edge bg-glass-1 shadow-overlay p-3"
        >
          <div className="flex items-center justify-between mb-2">
            <Heading level="panel">
              עמודות בטבלה
            </Heading>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setOpen(false)}
              aria-label="סגור"
            >
              <X size={14} />
            </Button>
          </div>
          <p className="text-[10px] text-ink-muted leading-relaxed mb-2">
            סמן/בטל סימון כדי להציג/להסתיר עמודות. ההגדרות שמורות בכל הדפדפנים שלך.
          </p>
          <ul className="space-y-1 max-h-[420px] overflow-auto">
            {(() => {
              // Pre-compute the up/down boundary indices among reorderable
              // entries so the chevron disabled state stays in sync with
              // the rendered order (first reorderable can't move up, last
              // can't move down).
              const reorderableIdxs = toggleable
                .map((c, i) => (REORDERABLE.includes(c.id) ? i : -1))
                .filter(i => i >= 0);
              const firstReord = reorderableIdxs[0] ?? -1;
              const lastReord =
                reorderableIdxs[reorderableIdxs.length - 1] ?? -1;
              return toggleable.map((col, idx) => {
                const isHidden = prefs.hidden.includes(col.id);
                const isReorderable = REORDERABLE.includes(col.id);
                const canUp = isReorderable && idx > firstReord;
                const canDown = isReorderable && idx < lastReord;
                return (
                  <li key={col.id} className="flex items-stretch gap-1">
                    <HelpTooltip content={col.description ?? ''}>
                      <label
                        className={cn(
                          'flex items-start gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors flex-1 min-w-0',
                          'hover:bg-glass-2',
                        )}
                      >
                        <Input
                          type="checkbox"
                          checked={!isHidden}
                          onChange={() => toggle(col.id)}
                          className="mt-0.5 shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs text-ink">{col.label}</div>
                          {col.description && (
                            <div className="text-[10px] text-ink-muted leading-snug">
                              {col.description}
                            </div>
                          )}
                        </div>
                      </label>
                    </HelpTooltip>
                    {/* Phase 05.7.x — up/down chevrons for reorderable
                        metric columns. Structural columns (optimized, etc.)
                        get no controls; their slot stays empty so the row
                        baselines line up with their reorderable siblings.

                        Column-audit 2026-06-01 (FIX 4) — the chevrons were
                        invisible in BOTH themes (transparent ghost buttons,
                        icon-only). Give them a visible AA treatment: a real
                        button surface (bg-glass-2 + glass-edge border) with an
                        ink-secondary icon (→ ink on hover), a clearly-dimmed
                        disabled state at the list ends, and a ≥24px tap target.
                        Token-only — passes the design-color green-ratchet. */}
                    {isReorderable && (
                      <div className="flex flex-col gap-0.5 shrink-0 self-center">
                        <HelpTooltip content="הזז למעלה">
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => move(col.id, 'up')}
                            disabled={!canUp}
                            aria-label={`הזז ${col.label} למעלה`}
                            className={cn(
                              'w-6 h-6 rounded-md border p-0',
                              canUp
                                ? 'bg-glass-2 border-glass-edge text-ink-secondary hover:text-ink hover:bg-glass-1'
                                : 'bg-glass-2 border-glass-edge text-ink-subtle opacity-40 cursor-not-allowed',
                            )}
                          >
                            <ChevronUp size={13} />
                          </Button>
                        </HelpTooltip>
                        <HelpTooltip content="הזז למטה">
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => move(col.id, 'down')}
                            disabled={!canDown}
                            aria-label={`הזז ${col.label} למטה`}
                            className={cn(
                              'w-6 h-6 rounded-md border p-0',
                              canDown
                                ? 'bg-glass-2 border-glass-edge text-ink-secondary hover:text-ink hover:bg-glass-1'
                                : 'bg-glass-2 border-glass-edge text-ink-subtle opacity-40 cursor-not-allowed',
                            )}
                          >
                            <ChevronDown size={13} />
                          </Button>
                        </HelpTooltip>
                      </div>
                    )}
                  </li>
                );
              });
            })()}
          </ul>
          <div className="mt-2 pt-2 border-t border-glass-edge flex flex-col gap-1.5">
            {/* Always available — snaps the table back to the recommended lean
                default view (default-hidden set + canonical order). The
                explicit counterpart to the one-time declutter migration. */}
            <Button
              type="button"
              variant="ghost"
              onClick={resetToDefault}
              className="h-auto p-0 gap-1.5 text-xs text-accent hover:text-accent-deep font-medium"
            >
              <RotateCcw size={12} />
              <span>החזר לתצוגת ברירת מחדל</span>
            </Button>
            {hiddenCount > 0 && (
              <Button
                type="button"
                variant="ghost"
                onClick={restoreAll}
                className="h-auto p-0 gap-1.5 text-xs text-accent hover:text-accent-deep font-medium"
              >
                <RotateCcw size={12} />
                <span>השב את כל העמודות</span>
              </Button>
            )}
            {hasCustomOrder && (
              <Button
                type="button"
                variant="ghost"
                onClick={resetOrder}
                className="h-auto p-0 gap-1.5 text-xs text-accent hover:text-accent-deep font-medium"
              >
                <RotateCcw size={12} />
                <span>אפס סדר עמודות</span>
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
