'use client';

import { useState, type ReactNode } from 'react';
import * as RadixPopover from '@radix-ui/react-popover';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Tooltip-system-redesign — Phase 1 · Task 1.2, mode C (touch simple) +
 * short-rich touch.
 *
 * Touch has no hover, so a hover tooltip is invisible on a phone. The
 * toggletip pattern (Heydon Pickering / Sarah Higley) separates the REVEAL
 * affordance from any underlying action: the child renders as-is, and we pair
 * it with a dedicated ⓘ `<button aria-label>` that TAP-toggles a Radix Popover
 * carrying the content. This kills the "first tap reveals, second tap acts"
 * double-tap trap and never hijacks the trigger's own activation.
 *
 * a11y (spec §4.4):
 *   - the ⓘ glyph is 24px with a `::after` inset expanding the hit area to the
 *     WCAG-2.5.8 ≥44px floor (the inset is in `tooltip-touch.css`-equivalent
 *     inline utility classes; see the `after:` block below).
 *   - announce the content on open via a `role="status"` live region — NOT
 *     `aria-describedby` (a toggletip is tap-driven, not a passive label).
 *   - tap-outside / Esc close (Radix Popover defaults).
 *   - NO focusable content inside the bubble (rich-but-short bodies are inert
 *     text/numbers; anything interactive would have been a Sheet/dialog).
 *
 * Chrome — existing tokens only, light + dark first-class (mirrors the approved
 * mockup `.mpop` + the desktop `RichPopover`): `bg-glass-1/95 backdrop-blur-sm
 * border-glass-edge rounded-card shadow-overlay`. Glyph `text-ink-muted` →
 * `text-accent` on hover/focus.
 */

export interface ToggletipProps {
  /** The labelled subject — rendered as-is, alongside the ⓘ affordance. */
  children: ReactNode;
  /** Body shown in the popover (string for simple, or a short rich block). */
  content: ReactNode;
  /** Accessible label for the ⓘ button (defaults to a generic "הסבר"). */
  label?: string;
  side?: RadixPopover.PopoverContentProps['side'];
  align?: RadixPopover.PopoverContentProps['align'];
  sideOffset?: number;
  className?: string;
  /** Lift content above a Sheet/drawer scrim (z-[60]) when opened within one. */
  withinDrawer?: boolean;
}

export function Toggletip({
  children,
  content,
  label = 'הסבר',
  side = 'bottom',
  align = 'center',
  sideOffset = 6,
  className,
  withinDrawer = false,
}: ToggletipProps) {
  const [open, setOpen] = useState(false);

  return (
    <span className="inline-flex items-center gap-1.5 align-middle">
      {children}
      <RadixPopover.Root open={open} onOpenChange={setOpen}>
        <RadixPopover.Trigger asChild>
          <button
            type="button"
            aria-label={label}
            className={cn(
              // 24px glyph; `::after` inset expands the hit area to ≥44px (WCAG 2.5.8).
              'relative inline-flex h-6 w-6 flex-none items-center justify-center rounded-full',
              'border border-glass-edge bg-glass-1 text-ink-muted',
              'transition-colors hover:text-accent focus-visible:text-accent',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent',
              'after:absolute after:-inset-2.5 after:content-[""]',
            )}
          >
            <Info size={14} aria-hidden="true" />
          </button>
        </RadixPopover.Trigger>
        <RadixPopover.Portal>
          <RadixPopover.Content
            role="dialog"
            dir="rtl"
            side={side}
            align={align}
            sideOffset={sideOffset}
            collisionPadding={8}
            className={cn(
              withinDrawer ? 'z-[60]' : 'z-50',
              'max-w-[min(15rem,calc(100vw-1.75rem))] rounded-card',
              'border border-glass-edge bg-glass-1/95 backdrop-blur-sm shadow-overlay',
              'px-3 py-2 text-start text-xs text-ink-secondary whitespace-pre-line leading-relaxed',
              'animate-in fade-in-0 zoom-in-95',
              className,
            )}
          >
            {content}
            {/* Live region: announce on open (tap), not before. Toggletips use
                role=status, never aria-describedby (spec §4.4). */}
            <span role="status" className="sr-only">
              {open ? content : null}
            </span>
            <RadixPopover.Arrow className="fill-glass-1" width={10} height={5} />
          </RadixPopover.Content>
        </RadixPopover.Portal>
      </RadixPopover.Root>
    </span>
  );
}
