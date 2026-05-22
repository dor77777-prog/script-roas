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

  useEffect(() => {
    const el = activeRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [active]);

  return (
    <nav
      className={cn(
        'sticky top-[52px] sm:top-[64px] z-20',
        'bg-surface/85 backdrop-blur-xl supports-[backdrop-filter]:bg-surface/75',
        'border-b border-borderSubtle',
      )}
      aria-label="ניווט בדשבורד"
    >
      <div
        ref={scrollerRef}
        className="max-w-7xl mx-auto px-2 sm:px-4 md:px-8 overflow-x-auto scrollbar-hide"
      >
        <div role="tablist" className="flex gap-0.5 sm:gap-1 min-w-max">
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
                  'group relative inline-flex items-center gap-1.5 sm:gap-2',
                  'px-3 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm font-medium',
                  'whitespace-nowrap transition-colors shrink-0',
                  isActive
                    ? 'text-primary'
                    : 'text-text-secondary hover:text-text-primary',
                )}
              >
                <span
                  className={cn(
                    'transition-transform duration-DEFAULT',
                    isActive
                      ? 'text-primary scale-110'
                      : 'text-text-muted group-hover:text-text-primary',
                  )}
                >
                  {tab.icon}
                </span>
                <span className={cn(isActive && 'font-semibold tracking-tight')}>
                  {tab.label}
                </span>
                {/* Active underline — narrow, near-bottom, refined */}
                <span
                  aria-hidden
                  className={cn(
                    'absolute bottom-0 inset-x-3 h-[2px] rounded-t transition-all duration-DEFAULT',
                    isActive ? 'bg-primary opacity-100' : 'opacity-0',
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
