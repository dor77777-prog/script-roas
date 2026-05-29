'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { CampaignHealth, HealthGrade } from '@/lib/campaignHealthScore';

/**
 * Per-campaign Health Score badge with click-to-drill popover.
 *
 * Renders as a 1-letter grade chip (A/B/C/D/F or ⏳ when insufficient).
 * Clicking the chip opens a popover showing the 5-component breakdown so
 * the operator can argue with the verdict.
 *
 * z-index ladder: popover at z-[15] (matches the ColumnHeaderTh tooltip
 * pattern in CampaignsTable.tsx, sits above row body but below the page
 * Header z-30 / TabNav z-20 — same as the rest of the stacking ladder
 * from commit e45f743).
 */

const GRADE_STYLES: Record<HealthGrade, { chip: string; ring: string; label: string }> = {
  A: { chip: 'bg-status-greenBg text-status-green', ring: 'ring-status-green/30', label: 'מצוין' },
  B: { chip: 'bg-status-blueBg text-status-blue', ring: 'ring-status-blue/30', label: 'בריא' },
  C: { chip: 'bg-status-orangeBg text-status-orange', ring: 'ring-status-orange/30', label: 'גבולי' },
  D: { chip: 'bg-status-redBg text-status-red', ring: 'ring-status-red/30', label: 'בעייתי' },
  F: { chip: 'bg-status-redBg text-status-red', ring: 'ring-status-red/40', label: 'כשל' },
  unknown: { chip: 'bg-elevated2 text-ink-muted', ring: 'ring-line-subtle', label: 'מוקדם מדי' },
};

const COMPONENT_LABELS = {
  profitability: { label: 'רווחיות', weight: '40%' },
  volume: { label: 'נפח', weight: '15%' },
  trajectory: { label: 'מומנטום', weight: '25%' },
  attributionClarity: { label: 'אמינות attribution', weight: '20%' },
} as const;

export function HealthScoreBadge({ health }: { health: CampaignHealth }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const styles = GRADE_STYLES[health.grade];
  const isUnknown = health.grade === 'unknown';

  return (
    <div ref={containerRef} className="relative inline-flex">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={`${styles.label}${isUnknown ? '' : ` · ${health.score}/100`} — לחץ לפירוט`}
        className={cn(
          'inline-flex items-center justify-center min-w-[34px] h-7',
          'rounded-md px-1.5 text-[12px] font-bold leading-none tabular-nums',
          'ring-1 transition-all cursor-pointer select-none',
          'hover:opacity-90 active:scale-95',
          styles.chip,
          styles.ring,
        )}
      >
        {isUnknown ? '⏳' : health.grade}
        {!isUnknown && (
          <span className="ms-1 text-[10px] font-medium text-ink-secondary/90">
            {health.score}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          dir="rtl"
          // Anchor `start-0` (right edge in RTL) so the popover extends
          // LEFTWARD into the table body instead of rightward off the
          // viewport edge. The ציון column sits near the right side of the
          // table (DOM column 2 = second from right in RTL), so extending
          // toward the right was clipping the popover at the screen edge.
          // Arrow flipped to start-4 to match.
          className={cn(
            'absolute z-[15] top-full mt-2 start-0',
            'w-[320px] sm:w-[340px] max-w-[min(86vw,360px)]',
            'rounded-xl bg-elevated text-ink border border-line-subtle',
            'shadow-elevated p-3.5',
            'text-[12px] leading-relaxed text-start animate-fade-in',
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-2 mb-2.5 pb-2 border-b border-line-subtle">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'inline-flex items-center justify-center min-w-[32px] h-7 px-1.5 rounded-md font-bold text-[13px]',
                  styles.chip,
                )}
              >
                {isUnknown ? '⏳' : health.grade}
              </span>
              <div>
                <div className="text-[13px] font-semibold leading-tight">{styles.label}</div>
                {!isUnknown && (
                  <div className="text-[11px] text-ink-muted tabular-nums leading-tight">
                    {health.score}/100
                  </div>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="סגור"
              className="text-ink-muted hover:text-ink text-[16px] leading-none px-1"
            >
              ×
            </button>
          </div>

          {/* Insufficient short-circuit — render reasons only */}
          {health.insufficient ? (
            <div className="space-y-1.5">
              {health.reasons.map((r, idx) => (
                <div key={idx} className="text-ink-secondary text-[11.5px]">
                  {r}
                </div>
              ))}
            </div>
          ) : (
            <>
              {/* Component bars */}
              <div className="space-y-2">
                {(['profitability', 'volume', 'trajectory', 'attributionClarity'] as const).map(
                  (key, idx) => {
                    const value = health.components[key];
                    const meta = COMPONENT_LABELS[key];
                    return (
                      <div key={key}>
                        <div className="flex items-center justify-between text-[11.5px] mb-0.5">
                          <span className="font-medium text-ink">
                            {meta.label}
                            <span className="text-ink-muted font-normal ms-1">({meta.weight})</span>
                          </span>
                          <span className="tabular-nums text-ink-secondary font-semibold">
                            {value}/100
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-elevated2 overflow-hidden">
                          <div
                            className={cn(
                              'h-full rounded-full transition-all',
                              value >= 75
                                ? 'bg-status-green'
                                : value >= 50
                                  ? 'bg-status-blue'
                                  : value >= 30
                                    ? 'bg-status-orange'
                                    : 'bg-status-red',
                            )}
                            style={{ width: `${Math.max(2, value)}%` }}
                          />
                        </div>
                        <div className="text-[11px] text-ink-muted leading-snug mt-0.5">
                          {health.reasons[idx]}
                        </div>
                      </div>
                    );
                  },
                )}
              </div>

              {/* Footer with formula note */}
              <div className="mt-2.5 pt-2 border-t border-line-subtle text-[10.5px] text-ink-muted leading-snug">
                ציון = (רווחיות×0.40) + (נפח×0.15) + (מומנטום×0.25) + (attribution×0.20)
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
