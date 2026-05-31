'use client';

import { forwardRef, type ReactNode } from 'react';
import * as RadixTooltip from '@radix-ui/react-tooltip';
import { cn } from '@/lib/utils';

export const TooltipProvider = RadixTooltip.Provider;
export const Tooltip = RadixTooltip.Root;
export const TooltipTrigger = RadixTooltip.Trigger;

export const TooltipContent = forwardRef<
  React.ElementRef<typeof RadixTooltip.Content>,
  React.ComponentPropsWithoutRef<typeof RadixTooltip.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <RadixTooltip.Portal>
    <RadixTooltip.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 max-w-xs rounded-md bg-glass-2 text-ink border border-glass-edge shadow-overlay px-2.5 py-1.5 text-2xs',
        'animate-in fade-in-0 zoom-in-95',
        className,
      )}
      {...props}
    />
  </RadixTooltip.Portal>
));
TooltipContent.displayName = RadixTooltip.Content.displayName;

// Task 2.6 — concise wrapper that replaces native `title="…"` attributes.
// Usage:
//   <HelpTooltip content="פתח קמפיין">
//     <Button>…</Button>
//   </HelpTooltip>
//
// The child is rendered as the trigger via `asChild`. If `content` is null
// or undefined, the wrapper returns the child untouched — preserves the
// `title={cond ? 'x' : undefined}` ergonomic from the legacy code.
//
// Includes a local `<TooltipProvider>` around the Radix Root. The app-wide
// provider in `layout.tsx` already covers production renders; the local
// one is a defense-in-depth measure so the primitive works in
// component-test contexts (vitest jsdom) without forcing every test file
// to import + wrap with TooltipProvider. Radix tolerates nested providers
// — the innermost wins for delayDuration, which is fine here since we
// only override it in the leaf.
export function HelpTooltip({
  content,
  children,
  side,
  align,
  sideOffset,
  className,
  delayDuration = 300,
}: {
  content: ReactNode | null | undefined;
  children: ReactNode;
  side?: RadixTooltip.TooltipContentProps['side'];
  align?: RadixTooltip.TooltipContentProps['align'];
  sideOffset?: number;
  className?: string;
  delayDuration?: number;
}) {
  if (content === null || content === undefined || content === '') {
    // eslint-disable-next-line react/jsx-no-useless-fragment -- children is
    // ReactNode (potentially a string / number / fragment), so a Fragment
    // wrapper is required to satisfy the JSX.Element return type.
    return <>{children}</>;
  }
  return (
    <TooltipProvider delayDuration={delayDuration}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side} align={align} sideOffset={sideOffset} className={className}>
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
