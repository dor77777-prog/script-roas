'use client';

import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';

type Props = {
  icon?: React.ReactNode;
  title: string;
  description: string;
  /** Optional plain-text formula or note rendered in a code-like pill. */
  formula?: string;
  /** When true, render compactly (no card, just text). Default false. */
  inline?: boolean;
  /** Optional right-side controls (e.g. local filters). */
  rightSlot?: React.ReactNode;
};

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
      <div className="flex items-start gap-2 text-xs sm:text-sm text-text-secondary">
        <Info size={14} className="text-text-muted shrink-0 mt-0.5" />
        <span>{description}</span>
      </div>
    );
  }
  return (
    <header className="rounded-xl border border-primary/15 bg-gradient-to-br from-primary/5 via-surface to-surface p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-2.5 sm:gap-3 min-w-0">
          {icon && (
            <span className="text-primary shrink-0 mt-0.5 hidden sm:inline">
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-bold text-text-primary flex items-center gap-2">
              {icon && <span className="text-primary sm:hidden">{icon}</span>}
              {title}
            </h2>
            <p className="text-xs sm:text-sm text-text-secondary mt-1 leading-relaxed">
              {description}
            </p>
            {formula && (
              <code
                className={cn(
                  'inline-block mt-2 px-2 py-1 rounded text-[10px] sm:text-[11px] tabular-nums',
                  'bg-surfaceMuted border border-border text-text-primary',
                )}
                dir="ltr"
              >
                {formula}
              </code>
            )}
          </div>
        </div>
        {rightSlot && <div className="shrink-0">{rightSlot}</div>}
      </div>
    </header>
  );
}
