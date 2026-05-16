'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

export type TabDef<K extends string> = {
  key: K;
  label: string;
  icon: React.ReactNode;
  description?: string;
};

type Props<K extends string> = {
  tabs: TabDef<K>[];
  active: K;
  onChange: (key: K) => void;
};

export function TabNav<K extends string>({ tabs, active, onChange }: Props<K>) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  // When a tab gets selected (especially on mobile where some are off-screen),
  // bring it into view so the user always sees their current location.
  useEffect(() => {
    const el = activeRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [active]);

  return (
    <nav
      className="sticky top-[52px] sm:top-[64px] z-[9] bg-surface/95 backdrop-blur-md border-b border-border shadow-sm"
      aria-label="ניווט בדשבורד"
    >
      <div
        ref={scrollerRef}
        className="max-w-7xl mx-auto px-3 sm:px-4 md:px-8 overflow-x-auto scrollbar-hide"
      >
        <div role="tablist" className="flex gap-1 sm:gap-2 min-w-max">
          {tabs.map(tab => {
            const isActive = active === tab.key;
            return (
              <button
                key={tab.key}
                ref={isActive ? activeRef : null}
                role="tab"
                aria-selected={isActive}
                onClick={() => onChange(tab.key)}
                className={cn(
                  'inline-flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm font-semibold whitespace-nowrap transition-colors relative shrink-0',
                  isActive
                    ? 'text-primary'
                    : 'text-text-secondary hover:text-text-primary',
                )}
              >
                <span className={cn(isActive && 'text-primary')}>{tab.icon}</span>
                <span>{tab.label}</span>
                {/* Active indicator bar */}
                <span
                  className={cn(
                    'absolute bottom-0 left-0 right-0 h-0.5 rounded-t-full transition-all',
                    isActive ? 'bg-primary' : 'bg-transparent',
                  )}
                />
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
