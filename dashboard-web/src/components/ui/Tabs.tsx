'use client';

import { forwardRef } from 'react';
import * as RadixTabs from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';

export const Tabs = RadixTabs.Root;

export const TabsList = forwardRef<
  React.ElementRef<typeof RadixTabs.List>,
  React.ComponentPropsWithoutRef<typeof RadixTabs.List>
>(({ className, ...props }, ref) => (
  <RadixTabs.List
    ref={ref}
    className={cn('inline-flex h-9 items-center gap-1 rounded-md bg-glass-2 p-1', className)}
    {...props}
  />
));
TabsList.displayName = RadixTabs.List.displayName;

export const TabsTrigger = forwardRef<
  React.ElementRef<typeof RadixTabs.Trigger>,
  React.ComponentPropsWithoutRef<typeof RadixTabs.Trigger>
>(({ className, ...props }, ref) => (
  <RadixTabs.Trigger
    ref={ref}
    className={cn(
      'inline-flex items-center justify-center rounded-sm px-3 py-1 text-xs font-medium',
      'text-ink-muted transition-colors hover:text-ink',
      'data-[state=active]:bg-glass-1 data-[state=active]:text-ink data-[state=active]:shadow-glass',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = RadixTabs.Trigger.displayName;

export const TabsContent = forwardRef<
  React.ElementRef<typeof RadixTabs.Content>,
  React.ComponentPropsWithoutRef<typeof RadixTabs.Content>
>(({ className, ...props }, ref) => (
  <RadixTabs.Content ref={ref} className={cn('mt-3 focus-visible:outline-none', className)} {...props} />
));
TabsContent.displayName = RadixTabs.Content.displayName;
