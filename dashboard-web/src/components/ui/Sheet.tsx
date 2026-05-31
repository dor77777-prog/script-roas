'use client';

import { forwardRef, type ReactNode } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Wave-2 Task 2.5 — Sheet glass+neon treatment.
 *
 * Panel surface = vertical glass gradient (--glass-3 → --glass-2) +
 * --blur-sheet backdrop + --shadow-sheet drop + a violet glass-edge-hot
 * highlight on the OPENING edge (so the operator's eye lands on the
 * edge that just slid in, not on the corner that's been clamped to
 * the viewport).
 *
 * The opening edge depends on `side`:
 *   side="end"    → opens from inline-end → highlight inline-start
 *   side="start"  → opens from inline-start → highlight inline-end
 *   side="top"    → opens from the top    → highlight the bottom
 *   side="bottom" → opens from the bottom → highlight the top
 *
 * In RTL (the dashboard's default), inline-start == right, inline-end ==
 * left — so a side="end" drawer (slides in from the LEFT) gets its
 * highlight on the RIGHT inner edge. Tailwind's `border-s` / `border-e`
 * resolve correctly under both writing modes; using `border-glass-edge-hot`
 * for the opening-edge keeps the highlight in sync with `dir`.
 */
/**
 * Wave-4 Task 4.1 — `variant` axis: `drawer` (default, edge-anchored) vs
 * `modal` (centered floating card on a dimmed scrim).
 *
 *   variant="drawer"  → the Wave-2 edge drawer. `side` (end/start/top/bottom)
 *                       picks the opening edge, slide-in direction, and the
 *                       violet edge-hot highlight border. Surface = the glass
 *                       gradient + blur.
 *   variant="modal"   → a centered card (the Campaign drawer mockup). FLAT
 *                       `bg-glass-1` surface (no gradient), `zoom-in-95
 *                       fade-in-0` entrance instead of a slide, hairline
 *                       `border-glass-edge`, `rounded-[var(--radius-hero)]`.
 *                       On `max-sm` it becomes a full-screen sheet
 *                       (edge-to-edge, square corners). `side` is IGNORED for
 *                       modals — the compoundVariants below only emit side
 *                       classes when `variant === 'drawer'`.
 *
 * The shared base keeps only truly common classes (positioning context,
 * z-index, ink colour, shadow, the shared motion cadence). Surface + motion
 * direction now live PER-VARIANT so a modal never inherits the drawer's
 * gradient/blur/slide.
 */
const sheetVariants = cva(
  // Wave-6 Task 6.1 — pin the entrance to the semantic motion vocabulary:
  // `duration-base` resolves to --motion-base (240 ms) and `ease-out` to the
  // Wave-1 ease-out cubic. The prefers-reduced-motion sweep (Task 6.2)
  // collapses the slide/zoom to instant. Surface + entrance direction are set
  // per-variant below so the two presentations stay independent.
  'fixed z-50 text-ink shadow-sheet animate-in duration-base ease-out',
  {
    variants: {
      variant: {
        // Glass surface — gradient + blur. Tailwind's gradient-stop tokens DO
        // resolve our --glass-* vars (see tailwind.config.ts `colors.glass`).
        drawer:
          'bg-gradient-to-b from-glass-3 to-glass-2 [backdrop-filter:var(--blur-sheet)] [-webkit-backdrop-filter:var(--blur-sheet)]',
        // Centered floating card. Flat --glass-1 (NOT the drawer gradient),
        // hairline edge, hero radius, zoom/fade entrance. On max-sm it
        // collapses to a full-screen edge-to-edge sheet with square corners.
        modal: cn(
          'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
          'w-[min(92vw,920px)] max-h-[88vh] flex flex-col overflow-hidden',
          'rounded-[var(--radius-hero)] border border-glass-edge bg-glass-1',
          'zoom-in-95 fade-in-0',
          'max-sm:inset-0 max-sm:left-0 max-sm:top-0 max-sm:translate-x-0 max-sm:translate-y-0',
          'max-sm:w-full max-sm:max-w-none max-sm:h-full max-sm:max-h-none max-sm:rounded-none',
        ),
      },
      // `side` is declared so the prop is accepted, but emits NO classes on
      // its own — the actual edge positioning/slide/highlight is driven by the
      // compoundVariants below, gated on `variant === 'drawer'`. This keeps a
      // modal (which ignores side) from ever picking up edge classes, and
      // avoids double-emitting the side classes for drawers.
      side: {
        end:    '',
        start:  '',
        top:    '',
        bottom: '',
      },
    },
    // `side` classes apply ONLY to the drawer variant — a modal is centered and
    // ignores `side` entirely. compoundVariants gate each side on
    // variant=drawer so a `<SheetContent variant="modal" side="end">` (or the
    // defaultVariants' side="end") never picks up edge positioning/slide.
    compoundVariants: [
      { variant: 'drawer', side: 'end',    class: 'top-0 end-0 h-full w-3/4 max-w-md slide-in-from-end border-s border-glass-edge-hot' },
      { variant: 'drawer', side: 'start',  class: 'top-0 start-0 h-full w-3/4 max-w-md slide-in-from-start border-e border-glass-edge-hot' },
      { variant: 'drawer', side: 'top',    class: 'top-0 inset-x-0 h-1/3 slide-in-from-top border-b border-glass-edge-hot' },
      { variant: 'drawer', side: 'bottom', class: 'bottom-0 inset-x-0 h-1/3 slide-in-from-bottom border-t border-glass-edge-hot' },
    ],
    defaultVariants: { variant: 'drawer', side: 'end' },
  },
);

const SheetRoot     = RadixDialog.Root;
const SheetTriggerC = RadixDialog.Trigger;

/**
 * SheetClose — bumped to z-20 so the close X renders ABOVE Wave-2 sticky
 * table headers (z-5) inside the drawer body. Fixes P0-12 (close-X hidden
 * behind sticky header).
 */
const SheetCloseC = forwardRef<
  React.ElementRef<typeof RadixDialog.Close>,
  React.ComponentPropsWithoutRef<typeof RadixDialog.Close>
>(({ className, ...props }, ref) => (
  <RadixDialog.Close
    ref={ref}
    className={cn('relative z-20', className)}
    {...props}
  />
));
SheetCloseC.displayName = 'SheetClose';

export interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof RadixDialog.Content>,
    VariantProps<typeof sheetVariants> {
  children: ReactNode;
  /** Hide the auto-rendered X. Set to true when the consumer provides its own. */
  hideDefaultClose?: boolean;
  /**
   * Extra classes for the Radix overlay (the dim scrim/wash behind the panel).
   * Used by nested drawers that must paint ABOVE a parent Sheet's overlay —
   * e.g. the AdsDrawer opens over the centered Campaign modal and bumps both
   * its overlay and content to `z-[60]` so the modal's z-50 scrim can't cover
   * the ad-level drilldown. twMerge in `cn` lets a `z-[60]` here win over the
   * default `z-50`.
   */
  overlayClassName?: string;
}

const SheetContentC = forwardRef<
  React.ElementRef<typeof RadixDialog.Content>,
  SheetContentProps
>(({ className, variant, side, children, hideDefaultClose, overlayClassName, ...props }, ref) => (
  <RadixDialog.Portal>
    {/* Overlay treatment follows the variant: the modal sits on the tokenised
        --scrim dim (a calm dialog backdrop), the drawer keeps its frosted
        glass-3 wash. Both fade in. `overlayClassName` lets a nested drawer
        lift its scrim above a parent Sheet's overlay (see prop docs). */}
    <RadixDialog.Overlay
      className={cn(
        'fixed inset-0 z-50 backdrop-blur-sm animate-in fade-in-0',
        variant === 'modal' ? 'bg-scrim' : 'bg-glass-3',
        overlayClassName,
      )}
    />
    <RadixDialog.Content
      ref={ref}
      className={cn(sheetVariants({ variant, side }), className)}
      {...props}
    >
      {children}
      {!hideDefaultClose && (
        <SheetCloseC
          aria-label="סגור"
          className="absolute end-3 top-3 z-20 rounded-md p-1 text-ink-muted hover:bg-glass-2"
        >
          <X size={16} />
        </SheetCloseC>
      )}
    </RadixDialog.Content>
  </RadixDialog.Portal>
));
SheetContentC.displayName = RadixDialog.Content.displayName;

const SheetTitleC = forwardRef<
  React.ElementRef<typeof RadixDialog.Title>,
  React.ComponentPropsWithoutRef<typeof RadixDialog.Title>
>(({ className, ...props }, ref) => (
  <RadixDialog.Title ref={ref} className={cn('text-base font-semibold text-ink leading-tight', className)} {...props} />
));
SheetTitleC.displayName = RadixDialog.Title.displayName;

const SheetDescriptionC = forwardRef<
  React.ElementRef<typeof RadixDialog.Description>,
  React.ComponentPropsWithoutRef<typeof RadixDialog.Description>
>(({ className, ...props }, ref) => (
  <RadixDialog.Description ref={ref} className={cn('text-xs text-ink-muted mt-1', className)} {...props} />
));
SheetDescriptionC.displayName = RadixDialog.Description.displayName;

/**
 * Sheet.Header — sticky header strip. Renders inside the drawer body so
 * scrollable content slides behind it. z-10 (below the close X at z-20).
 */
function SheetHeaderC({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <header
      className={cn(
        'sticky top-0 z-10 px-4 sm:px-6 py-4 border-b border-glass-edge',
        // Match the panel surface so the sticky strip doesn't reveal a
        // mismatched colour when content scrolls behind it. We tint a touch
        // darker (glass-2) for visual separation against the gradient body.
        'bg-glass-2/95 [backdrop-filter:var(--blur-glass)]',
        className,
      )}
      {...props}
    />
  );
}
SheetHeaderC.displayName = 'SheetHeader';

/**
 * Sheet.Body — the scrollable content area. The drawer panel itself stays
 * `overflow-hidden` so the sticky header/footer don't shift; Body owns
 * the `overflow-y-auto`.
 */
function SheetBodyC({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex-1 overflow-y-auto p-4 sm:p-6', className)}
      {...props}
    />
  );
}
SheetBodyC.displayName = 'SheetBody';

/**
 * Sheet.Footer — sticky action strip at the bottom of the drawer. Matches
 * the header treatment so the two sticky strips read as a pair.
 */
function SheetFooterC({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <footer
      className={cn(
        'sticky bottom-0 z-10 px-4 sm:px-6 py-3 border-t border-glass-edge',
        'bg-glass-2/95 [backdrop-filter:var(--blur-glass)]',
        'flex items-center justify-end gap-2',
        className,
      )}
      {...props}
    />
  );
}
SheetFooterC.displayName = 'SheetFooter';

// ---------------------------------------------------------------------------
// Named exports (back-compat) + compound namespace.
// Existing call sites do `import { Sheet, SheetContent } from ...` — we
// keep those exports stable, and additionally attach the children to the
// `Sheet` object so new code can use `<Sheet.Header>` / `<Sheet.Body>` etc.
// ---------------------------------------------------------------------------
export const SheetTrigger     = SheetTriggerC;
export const SheetClose       = SheetCloseC;
export const SheetContent     = SheetContentC;
export const SheetTitle       = SheetTitleC;
export const SheetDescription = SheetDescriptionC;
export const SheetHeader      = SheetHeaderC;
export const SheetBody        = SheetBodyC;
export const SheetFooter      = SheetFooterC;

export const Sheet = Object.assign(SheetRoot, {
  Trigger:     SheetTriggerC,
  Close:       SheetCloseC,
  Content:     SheetContentC,
  Title:       SheetTitleC,
  Description: SheetDescriptionC,
  Header:      SheetHeaderC,
  Body:        SheetBodyC,
  Footer:      SheetFooterC,
});
