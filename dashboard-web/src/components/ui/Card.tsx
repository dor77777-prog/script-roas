import { forwardRef, type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Task 2.4 — Card primitive (glass).
 *
 * Default class string is `glass rounded-card p-5` (per v2 plan, mockup-04-
 * final.html:91-98). The `.glass` rule lives in globals.css and provides the
 * canonical 3-layer surface treatment: linear-gradient(--glass-2→--glass-1),
 * --blur-glass backdrop-filter, --glass-edge rim, --shadow-glass inset+drop,
 * position: relative (so [data-band]::before anchors).
 *
 * Two opt-in V4 props:
 *   • `band="red|orange|green|blue|gray"` — forwards to data-band="…".
 *     Wave-1 Task 1.3 CSS (.glass[data-band]) adds a 3px top glow bar +
 *     ~5% chroma tint behind the card.
 *   • `freshness="fresh|aging|stale"` — forwards to data-freshness="…".
 *     Wave-1 Task 1.4 CSS (.glass[data-freshness]) desaturates the card
 *     so a stale row visibly fades next to live siblings (15 / 30 min
 *     thresholds; see lib/freshness/useStaleness.ts).
 *
 * Variants:
 *   - `default` (omitted prop)  → full glass treatment.
 *   - `flat`                    → no glass / border / shadow. Opt-out for
 *     inline groupings that nest inside a parent Card. Mirrors the
 *     pre-Wave-2 API so legacy `variant="flat"` sites keep working.
 *
 * The pre-Wave-2 `variant="elevated"` was visually identical to `default`
 * (Task 1.7 collapsed the shadow ladder); it is intentionally NOT exposed
 * here. A legacy `variant="elevated"` prop still resolves to default via
 * the variants map below so consumers that haven't migrated yet keep
 * rendering correctly.
 */

const cardVariants = cva(
  /* Plan-spec default: `glass rounded-card p-5`. The `glass` token is the
   * literal class name; CSS rule lives in globals.css. `text-ink` is added
   * so cards have a body-coloured default text fill (was on the previous
   * implementation; no consumer relies on it but removing it would silently
   * change foreground colour on every card). */
  'glass rounded-card p-5 text-ink transition-colors',
  {
    variants: {
      variant: {
        default:  '',
        // Legacy alias — Task 1.7 collapsed elevated → default at the shadow
        // layer. Kept as a no-op variant so `variant="elevated"` callers do
        // not type-error during the wave-2 sweep.
        elevated: '',
        // Opt-out: strip the glass treatment entirely. `backdrop-blur-none`
        // is the Tailwind utility for `backdrop-filter: none`; the other
        // three (`!bg-transparent`, `!border-0`, `!shadow-none`) override
        // the corresponding rules in the `.glass` CSS block above.
        flat:     '!bg-transparent !border-0 !shadow-none backdrop-blur-none',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export type CardBand = 'red' | 'orange' | 'green' | 'blue' | 'gray';
export type CardFreshness = 'fresh' | 'aging' | 'stale';

export interface CardProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {
  /** V4 band signal — forwards to `data-band="…"`. */
  band?: CardBand;
  /** V4 freshness desaturation — forwards to `data-freshness="…"`. */
  freshness?: CardFreshness;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, band, freshness, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(cardVariants({ variant }), className)}
      data-band={band}
      data-freshness={freshness}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

/* Subcomponents — opinionated padding wrappers. Kept thin so a card built
 * from `<Card><CardHeader>…</CardHeader>…</Card>` doesn't double-pad. The
 * Card root brings its own `p-5`; CardHeader/Body/Footer use margin-top so
 * they stack inside the root padding rather than re-padding. Use `flat`
 * variant on the root if you need an unpadded chassis with section-style
 * inner padding instead. */

export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-1', className)} {...props} />
  ),
);
CardHeader.displayName = 'CardHeader';

export const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn('text-sm font-semibold text-ink leading-tight', className)} {...props} />
  ),
);
CardTitle.displayName = 'CardTitle';

export const CardDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn('text-xs text-ink-muted', className)} {...props} />
  ),
);
CardDescription.displayName = 'CardDescription';

export const CardBody = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('mt-3', className)} {...props} />
  ),
);
CardBody.displayName = 'CardBody';

export const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('mt-3 pt-3 border-t border-glass-edge', className)} {...props} />
  ),
);
CardFooter.displayName = 'CardFooter';
