'use client';

import { useEffect, useRef, useState } from 'react';
import { Columns3, RotateCcw, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  CAMPAIGNS_COLUMNS,
  readCampaignsColumnPrefs,
  toggleCampaignsColumnHidden,
  restoreAllCampaignsColumns,
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

  // Filter pinned + mode-specific columns out of the toggle list.
  const toggleable = CAMPAIGNS_COLUMNS.filter(c => {
    if (c.pinned) return false;
    if (c.campaignOnly && mode !== 'campaign') return false;
    return true;
  });

  const hiddenCount = prefs.hidden.length;

  const toggle = (id: string) => {
    const next = toggleCampaignsColumnHidden(id);
    setPrefs(next);
  };

  const restoreAll = () => {
    const next = restoreAllCampaignsColumns();
    setPrefs(next);
  };

  return (
    <div className="relative" ref={popoverRef}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs sm:text-sm transition-colors',
          hiddenCount > 0
            ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
            : 'border-border bg-surface text-text-secondary hover:bg-surfaceMuted',
        )}
        title={
          hiddenCount > 0
            ? `${hiddenCount} עמודות מוסתרות — לחץ לעריכה`
            : 'הסתר/הצג עמודות בטבלה'
        }
        aria-haspopup="true"
        aria-expanded={open}
      >
        <Columns3 size={13} />
        <span>עמודות</span>
        {hiddenCount > 0 && (
          <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-amber-200 text-amber-900 text-[10px] font-bold">
            {hiddenCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="עריכת עמודות"
          className="absolute end-0 top-full mt-1 z-30 w-[300px] rounded-xl border border-border bg-surface shadow-elevated p-3"
        >
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-text-primary">
              עמודות בטבלה
            </h3>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="סגור"
              className="text-text-muted hover:text-text-primary rounded p-1"
            >
              <X size={14} />
            </button>
          </div>
          <p className="text-[10px] text-text-muted leading-relaxed mb-2">
            סמן/בטל סימון כדי להציג/להסתיר עמודות. ההגדרות שמורות בכל הדפדפנים שלך.
          </p>
          <ul className="space-y-1 max-h-[420px] overflow-auto">
            {toggleable.map(col => {
              const isHidden = prefs.hidden.includes(col.id);
              return (
                <li key={col.id}>
                  <label
                    className={cn(
                      'flex items-start gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors',
                      'hover:bg-surfaceMuted',
                    )}
                    title={col.description ?? ''}
                  >
                    <input
                      type="checkbox"
                      checked={!isHidden}
                      onChange={() => toggle(col.id)}
                      className="mt-0.5 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-text-primary">{col.label}</div>
                      {col.description && (
                        <div className="text-[10px] text-text-muted leading-snug">
                          {col.description}
                        </div>
                      )}
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
          {hiddenCount > 0 && (
            <div className="mt-2 pt-2 border-t border-borderSubtle">
              <button
                type="button"
                onClick={restoreAll}
                className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-medium"
              >
                <RotateCcw size={12} />
                <span>השב את כל העמודות</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
