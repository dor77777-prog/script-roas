'use client';

import { createContext, forwardRef, useContext } from 'react';
import * as RadixTabs from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';

// ----------------------------------------------------------------------------
// Variants
// ----------------------------------------------------------------------------
// `pill` (default)  — glass-2 pill bar with rounded active chip. Original
//                     treatment from Phase 13 / Wave 1.
// `underline`       — flat row with a border-b underline on the active trigger.
//                     Used by the operator page tabs and the Analysis
//                     trends/archive split. Added in Wave-2 Task 2.10 so those
//                     consumers stop importing @radix-ui/react-tabs directly.
// ----------------------------------------------------------------------------

type TabsVariant = 'pill' | 'underline';

const TabsVariantContext = createContext<TabsVariant>('pill');

type TabsRootProps = React.ComponentPropsWithoutRef<typeof RadixTabs.Root> & {
  variant?: TabsVariant;
};

export const Tabs = forwardRef<
  React.ElementRef<typeof RadixTabs.Root>,
  TabsRootProps
>(({ variant = 'pill', children, ...props }, ref) => (
  <TabsVariantContext.Provider value={variant}>
    <RadixTabs.Root ref={ref} {...props}>
      {children}
    </RadixTabs.Root>
  </TabsVariantContext.Provider>
));
Tabs.displayName = 'Tabs';

export const TabsList = forwardRef<
  React.ElementRef<typeof RadixTabs.List>,
  React.ComponentPropsWithoutRef<typeof RadixTabs.List>
>(({ className, ...props }, ref) => {
  const variant = useContext(TabsVariantContext);
  return (
    <RadixTabs.List
      ref={ref}
      className={cn(
        variant === 'pill'
          ? 'inline-flex h-9 items-center gap-1 rounded-md bg-glass-2 p-1'
          : 'flex gap-2 border-b border-glass-edge',
        className,
      )}
      {...props}
    />
  );
});
TabsList.displayName = RadixTabs.List.displayName;

export const TabsTrigger = forwardRef<
  React.ElementRef<typeof RadixTabs.Trigger>,
  React.ComponentPropsWithoutRef<typeof RadixTabs.Trigger>
>(({ className, ...props }, ref) => {
  const variant = useContext(TabsVariantContext);
  return (
    <RadixTabs.Trigger
      ref={ref}
      className={cn(
        variant === 'pill'
          ? [
              'inline-flex items-center justify-center rounded-sm px-3 py-1 text-xs font-medium',
              'text-ink-muted transition-colors hover:text-ink',
              'data-[state=active]:bg-glass-1 data-[state=active]:text-ink data-[state=active]:shadow-glass',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            ]
          : [
              'px-3 py-2 text-sm text-ink-muted transition-colors hover:text-ink',
              'data-[state=active]:font-medium data-[state=active]:text-ink',
              'data-[state=active]:border-b-2 data-[state=active]:border-accent',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            ],
        className,
      )}
      {...props}
    />
  );
});
TabsTrigger.displayName = RadixTabs.Trigger.displayName;

export const TabsContent = forwardRef<
  React.ElementRef<typeof RadixTabs.Content>,
  React.ComponentPropsWithoutRef<typeof RadixTabs.Content>
>(({ className, ...props }, ref) => (
  // Wave-6 Task 6.1 — tab content swap animates over --motion-snap
  // (120 ms) using tailwindcss-animate's fade-in + ease-out. Radix
  // toggles the panel via `data-state="active"`; the `data-[state=active]`
  // selector scopes the animation to the entering panel only (the
  // leaving panel is removed from the DOM by Radix). prefers-reduced-motion
  // collapses it via the project-wide rule in globals.css.
  <RadixTabs.Content
    ref={ref}
    className={cn(
      'mt-3 focus-visible:outline-none',
      'data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:duration-snap data-[state=active]:ease-out',
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = RadixTabs.Content.displayName;
