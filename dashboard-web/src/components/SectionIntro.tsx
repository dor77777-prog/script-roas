'use client';

import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Heading } from '@/components/ui/Typography';

type Props = {
  icon?: React.ReactNode;
  title: string;
  description: string;
  /** Optional formula or note rendered in a code-like pill (LTR). */
  formula?: string;
  /** Inline mode = no card, just a single muted info line. */
  inline?: boolean;
  rightSlot?: React.ReactNode;
};

/**
 * Elegant section header. Two visual modes:
 *  - default: a thin label bar with eyebrow + heading + description (no box,
 *    no nested-card feel). Sits naturally above the section content below.
 *  - inline:  a single-line info hint with an icon — for in-context tips.
 */
export function SectionIntro({
  icon,
  title,
  description,
  formula,
  inline = false,
  rightSlot,
}: Props) {
  if (inline) {
    return (
      <div className="flex items-start gap-2 text-xs sm:text-sm text-ink-secondary">
        <Info size={14} className="text-ink-muted shrink-0 mt-0.5" />
        <span>{description}</span>
      </div>
    );
  }
  return (
    <header className="flex items-start justify-between gap-3 flex-wrap">
      <div className="flex items-start gap-2.5 sm:gap-3 min-w-0 flex-1">
        {icon && (
          <span
            className={cn(
              'shrink-0 mt-0.5 inline-flex items-center justify-center',
              'w-7 h-7 sm:w-8 sm:h-8 rounded-lg',
              'bg-accent/8 text-accent',
            )}
          >
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <Heading level="section">
            {title}
          </Heading>
          <p className="text-[11px] sm:text-xs text-ink-secondary mt-0.5 leading-relaxed">
            {description}
          </p>
          {formula && (
            <code
              dir="ltr"
              className={cn(
                'inline-block mt-1.5 px-1.5 py-0.5 rounded text-[10px] sm:text-[11px] tabular-nums',
                'bg-glass-2 border border-glass-edge text-ink-secondary',
                'font-mono',
              )}
            >
              {formula}
            </code>
          )}
        </div>
      </div>
      {rightSlot && <div className="shrink-0">{rightSlot}</div>}
    </header>
  );
}
