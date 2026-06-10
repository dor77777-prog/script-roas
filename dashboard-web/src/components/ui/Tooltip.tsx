'use client';

import { forwardRef, type ReactNode } from 'react';
import * as RadixTooltip from '@radix-ui/react-tooltip';
import { cn } from '@/lib/utils';
import { isValidElement, type ReactElement } from 'react';
import { markEscHandledByInnerLayer } from '@/lib/drawerStack';
import { useTouchTooltipMode } from './tooltip/useTouchTooltipMode';
import { RichPopover } from './tooltip/RichPopover';
import { Toggletip } from './tooltip/Toggletip';
import { RichSheet } from './tooltip/RichSheet';

export const TooltipProvider = RadixTooltip.Provider;
export const Tooltip = RadixTooltip.Root;
export const TooltipTrigger = RadixTooltip.Trigger;

export const TooltipContent = forwardRef<
  React.ElementRef<typeof RadixTooltip.Content>,
  React.ComponentPropsWithoutRef<typeof RadixTooltip.Content>
>(({ className, sideOffset = 6, children, onEscapeKeyDown, ...props }, ref) => (
  <RadixTooltip.Portal>
    <RadixTooltip.Content
      ref={ref}
      sideOffset={sideOffset}
      collisionPadding={8}
      // Esc dismisses the hover tooltip ONLY (WCAG 1.4.13 dismissible) —
      // mark it consumed so the shared drawer stack doesn't also close a
      // drawer underneath (2026-06-10 audit: Esc double-dismiss).
      onEscapeKeyDown={(e) => {
        markEscHandledByInnerLayer(e);
        onEscapeKeyDown?.(e);
      }}
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
//   Pointer fine (desktop)  · simple    → Radix Tooltip  (role="tooltip", mode A)
//   Pointer fine (desktop)  · rich      → Radix Popover   (role="dialog",  mode B)
//   Pointer coarse (touch)  · simple    → ⓘ Toggletip     (role="dialog",  mode C)
//   Pointer coarse (touch)  · short-rich→ ⓘ Toggletip     (mode C carrying the rich body)
//   Pointer coarse (touch)  · long-rich → ⓘ → bottom Sheet (role="dialog", mode D)
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

/**
 * Touch length heuristic helper (operator decision §6.5.2). Content counts as
 * a "block" — and so escalates to a bottom Sheet on touch — when it is an
 * array of nodes OR a single block-level/structured element (a paragraph,
 * div, list, etc.). A bare inline element (a `<span>` refund 2-liner with no
 * title) is NOT a block, so short-rich stays a tap-Popover.
 */
const INLINE_TAGS = new Set([
  'span',
  'b',
  'strong',
  'i',
  'em',
  'code',
  'small',
  'a',
  'abbr',
  'mark',
  'bdi',
  'time',
]);

function isBlockContent(content: ReactNode): boolean {
  if (Array.isArray(content)) return true;
  if (!isValidElement(content)) return false;
  // A custom component (e.g. <Money>, <CohortVerdict>) is treated as block —
  // it's structured by definition. Only KNOWN inline host tags stay "short".
  const el = content as ReactElement;
  if (typeof el.type === 'string') return !INLINE_TAGS.has(el.type);
  return true;
}

export function HelpTooltip({
  content,
  children,
  side,
  align,
  sideOffset,
  className,
  delayDuration = 200,
  variant = 'auto',
  title,
  withinDrawer = false,
  richTouch = 'auto',
  touchTrigger = 'auto',
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
  /**
   * Touch-only knob for the rich path (mode C-rich vs mode D). 'auto'
   * (default) applies the length heuristic — LONG rich (a title OR a block /
   * array body) escalates to a bottom Sheet; SHORT rich stays a tap-Popover.
   * Force one with 'sheet' / 'popover'. Ignored on desktop.
   */
  richTouch?: 'auto' | 'sheet' | 'popover';
  /**
   * Touch-only knob for WHO the tap trigger is (2026-06-10 audit, touch
   * double-ⓘ). 'auto' (default): phrasing children get the paired sibling ⓘ
   * glyph; non-phrasing children tap themselves. 'child': the child ITSELF is
   * the tap trigger even when phrasing — for call-sites whose child already
   * IS a dedicated help affordance (the column-header violet ⓘ Button), so
   * the touch path doesn't render a second, duplicate gray ⓘ. Ignored on
   * desktop (the child is always the asChild trigger there).
   */
  touchTrigger?: 'auto' | 'child';
}) {
  // Hooks rule: call the mode hook UNCONDITIONALLY, before any early return.
  // 2026-06-10 audit fix: gate on POINTER CAPABILITY ((hover: none) /
  // (pointer: coarse)) per the §4.1 matrix — NOT viewport width — so a
  // coarse-pointer tablet ≥768px gets tap-openable help instead of
  // hover-only tooltips it can never open. Width survives only as the
  // no-matchMedia fallback inside the hook.
  const isTouch = useTouchTooltipMode();

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

  // Touch (coarse-pointer) branch — spec §4.4. A hover tooltip is invisible on
  // a phone, so every help gets a tap-driven ⓘ affordance:
  //   simple OR short-rich → ⓘ Toggletip (mode C, tap-open Popover, role=status)
  //   long-rich            → ⓘ → bottom Sheet (mode D, focus-trap + visible ✕)
  //
  // Length heuristic (operator decision §6.5.2): treat rich as LONG when a
  // `title` is present OR the content is a block/array (the LTV/attribution/
  // column-paragraph cases). A SHORT rich body (a bare inline node, no title —
  // the refund 2-liner, cohort verdict) stays the tap-Popover. The `richTouch`
  // knob can force 'sheet'/'popover' regardless.
  if (isTouch) {
    const isLong =
      richTouch === 'sheet' ||
      (richTouch === 'auto' && isRich && (title != null || isBlockContent(content)));

    if (isRich && isLong) {
      return (
        <RichSheet
          content={content}
          title={title}
          className={className}
          forceChildTrigger={touchTrigger === 'child'}
        >
          {children}
        </RichSheet>
      );
    }

    return (
      <Toggletip
        content={content}
        side={side}
        align={align}
        sideOffset={sideOffset}
        className={className}
        withinDrawer={withinDrawer}
        forceChildTrigger={touchTrigger === 'child'}
      >
        {children}
      </Toggletip>
    );
  }

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
