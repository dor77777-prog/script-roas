'use client';

import {
  isValidElement,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import * as RadixPopover from '@radix-ui/react-popover';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isNonPhrasingChild } from './phrasing';
import { markEscHandledByInnerLayer } from '@/lib/drawerStack';

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
 * mockup `.mpop` + the desktop `RichPopover`): `bg-glass-1 (opaque)
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
  /**
   * 2026-06-10 audit (touch double-ⓘ): force the CHILD itself to be the tap
   * trigger even when it is phrasing content. Used when the child already IS
   * a dedicated help affordance (the column-header violet ⓘ Button) — pairing
   * a second sibling gray ⓘ next to it rendered TWO ⓘ glyphs, with the
   * operator's violet one dead.
   */
  forceChildTrigger?: boolean;
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
  forceChildTrigger = false,
}: ToggletipProps) {
  const [open, setOpen] = useState(false);

  // Non-phrasing trigger children (a table row `<tr>`, list item `<li>`, cell,
  // block container) can't legally sit inside the `<span>` ⓘ-pairing wrapper
  // and can't have a sibling `<button>` (it would break the table/list). For
  // those the child ITSELF is the tap trigger via Radix `asChild` — no wrapper,
  // no ⓘ glyph (open-Q3: dense rows tap themselves; ⓘ stays for inline help).
  const childIsTrigger = forceChildTrigger || isNonPhrasingChild(children);

  // 2026-06-10 audit (row-tap double-fire): a non-phrasing trigger child that
  // carries its OWN onClick (the drillable `<tr>` wrapped in the
  // 'לחץ לפרטים מלאים' hint) must not ALSO toggle a hint popover — Radix
  // composes the handlers, so one tap opened the drawer AND left an orphaned
  // popover floating over it. On touch the tap IS the action, so the hint
  // adds nothing: suppress the popover entirely and render the child as-is.
  // (Explicit `forceChildTrigger` opt-ins keep the popover — their child's
  // own onClick is a stopPropagation-style guard, not a competing action.)
  const childOwnOnClick = isValidElement(children)
    ? (children as ReactElement<{ onClick?: unknown }>).props.onClick
    : undefined;
  if (childIsTrigger && !forceChildTrigger && typeof childOwnOnClick === 'function') {
    // eslint-disable-next-line react/jsx-no-useless-fragment
    return <>{children}</>;
  }

  // The reveal affordance: for phrasing children we keep the dedicated ⓘ
  // button (rendered alongside the child); for non-phrasing children the child
  // is itself the trigger (no extra glyph). Both go through Radix `asChild`.
  //
  // Both triggers stop click propagation (2026-06-10 audit): a help reveal
  // inside a drillable table row must never bubble into the row's own
  // onClick — tapping an in-row ⓘ (or an in-row cell trigger) opened the
  // help AND drilled into the drawer in one tap. stopPropagation doesn't
  // preventDefault, so Radix's composed toggle still runs.
  const trigger = childIsTrigger ? (
    <RadixPopover.Trigger asChild onClick={(e) => e.stopPropagation()}>
      {children}
    </RadixPopover.Trigger>
  ) : (
    <RadixPopover.Trigger asChild>
      <button
        type="button"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
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
  );

  const popover = (
    <RadixPopover.Root open={open} onOpenChange={setOpen}>
      {trigger}
      <RadixPopover.Portal>
          <RadixPopover.Content
            role="dialog"
            dir="rtl"
            side={side}
            align={align}
            sideOffset={sideOffset}
            collisionPadding={8}
            // Mark the Esc as consumed by THIS layer so the shared drawer
            // stack doesn't also close the drawer underneath (2026-06-10
            // audit: Esc double-dismiss). No preventDefault here — Radix's
            // own dismissal branch (preventDefault + close) still runs.
            onEscapeKeyDown={markEscHandledByInnerLayer}
            className={cn(
              withinDrawer ? 'z-[60]' : 'z-50',
              'max-w-[min(15rem,calc(100vw-1.75rem))] rounded-card',
              'border border-glass-edge bg-glass-1 shadow-overlay',
              'px-3 py-2 text-start text-xs text-ink-secondary whitespace-pre-line leading-relaxed',
              'animate-in fade-in-0 zoom-in-95',
              className,
            )}
          >
            {content}
            <RadixPopover.Arrow className="fill-glass-1" width={10} height={5} />
          </RadixPopover.Content>
        </RadixPopover.Portal>
      </RadixPopover.Root>
  );

  // Live region — HOISTED OUTSIDE the open-gated popover subtree so it is
  // present in the DOM before open. A role=status region added in the SAME
  // tick it is filled can be missed by some screen readers; mounting it always
  // (empty until open) makes the announcement reliable. Toggletips announce on
  // tap via role=status, never `aria-describedby` (a toggletip is tap-driven,
  // not a passive label — spec §4.4).
  //
  // It is PORTALLED to <body> so it never lands as an invalid DOM sibling of a
  // non-phrasing trigger (a `<span>` cannot be a direct child of `<tbody>` /
  // `<ul>` — see TooltipTouch table/list DOM-validity tests). The portal keeps
  // it always-mounted (reliable announce) AND structurally valid everywhere.
  const liveRegion =
    typeof document !== 'undefined'
      ? createPortal(
          <span role="status" className="sr-only">
            {open ? content : null}
          </span>,
          document.body,
        )
      : null;

  // Non-phrasing child IS the trigger → return the popover as-is (no <span>
  // wrapper, so the row/list-item keeps its valid place in the DOM tree). The
  // live region is an always-mounted sibling so the announcement is reliable.
  if (childIsTrigger) {
    return (
      <>
        {popover}
        {liveRegion}
      </>
    );
  }

  // Phrasing child → render it inline alongside the ⓘ-pairing popover.
  return (
    <span className="inline-flex items-center gap-1.5 align-middle">
      {children}
      {popover}
      {liveRegion}
    </span>
  );
}
