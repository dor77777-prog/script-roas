'use client';

import { useEffect, useRef, useState } from 'react';
import { Hourglass } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CampaignHealth } from '@/lib/campaignHealthScore';
import { Button } from '@/components/ui/Button';
import { HelpTooltip } from '@/components/ui/Tooltip';
import {
  GRADE_STYLES,
  COMPONENT_LABELS,
  COMPONENT_ORDER,
  barColor,
} from '@/lib/healthGradeStyles';

/**
 * Per-campaign Health Score badge with click-to-drill popover.
 *
 * Renders as a 1-letter grade chip (A/B/C/D/F or an hourglass glyph when
 * insufficient). Clicking the chip opens a popover showing the 5-component
 * breakdown so the operator can argue with the verdict.
 *
 * The grade chip recipe + component labels + bar colours come from the shared
 * `lib/healthGradeStyles` module (the same source HealthScorePanel consumes),
 * so the two surfaces can never drift apart.
 *
 * z-index ladder: popover at z-[15] (matches the ColumnHeaderTh tooltip
 * pattern in CampaignsTable.tsx, sits above row body but below the page
 * Header z-30 / TabNav z-20 — same as the rest of the stacking ladder
 * from commit e45f743).
 *
 * Horizon W4 re-skin: lucide Hourglass (no emoji), `bg-pill-track` insets,
 * type-ramp `text-fs-*`. The hand-rolled popover structure is intentionally
 * LEFT AS-IS — the Radix-popover migration is deferred to W7.
 */

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
      <HelpTooltip
        content={`${styles.label}${isUnknown ? '' : ` · ${health.score}/100`} — לחץ לפירוט`}
      >
        <Button
          type="button"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          aria-expanded={open}
          aria-haspopup="dialog"
          className={cn(
            'min-w-[34px] h-7 px-1.5 text-fs-xs font-bold leading-none tabular-nums',
            'ring-1 cursor-pointer select-none hover:opacity-90 active:scale-95',
            styles.chip,
            styles.ring,
          )}
        >
          {isUnknown ? <Hourglass className="size-3.5" aria-hidden /> : health.grade}
          {!isUnknown && (
            <span className="ms-1 text-fs-2xs font-medium text-accent-fg">
              {health.score}
            </span>
          )}
        </Button>
      </HelpTooltip>

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
            'rounded-xl bg-glass-1 text-ink border border-glass-edge',
            'shadow-overlay p-3.5',
            'text-fs-xs leading-relaxed text-start animate-fade-in',
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-2 mb-2.5 pb-2 border-b border-glass-edge">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'inline-flex items-center justify-center min-w-[32px] h-7 px-1.5 rounded-md font-bold text-fs-sm',
                  styles.chip,
                )}
              >
                {isUnknown ? <Hourglass className="size-3.5" aria-hidden /> : health.grade}
              </span>
              <div>
                <div className="text-fs-sm font-semibold leading-tight">{styles.label}</div>
                {!isUnknown && (
                  <div className="text-fs-2xs text-ink-muted tabular-nums leading-tight">
                    {health.score}/100
                  </div>
                )}
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setOpen(false)}
              aria-label="סגור"
              className="h-auto w-auto px-1 text-fs-base leading-none"
            >
              ×
            </Button>
          </div>

          {/* Insufficient short-circuit — render reasons only */}
          {health.insufficient ? (
            <div className="space-y-1.5">
              {health.reasons.map((r, idx) => (
                <div key={idx} className="text-ink-secondary text-fs-2xs">
                  {r}
                </div>
              ))}
            </div>
          ) : (
            <>
              {/* Component bars */}
              <div className="space-y-2">
                {COMPONENT_ORDER.map((key, idx) => {
                  const value = health.components[key];
                  const meta = COMPONENT_LABELS[key];
                  return (
                    <div key={key}>
                      <div className="flex items-center justify-between text-fs-2xs mb-0.5">
                        <span className="font-medium text-ink">
                          {meta.label}
                          <span className="text-ink-muted font-normal ms-1">({meta.weight})</span>
                        </span>
                        <span className="tabular-nums text-ink-secondary font-semibold">
                          {value}/100
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-pill-track overflow-hidden">
                        <div
                          className={cn('h-full rounded-full transition-all', barColor(value))}
                          style={{ width: `${Math.max(2, value)}%` }}
                        />
                      </div>
                      <div className="text-fs-2xs text-ink-muted leading-snug mt-0.5">
                        {health.reasons[idx]}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Footer with formula note */}
              <div className="mt-2.5 pt-2 border-t border-glass-edge text-fs-2xs text-ink-muted leading-snug">
                ציון = (רווחיות×0.40) + (נפח×0.15) + (מומנטום×0.25) + (attribution×0.20)
                {/* Column-audit 2026-06-01 (FIX 2) — explain the ROAS basis so
                    the score's ROAS reconciles vs the table's allocated ROAS. */}
                <div className="mt-1">
                  הרווחיות בציון מבוססת על ROAS מוכח (דטרמיניסטי · click-id)
                  כשקיים — לכן הוא עשוי להיות שונה מ-״ROAS Shopify (מוקצה)״
                  בטבלה, שמוסיף הקצאה יחסית של הזמנות לא-מתויגות. כשאין הכנסת
                  click-id, הציון נופל-חזרה ל-ROAS המוקצה (ואז ל-ROAS שדיווחה
                  הפלטפורמה).
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
