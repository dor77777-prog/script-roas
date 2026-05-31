import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function TabHeader({
  title,
  description,
  filterSlot,
  actionSlot,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  filterSlot?: ReactNode;
  actionSlot?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex flex-col gap-3 pb-3 border-b border-glass-edge mb-4', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base sm:text-lg font-semibold text-ink leading-tight">{title}</h2>
          {description && (
            <p className="text-xs text-ink-muted mt-1 leading-relaxed">{description}</p>
          )}
        </div>
        {actionSlot && <div className="shrink-0">{actionSlot}</div>}
      </div>
      {filterSlot && <div className="flex flex-wrap items-center gap-2">{filterSlot}</div>}
    </header>
  );
}
