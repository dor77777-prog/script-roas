'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';
import * as RadixPopover from '@radix-ui/react-popover';
import { cn } from '@/lib/utils';

/**
 * Tooltip-system-redesign — Phase 1 · Task 1.1, mode B (desktop rich).
 *
 * The DESKTOP rich tooltip surface. Rich content (a heading, a paragraph,
 * structured rows, numbers) is a `role="dialog"` Popover — NOT a `role="tooltip"`
 * — because the ARIA `tooltip` role is for a non-interactive description and a
 * focusable child (link/button/input) leaks out of it (see the Phase-0.2
 * focusable guard). The Popover owns focus management, Esc, and click-outside.
 *
 * Open model — HOVER-INTENT (operator decision §6.5.1): open on
 * `pointerenter` after a short intent delay (~180ms) AND on click; close on
 * `pointerleave` after a short grace (~150ms) so the cursor can travel from the
 * trigger into the bubble. Staying inside the popover keeps it open. Esc and an
 * outside click also close (Radix defaults).
 *
 * Chrome — existing tokens only, light + dark first-class (matches the approved
 * mockup `.pop` + `ChartTooltip`): `bg-glass-1/95 backdrop-blur-sm
 * border-glass-edge rounded-card shadow-overlay`, `max-w-sm`, arrow
 * `fill-glass-1`. Optional `title` → `text-sm font-semibold text-ink`; body →
 * `text-xs text-ink-secondary whitespace-pre-line` (fixes the `\n` no-break
 * bug). Numbers inside `content` must arrive pre-wrapped in `<Money>`/`<Metric>`
 * by the call-site.
 */

// Hover-intent timings (ms). Open is deliberately deliberate; close has a grace
// window so the pointer can cross the gap from trigger → popover.
const OPEN_INTENT_MS = 180;
const CLOSE_GRACE_MS = 150;

export interface RichPopoverProps {
  /** Trigger node — rendered via `asChild`, must accept a ref + DOM props. */
  children: ReactNode;
  /** Rich body (ReactNode block; numbers via `<Money>`/`<Metric>`). */
  content: ReactNode;
  /** Optional headline. */
  title?: ReactNode;
  side?: RadixPopover.PopoverContentProps['side'];
  align?: RadixPopover.PopoverContentProps['align'];
  sideOffset?: number;
  className?: string;
  /** Lift content above a Sheet/drawer scrim (z-[60]) when opened within one. */
  withinDrawer?: boolean;
}

export function RichPopover({
  children,
  content,
  title,
  side = 'top',
  align = 'center',
  sideOffset = 8,
  className,
  withinDrawer = false,
}: RichPopoverProps) {
  const [open, setOpen] = useState(false);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (openTimer.current) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const scheduleOpen = useCallback(() => {
    clearTimers();
    openTimer.current = setTimeout(() => setOpen(true), OPEN_INTENT_MS);
  }, [clearTimers]);

  const scheduleClose = useCallback(() => {
    clearTimers();
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_GRACE_MS);
  }, [clearTimers]);

  return (
    <RadixPopover.Root
      open={open}
      onOpenChange={(next) => {
        clearTimers();
        setOpen(next);
      }}
    >
      {/* `asChild` lets the consumer's element BE the trigger. Hover-intent +
          click both open; pointerleave schedules a graceful close. */}
      <RadixPopover.Trigger
        asChild
        onPointerEnter={scheduleOpen}
        onPointerLeave={scheduleClose}
        onClick={() => {
          clearTimers();
          setOpen((v) => !v);
        }}
      >
        {children}
      </RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          // role=dialog is the Radix Popover default; focus is trapped/managed.
          role="dialog"
          dir="rtl"
          side={side}
          align={align}
          sideOffset={sideOffset}
          collisionPadding={8}
          // Keep open while the cursor is over the popover itself.
          onPointerEnter={clearTimers}
          onPointerLeave={scheduleClose}
          // Esc + click-outside close (Radix fires these; mirror to our state).
          onEscapeKeyDown={() => {
            clearTimers();
            setOpen(false);
          }}
          onInteractOutside={() => {
            clearTimers();
            setOpen(false);
          }}
          // Don't yank focus to the dialog on a hover-open (only a click/keyboard
          // open should move focus). Radix still traps focus once inside.
          onOpenAutoFocus={(e) => e.preventDefault()}
          className={cn(
            withinDrawer ? 'z-[60]' : 'z-50',
            'max-w-sm rounded-card border border-glass-edge bg-glass-1/95 backdrop-blur-sm shadow-overlay',
            'px-3 py-2 text-start',
            'animate-in fade-in-0 zoom-in-95',
            className,
          )}
        >
          {title != null && (
            <div className="text-sm font-semibold text-ink mb-1.5">{title}</div>
          )}
          <div className="text-xs text-ink-secondary whitespace-pre-line leading-relaxed">
            {content}
          </div>
          <RadixPopover.Arrow className="fill-glass-1" width={10} height={5} />
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
