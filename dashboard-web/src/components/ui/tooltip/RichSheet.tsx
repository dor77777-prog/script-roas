'use client';

import {
  cloneElement,
  useState,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isNonPhrasingChild } from './phrasing';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetTitle,
  SheetDescription,
  SheetClose,
} from '@/components/ui/Sheet';

/**
 * Tooltip-system-redesign — Phase 1 · Task 1.2, mode D (touch · long rich).
 *
 * On a phone, long rich content (the LTV-curve explainer, attribution
 * breakdown, column-header paragraphs) must NOT be crammed into a narrow
 * popover bubble (spec §4.4). It escalates to a bottom Sheet — a Radix Dialog
 * (`role="dialog"`) that already gives us focus-trap + Esc + scrim — with a
 * VISIBLE ✕ close (a drag handle alone is an a11y failure, NN/g).
 *
 * The reveal is a dedicated ⓘ `<button aria-label>` (same 24px glyph / ≥44px
 * hit-area affordance as the Toggletip) so the touch experience is one
 * consistent "tap ⓘ → panel → tap-out / ✕ to close" everywhere.
 *
 * A bottom Sheet = `<SheetContent variant="drawer" side="bottom">` — the
 * `side` classes (bottom-0, inset-x, slide-in-from-bottom, glass gradient +
 * blur) only emit for the `drawer` variant (see Sheet.tsx compoundVariants).
 *
 * Numbers inside `content` must arrive pre-wrapped in `<Money>`/`<Metric>` by
 * the call-site (the repo's overflow-safe number rule).
 */

export interface RichSheetProps {
  /** The labelled subject — rendered as-is, alongside the ⓘ affordance. */
  children: ReactNode;
  /** Rich body (ReactNode block; numbers via `<Money>`/`<Metric>`). */
  content: ReactNode;
  /** Sheet heading — also the default ⓘ button label. */
  title?: ReactNode;
  /** Accessible label for the ⓘ button. */
  label?: string;
  className?: string;
}

export function RichSheet({
  children,
  content,
  title,
  label,
  className,
}: RichSheetProps) {
  const [open, setOpen] = useState(false);

  // The dialog must always have a non-empty accessible name. Prefer an explicit
  // `label`, then a string `title`, else a generic fallback — used BOTH as the
  // ⓘ button's aria-label AND as the SheetTitle text when no `title` is given,
  // so the heading is never empty.
  const buttonLabel =
    label ?? (typeof title === 'string' ? title : 'מידע נוסף');
  // Heading content: the provided `title` if any, else the fallback label so
  // SheetTitle is never empty (an unnamed dialog is an a11y failure).
  const headingContent = title ?? buttonLabel;

  // Non-phrasing trigger children (a table row `<tr>`, list item `<li>`, cell,
  // block container) can't legally sit inside the `<span>` ⓘ-pairing wrapper
  // and can't have a sibling `<button>`. For those the child ITSELF opens the
  // sheet on tap — its own onClick is preserved (called first), then we open.
  const childIsTrigger = isNonPhrasingChild(children);

  const triggerChild = childIsTrigger
    ? cloneElement(children as ReactElement<{ onClick?: (e: MouseEvent) => void }>, {
        onClick: (e: MouseEvent) => {
          (children as ReactElement<{ onClick?: (e: MouseEvent) => void }>).props.onClick?.(e);
          setOpen(true);
        },
      })
    : null;

  const infoButton = (
    <button
      type="button"
      aria-label={buttonLabel}
      onClick={() => setOpen(true)}
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
  );

  // Trigger region: non-phrasing child taps itself (no <span> wrapper, no
  // sibling ⓘ); phrasing child renders inline next to the ⓘ button.
  const triggerRegion = childIsTrigger ? (
    triggerChild
  ) : (
    <span className="inline-flex items-center gap-1.5 align-middle">
      {children}
      {infoButton}
    </span>
  );

  return (
    <>
      {triggerRegion}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          variant="drawer"
          side="bottom"
          // The drawer's bottom side is a fixed h-1/3 strip; rich help can be
          // taller, so allow it to grow to a comfortable phone height and own
          // its own scroll. Square the bottom corners (it's anchored to the
          // viewport edge) while keeping the top radius from the side class.
          className={cn('h-auto max-h-[80vh] rounded-b-none flex flex-col', className)}
          // We render our own header/close below, so suppress the auto X.
          hideDefaultClose
          dir="rtl"
        >
          {/* Radix wires `aria-describedby` to this <SheetDescription> via its
              own descriptionId — that both silences the "Missing Description"
              dev warning and gives the dialog an accessible description. It is
              visually hidden because the visible body below carries the same
              help; the description summarises the subject. */}
          <SheetDescription className="sr-only">{headingContent}</SheetDescription>
          <SheetHeader className="flex items-center justify-between gap-3">
            {/* Never empty — falls back to the generic label so the dialog
                always has an accessible name (decision: SheetTitle is never
                empty). */}
            <SheetTitle>{headingContent}</SheetTitle>
            <SheetClose
              aria-label="סגור"
              className="rounded-md p-1 text-ink-muted hover:bg-glass-2"
            >
              <X size={18} aria-hidden="true" />
            </SheetClose>
          </SheetHeader>
          <SheetBody className="text-sm text-ink-secondary whitespace-pre-line leading-relaxed">
            {content}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  );
}
