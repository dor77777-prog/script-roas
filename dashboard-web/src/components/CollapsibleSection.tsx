'use client';

import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';

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
    <section className="rounded-xl bg-elevated border border-line shadow-sm overflow-hidden">
      <Button
        type="button"
        variant="ghost"
        onClick={toggle}
        aria-expanded={open}
        className="w-full justify-between h-auto gap-3 px-4 sm:px-5 py-3 sm:py-3.5 hover:bg-elevated2/50 active:bg-elevated2"
      >
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          {icon && <span className="text-ink-secondary shrink-0">{icon}</span>}
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-semibold text-ink truncate">
              {title}
            </h2>
            {subtitle && (
              <div className="text-[10px] sm:text-xs text-ink-muted mt-0.5 truncate">
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
              'text-ink-muted transition-transform duration-200',
              open && 'rotate-180',
            )}
          />
        </div>
      </Button>
      {/* Render children only after hydration so the persisted state applies
          on first paint without a layout jump. */}
      {hydrated && open && <div className="border-t border-line">{children}</div>}
    </section>
  );
}
