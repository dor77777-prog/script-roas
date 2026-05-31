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
    <RadixSwitch.Thumb className="block h-4 w-4 rounded-full bg-glass-1 shadow-glass transition-transform data-[state=checked]:translate-x-4 rtl:data-[state=checked]:-translate-x-4 translate-x-0.5" />
  </RadixSwitch.Root>
));
Switch.displayName = RadixSwitch.Root.displayName;
