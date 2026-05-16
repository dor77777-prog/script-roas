'use client';

import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

type Props = {
  title: React.ReactNode;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  /** When provided, open/close state is persisted to localStorage. */
  storageKey?: string;
  /** Right-side actions/badges shown next to title (always visible). */
  rightSlot?: React.ReactNode;
  /** Subtitle line shown under title, also when collapsed. */
  subtitle?: React.ReactNode;
  children: React.ReactNode;
};

export function CollapsibleSection({
  title,
  icon,
  defaultOpen = false,
  storageKey,
  rightSlot,
  subtitle,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [hydrated, setHydrated] = useState(false);

  // Restore persisted state after mount to avoid SSR/client mismatch.
  useEffect(() => {
    if (!storageKey) {
      setHydrated(true);
      return;
    }
    try {
      const saved = localStorage.getItem(`roas-section:${storageKey}`);
      if (saved !== null) setOpen(saved === '1');
    } catch {
      /* localStorage blocked — fall back to defaultOpen */
    }
    setHydrated(true);
  }, [storageKey]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (storageKey) {
      try {
        localStorage.setItem(`roas-section:${storageKey}`, next ? '1' : '0');
      } catch {
        /* ignore */
      }
    }
  }

  return (
    <section className="rounded-xl bg-surface border border-border shadow-card overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-4 sm:px-5 py-3 sm:py-3.5 hover:bg-surfaceMuted/50 active:bg-surfaceMuted transition-colors text-start"
      >
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          {icon && <span className="text-text-secondary shrink-0">{icon}</span>}
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-semibold text-text-primary truncate">
              {title}
            </h2>
            {subtitle && (
              <div className="text-[10px] sm:text-xs text-text-muted mt-0.5 truncate">
                {subtitle}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {rightSlot}
          <ChevronDown
            size={18}
            className={cn(
              'text-text-muted transition-transform duration-200',
              open && 'rotate-180',
            )}
          />
        </div>
      </button>
      {/* Render children only after hydration so the persisted state applies
          on first paint without a layout jump. */}
      {hydrated && open && <div className="border-t border-border">{children}</div>}
    </section>
  );
}
