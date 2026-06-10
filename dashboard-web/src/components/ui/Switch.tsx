'use client';

import { forwardRef } from 'react';
import * as RadixSwitch from '@radix-ui/react-switch';
import { cn } from '@/lib/utils';

export const Switch = forwardRef<
  React.ElementRef<typeof RadixSwitch.Root>,
  React.ComponentPropsWithoutRef<typeof RadixSwitch.Root>
>(({ className, ...props }, ref) => (
  <RadixSwitch.Root
    ref={ref}
    className={cn(
      'inline-flex h-5 w-9 items-center rounded-full border border-glass-edge bg-glass-2 transition-colors',
      'data-[state=checked]:bg-accent',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
      className,
    )}
    {...props}
  >
    {/* Unchecked inset is direction-aware (2026-06-10 audit): the flex start
        edge flips in RTL, so the +2px physical inset must flip to −2px there
        or the thumb overhangs the pill edge in every operator panel. */}
    <RadixSwitch.Thumb className="block h-4 w-4 rounded-full bg-glass-1 shadow-glass transition-transform translate-x-0.5 rtl:-translate-x-0.5 data-[state=checked]:translate-x-4 rtl:data-[state=checked]:-translate-x-4" />
  </RadixSwitch.Root>
));
Switch.displayName = RadixSwitch.Root.displayName;
