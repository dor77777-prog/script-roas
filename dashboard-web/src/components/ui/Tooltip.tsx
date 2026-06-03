'use client';

import { forwardRef, type ReactNode } from 'react';
import * as RadixTooltip from '@radix-ui/react-tooltip';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/lib/hooks/useIsMobile';
import { RichPopover } from './tooltip/RichPopover';

export const TooltipProvider = RadixTooltip.Provider;
export const Tooltip = RadixTooltip.Root;
export const TooltipTrigger = RadixTooltip.Trigger;

export const TooltipContent = forwardRef<
  React.ElementRef<typeof RadixTooltip.Content>,
  React.ComponentPropsWithoutRef<typeof RadixTooltip.Content>
>(({ className, sideOffset = 6, children, ...props }, ref) => (
  <RadixTooltip.Portal>
    <RadixTooltip.Content
      ref={ref}
      sideOffset={sideOffset}
      collisionPadding={8}
      className={cn(
        // Mode A chrome (desktop simple) — glass-2 bubble, AA in both themes.
        // text-2xs → text-xs for legibility; rounded-md → rounded-chip.
        'z-50 max-w-xs rounded-chip bg-glass-2 text-ink border border-glass-edge shadow-overlay px-2.5 py-1.5 text-xs',
        'animate-in fade-in-0 zoom-in-95',
        className,
      )}
      {...props}
    >
      {children}
      {/* Arrow re-anchors on flip; fill-glass-2 matches the simple surface. */}
      <RadixTooltip.Arrow className="fill-glass-2" width={10} height={5} />
    </RadixTooltip.Content>
  </RadixTooltip.Portal>
));
TooltipContent.displayName = RadixTooltip.Content.displayName;

// ---------------------------------------------------------------------------
// HelpTooltip — the single public primitive (unchanged signature + the
// load-bearing null/'' passthrough). Internally it auto-selects a render mode
// from pointer-type × content-shape (tooltip-system-redesign §4.1):
//
//   Pointer fine (desktop)  · simple → Radix Tooltip   (role="tooltip", mode A)
//   Pointer fine (desktop)  · rich   → Radix Popover    (role="dialog",  mode B)
//   Pointer coarse (touch)  · simple → ⓘ toggletip      (mode C, Task 1.2)
//   Pointer coarse (touch)  · rich   → bottom Sheet      (mode D, Task 1.2)
//
// Content shape: a plain `string`/`number` is simple; a non-string `ReactNode`
// (or an explicit `variant="rich"`, or a `title`) is rich. `variant="text"`
// pins even a JSX content to the simple tooltip (no surprise Popover).
//
// Usage:
//   <HelpTooltip content="פתח קמפיין"><Button>…</Button></HelpTooltip>
//
// The child is the trigger via `asChild`. If `content` is null/undefined/''
// the wrapper returns the child untouched — preserves the
// `title={cond ? 'x' : undefined}` ergonomic from the legacy code.
//
// The local `<TooltipProvider>` is defense-in-depth so the primitive works in
// component-test (vitest jsdom) contexts without every test importing a
// provider. The app-wide provider in `layout.tsx` covers production renders;
// Radix tolerates nested providers (innermost wins for delayDuration).
// ---------------------------------------------------------------------------
export function HelpTooltip({
  content,
  children,
  side,
  align,
  sideOffset,
  className,
  delayDuration = 300,
  variant = 'auto',
  title,
  withinDrawer = false,
}: {
  content: ReactNode | null | undefined;
  children: ReactNode;
  side?: RadixTooltip.TooltipContentProps['side'];
  align?: RadixTooltip.TooltipContentProps['align'];
  sideOffset?: number;
  className?: string;
  delayDuration?: number;
  /** 'auto' (default): string→tooltip, ReactNode-block→popover. */
  variant?: 'auto' | 'text' | 'rich';
  /** Rich-only headline (text-sm font-semibold). Presence implies rich. */
  title?: ReactNode;
  /** Lift the surface to z-[60] when opened inside a Sheet/drawer. */
  withinDrawer?: boolean;
}) {
  // Hooks rule: call useIsMobile() UNCONDITIONALLY, before any early return.
  const isMobile = useIsMobile();

  if (content === null || content === undefined || content === '') {
    // children is ReactNode (potentially a string / number / fragment), so a
    // Fragment wrapper is required to satisfy the JSX.Element return type.
    // eslint-disable-next-line react/jsx-no-useless-fragment
    return <>{children}</>;
  }

  // Mode selection. `variant="text"` forces the simple tooltip; `variant="rich"`
  // or a `title` forces rich; otherwise 'auto' promotes only non-primitive
  // content (a ReactNode block) to rich.
  const isRich =
    variant === 'rich' ||
    title != null ||
    (variant === 'auto' && typeof content !== 'string' && typeof content !== 'number');

  // TODO(Task 1.2): touch (coarse-pointer) modes — ⓘ toggletip (mode C, simple)
  // and bottom Sheet (mode D, long rich). Until then the touch branch falls
  // back to the desktop render modes below so the content is never lost.
  void isMobile;

  if (isRich) {
    return (
      <RichPopover
        content={content}
        title={title}
        side={side}
        align={align}
        sideOffset={sideOffset}
        className={className}
        withinDrawer={withinDrawer}
      >
        {children}
      </RichPopover>
    );
  }

  return (
    <TooltipProvider delayDuration={delayDuration}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent
          side={side}
          align={align}
          sideOffset={sideOffset}
          className={cn(withinDrawer && 'z-[60]', className)}
        >
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
