'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';

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
        'bg-glass-1/85 backdrop-blur-xl supports-[backdrop-filter]:bg-glass-1/75',
        'border-b border-glass-edge',
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
              <Button
                key={tab.key}
                ref={isActive ? activeRef : null}
                role="tab"
                variant="ghost"
                aria-selected={isActive}
                onClick={() => onChange(tab.key)}
                className={cn(
                  'group relative gap-1.5 sm:gap-2',
                  'px-3 sm:px-4 py-2.5 sm:py-3 h-auto text-xs sm:text-sm font-medium',
                  'whitespace-nowrap shrink-0',
                  isActive
                    ? 'text-accent'
                    : 'text-ink-secondary hover:text-ink',
                )}
              >
                <span
                  className={cn(
                    'transition-transform duration-DEFAULT',
                    isActive
                      ? 'text-accent scale-110'
                      : 'text-ink-muted group-hover:text-ink',
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
                    isActive ? 'bg-accent opacity-100' : 'opacity-0',
                  )}
                />
              </Button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
